const { pool, query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { toPence, fromPence, getProjection } = require('./variationAccountAuthorityRepository');

const fail = (status, message) => ({ ok: false, status, message });
const actor = auth => [auth.userId, auth.membershipId, auth.providerUserId, auth.displayName];
const money = value => fromPence(toPence(value));
const text = value => String(value ?? '').trim();

function requireWorkflowPermissions(auth) {
  for (const permission of [
    PERMISSIONS.VARIATION_ACCOUNT_VIEW,
    PERMISSIONS.VARIATION_ACCOUNT_CREATE,
    PERMISSIONS.VARIATION_ACCOUNT_ASSESS,
    PERMISSIONS.VARIATION_ACCOUNT_AUTHORITY_ALLOCATE,
  ]) assertServicePermission(auth, permission);
  if (!auth?.userId || !auth?.membershipId || !auth?.providerUserId) {
    throw Object.assign(new Error('Authenticated BuildLite identity is required.'), { status: 401 });
  }
}

async function authorityCandidates(db, clientId, packageId) {
  const { rows: ceRows } = await db.query(`SELECT id,event_number,description,value,status
    FROM commercial_events WHERE client_id=$1 AND package_id=$2
      AND status IN('approved','includedInCertificate','closed')
      AND COALESCE(relationship_type,'')<>'recovery'
      AND COALESCE(event_type,'')<>'budgetTransfer'
      AND COALESCE(financial_treatment,'')<>'recoverableDeduction'
    ORDER BY event_number,id`, [clientId, packageId]);
  const { rows: explicitVoRows } = await db.query(`SELECT link.commercial_event_id,l.id source_id,l.net_value source_value,
      link.allocated_value lineage_value,vo.id variation_order_id,vo.variation_order_number,
      vo.source_po_number,vo.status,l.description,'line_allocation' provenance_model
    FROM variation_order_line_commercial_event_allocations link
    JOIN variation_order_lines l ON l.client_id=link.client_id AND l.id=link.variation_order_line_id
    JOIN variation_orders vo ON vo.client_id=l.client_id AND vo.id=l.variation_order_id
    WHERE link.client_id=$1 AND vo.package_id=$2 AND vo.status='issued'
    ORDER BY vo.issued_at,l.line_number,l.id`, [clientId, packageId]);
  const { rows: normalVoRows } = await db.query(`SELECT source.commercial_event_id,l.id source_id,l.net_value source_value,
      l.net_value lineage_value,vo.id variation_order_id,vo.variation_order_number,
      vo.source_po_number,vo.status,l.description,'normal_source' provenance_model
    FROM variation_orders vo
    JOIN variation_order_commercial_events source
      ON source.client_id=vo.client_id AND source.variation_order_id=vo.id
      AND source.commercial_event_id=vo.normal_source_commercial_event_id
    JOIN variation_order_lines l ON l.client_id=vo.client_id AND l.variation_order_id=vo.id
    WHERE vo.client_id=$1 AND vo.package_id=$2 AND vo.status='issued'
      AND vo.normal_source_commercial_event_id IS NOT NULL
    ORDER BY vo.issued_at,l.line_number,l.id`, [clientId, packageId]);
  const explicitVoKeys = new Set(explicitVoRows.map(row => `${row.commercial_event_id}:${row.variation_order_id}`));
  const voRows = [...explicitVoRows, ...normalVoRows.filter(row => !explicitVoKeys.has(`${row.commercial_event_id}:${row.variation_order_id}`))];
  const issuedByCe = voRows.reduce((map, row) => {
    if (!map.has(row.commercial_event_id)) map.set(row.commercial_event_id, []);
    map.get(row.commercial_event_id).push(row);
    return map;
  }, new Map());
  const candidates = [];
  for (const ce of ceRows) {
    const successors = issuedByCe.get(ce.id) || [];
    if (successors.length > 1) {
      candidates.push({ id: `authority:${ce.id}`, kind: 'existing_approved', reference: ce.event_number,
        description: ce.description, currentAuthority: null, reviewRequired: true,
        reviewReason: 'This approved variation has multiple Issued VO lines and requires commercial allocation review.' });
      continue;
    }
    const successor = successors[0];
    candidates.push({
      id: `authority:${ce.id}`, kind: 'existing_approved', reference: ce.event_number,
      description: ce.description, reviewRequired: false,
      currentAuthority: money(successor ? successor.lineage_value : ce.value),
      sourceType: successor ? 'variation_order_line' : 'commercial_event',
      sourceId: successor ? successor.source_id : ce.id,
      sourceReference: successor ? `${successor.source_po_number}/${successor.variation_order_number}` : ce.event_number,
      provenance: { commercialEventId: ce.id, commercialEventValue: Number(ce.value), variationOrderId: successor?.variation_order_id || null,
        variationOrderLineId: successor?.source_id || null, provenanceModel: successor?.provenance_model || null,
        currentSource: successor ? 'issued_variation_order' : 'approved_commercial_event' },
    });
  }
  return candidates;
}

async function listCandidates(clientId, packageId, certificateId, auth) {
  assertServicePermission(auth, PERMISSIONS.VARIATION_ACCOUNT_VIEW);
  const cert = (await query('SELECT id FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3', [clientId, packageId, certificateId])).rows[0];
  if (!cert) return fail(404, 'Payment certificate not found.');
  const db = await pool.connect();
  try {
    const candidates = await authorityCandidates(db, clientId, packageId);
    const items = (await db.query("SELECT * FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2 AND status='active' ORDER BY created_at,id", [clientId, packageId])).rows;
    const result = [];
    const representedSources = new Set();
    for (const item of items) {
      const projection = await getProjection(clientId, item.id, auth, db);
      for (const allocation of projection.allocations || []) {
        if (allocation.commercialEventId) representedSources.add(`commercial_event:${allocation.commercialEventId}`);
        if (allocation.variationOrderLineId) representedSources.add(`variation_order_line:${allocation.variationOrderLineId}`);
      }
      result.push({ id: `va:${item.id}`, kind: projection.effectiveRecognisedAuthority ? 'existing_approved' : 'new_unapproved',
        variationAccountItemId: item.id, reference: item.variation_reference, description: item.description,
        currentAuthority: projection.effectiveRecognisedAuthority, forecastStatus: item.forecast_status,
        reviewRequired: false, provenance: { variationAccountItemId: item.id } });
    }
    for (const candidate of candidates) {
      if (!candidate.reviewRequired && representedSources.has(`${candidate.sourceType}:${candidate.sourceId}`)) continue;
      result.push(candidate);
    }
    return { ok: true, status: 200, candidates: result };
  } finally { db.release(); }
}

async function nextReference(db, clientId, packageId) {
  const row = (await db.query(`INSERT INTO package_variation_account_sequences(client_id,package_id,next_number) VALUES($1,$2,2)
    ON CONFLICT(client_id,package_id) DO UPDATE SET next_number=package_variation_account_sequences.next_number+1
    RETURNING next_number-1 number`, [clientId, packageId])).rows[0];
  return `VA-${String(row.number).padStart(4, '0')}`;
}

async function createPendingItem(db, { clientId, packageId, pkg, cert, line, auth, reason }) {
  const reference = await nextReference(db, clientId, packageId);
  const item = (await db.query(`INSERT INTO package_variation_account_items
    (client_id,development_id,package_id,cost_code,variation_reference,contractor_reference,description,current_contractor_value,current_qs_forecast,forecast_status,originating_certificate_id,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL,'pending',$9,$10,$11,$12,$13) RETURNING *`,
  [clientId, pkg.development_id, packageId, pkg.cost_code, reference, line.contractor_reference,
    line.contractor_description, line.contractor_variation_value, cert.id, ...actor(auth)])).rows[0];
  await db.query(`INSERT INTO package_variation_account_contractor_positions
    (client_id,variation_account_item_id,contractor_value,contractor_reference,source_type,source_id,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
    VALUES($1,$2,$3,$4,'application_line',$5,$6,1,$7,$8,$9,$10)`,
  [clientId, item.id, line.contractor_variation_value, line.contractor_reference, line.id,
    'Recorded from the contractor application; QS Forecast remains unassessed', ...actor(auth)]);
  await db.query(`INSERT INTO package_variation_account_lifecycle_audit
    (client_id,variation_account_item_id,action,prior_status,new_status,reason,item_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
    VALUES($1,$2,'created',NULL,'active',$3,1,$4,$5,$6,$7)`,
  [clientId, item.id, reason, ...actor(auth)]);
  return item;
}

async function reconcileAndAssess(clientId, packageId, certificateId, applicationId, lineId, body, auth) {
  requireWorkflowPermissions(auth);
  const assessment = money(body.currentAssessment), basis = text(body.basis), candidateId = text(body.candidateId) || 'new';
  if (!toPence(assessment) || !basis) return fail(400, 'A non-zero signed QS assessment and basis are required.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`certificate-variation:${clientId}:${lineId}`]);
    const pkg = (await db.query('SELECT * FROM packages WHERE client_id=$1 AND id=$2 FOR UPDATE', [clientId, packageId])).rows[0];
    const cert = (await db.query('SELECT * FROM package_payment_certificates WHERE client_id=$1 AND package_id=$2 AND id=$3 FOR UPDATE', [clientId, packageId, certificateId])).rows[0];
    const line = (await db.query(`SELECT l.* FROM subcontract_payment_application_variation_lines l
      JOIN subcontract_payment_applications a ON a.id=l.application_id AND a.client_id=l.client_id
      WHERE l.client_id=$1 AND l.package_id=$2 AND l.application_id=$3 AND l.id=$4 AND a.certificate_id=$5 AND a.status='recorded' FOR UPDATE OF l`,
    [clientId, packageId, applicationId, lineId, certificateId])).rows[0];
    if (!pkg || !cert || !line) { await db.query('ROLLBACK'); return fail(404, 'Draft application variation was not found.'); }
    if (cert.status !== 'draft') { await db.query('ROLLBACK'); return fail(409, 'Variations can only be assessed on a Draft certificate.'); }

    let item = null;
    let source = null;
    if (candidateId.startsWith('va:')) {
      item = (await db.query("SELECT * FROM package_variation_account_items WHERE client_id=$1 AND package_id=$2 AND id=$3 AND status='active' FOR UPDATE", [clientId, packageId, candidateId.slice(3)])).rows[0];
      if (!item) { await db.query('ROLLBACK'); return fail(409, 'The selected variation is no longer available. Refresh and retry.'); }
    } else if (candidateId.startsWith('authority:')) {
      const candidates = await authorityCandidates(db, clientId, packageId);
      const candidate = candidates.find(entry => entry.id === candidateId);
      if (!candidate || candidate.reviewRequired) { await db.query('ROLLBACK'); return fail(409, candidate?.reviewReason || 'The selected commercial authority is no longer available.'); }
      source = candidate;
      const column = source.sourceType === 'commercial_event' ? 'commercial_event_id' : 'variation_order_line_id';
      const representedIds = (await db.query(`SELECT DISTINCT a.variation_account_item_id
        FROM package_variation_account_authority_allocations a
        JOIN package_variation_account_items v ON v.client_id=a.client_id AND v.id=a.variation_account_item_id
        WHERE a.client_id=$1 AND a.package_id=$2 AND a.${column}=$3 AND v.status='active'`,
      [clientId, packageId, source.sourceId])).rows.map(row => row.variation_account_item_id);
      const represented = representedIds.length
        ? (await db.query(`SELECT * FROM package_variation_account_items
          WHERE client_id=$1 AND package_id=$2 AND id=ANY($3::uuid[]) AND status='active' FOR UPDATE`,
        [clientId, packageId, representedIds])).rows
        : [];
      if (represented.length > 1) { await db.query('ROLLBACK'); return fail(409, 'This authority is represented by more than one variation and requires review.'); }
      item = represented[0] || null;
    }
    if (!item) item = await createPendingItem(db, { clientId, packageId, pkg, cert, line, auth, reason: source ? `Created internally for ${source.reference}` : 'Created from an unapproved application variation' });

    if (source) {
      const column = source.sourceType === 'commercial_event' ? 'commercial_event_id' : 'variation_order_line_id';
      const existing = (await db.query(`SELECT * FROM package_variation_account_authority_allocations WHERE client_id=$1 AND ${column}=$2 FOR UPDATE`, [clientId, source.sourceId])).rows;
      const alreadyForItem = existing.find(entry => entry.variation_account_item_id === item.id);
      if (!alreadyForItem) {
        if (existing.length) { await db.query('ROLLBACK'); return fail(409, 'This authority is already allocated elsewhere and requires review.'); }
        const allocation = (await db.query(`INSERT INTO package_variation_account_authority_allocations
          (client_id,development_id,package_id,variation_account_item_id,source_type,commercial_event_id,variation_order_line_id,signed_allocated_amount,reason,source_status_snapshot,source_value_snapshot,source_reference_snapshot,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
        [clientId, pkg.development_id, packageId, item.id, source.sourceType,
          source.sourceType === 'commercial_event' ? source.sourceId : null,
          source.sourceType === 'variation_order_line' ? source.sourceId : null,
          source.currentAuthority, 'Linked automatically during certificate assessment', source.provenance.currentSource === 'issued_variation_order' ? 'issued' : 'approved',
          source.currentAuthority, source.sourceReference, ...actor(auth)])).rows[0];
        await db.query(`INSERT INTO package_variation_account_authority_audit
          (client_id,variation_account_item_id,allocation_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
          VALUES($1,$2,$3,'allocated',$4,$5,$6,$7,$8)`, [clientId, item.id, allocation.id,
          JSON.stringify({ sourceType: source.sourceType, sourceId: source.sourceId, amount: source.currentAuthority, certificateWorkflow: true }), ...actor(auth)]);
      }
    }

    if (line.variation_account_item_id && line.variation_account_item_id !== item.id) { await db.query('ROLLBACK'); return fail(409, 'This application variation is already matched to another variation.'); }
    if (!line.variation_account_item_id) {
      await db.query("UPDATE subcontract_payment_application_variation_lines SET variation_account_item_id=$1,reconciliation_state='matched',updated_at=NOW() WHERE id=$2", [item.id, line.id]);
      await db.query(`INSERT INTO subcontract_payment_application_variation_audit(client_id,line_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
        VALUES($1,$2,'matched',$3,$4,$5,$6,$7)`, [clientId, line.id, JSON.stringify({ variationAccountItemId: item.id, reference: item.variation_reference, certificateWorkflow: true }), ...actor(auth)]);
    }
    const previous = Number((await db.query(`SELECT COALESCE(SUM(a.signed_current_assessment),0) total
      FROM package_variation_account_certificate_assessments a JOIN package_payment_certificates pc ON pc.id=a.certificate_id AND pc.client_id=a.client_id
      WHERE a.client_id=$1 AND a.package_id=$2 AND a.variation_account_item_id=$3 AND a.status='locked' AND pc.certificate_number<$4`,
    [clientId, packageId, item.id, cert.certificate_number])).rows[0].total);
    const cumulative = money(previous + assessment);
    if (item.forecast_status !== 'pending' && item.current_qs_forecast != null) {
      const limit = Number(item.current_qs_forecast);
      if ((limit >= 0 && cumulative > limit + .005) || (limit < 0 && cumulative < limit - .005)) { await db.query('ROLLBACK'); return fail(409, 'Cumulative certification would exceed the current QS Forecast. Revise the QS Forecast first.'); }
    }
    const existingAssessment = (await db.query(`SELECT * FROM package_variation_account_certificate_assessments
      WHERE client_id=$1 AND certificate_id=$2 AND variation_account_item_id=$3 AND status='draft' FOR UPDATE`, [clientId, certificateId, item.id])).rows[0];
    let saved, action;
    if (existingAssessment) {
      saved = (await db.query(`UPDATE package_variation_account_certificate_assessments SET application_variation_line_id=$1,signed_current_assessment=$2,assessment_basis=$3,version=version+1,updated_by_user_id=$4,updated_by_membership_id=$5,updated_by_provider_user_id=$6,updated_by_display_name=$7,updated_at=NOW() WHERE id=$8 RETURNING *`, [line.id, assessment, basis, ...actor(auth), existingAssessment.id])).rows[0];
      action = 'revised';
    } else {
      saved = (await db.query(`INSERT INTO package_variation_account_certificate_assessments
        (client_id,development_id,package_id,certificate_id,variation_account_item_id,application_variation_line_id,signed_current_assessment,assessment_basis,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$9,$10,$11,$12) RETURNING *`, [clientId, pkg.development_id, packageId, certificateId, item.id, line.id, assessment, basis, ...actor(auth)])).rows[0];
      action = 'created';
    }
    await db.query(`INSERT INTO package_variation_account_certificate_assessment_audit
      (client_id,assessment_id,certificate_id,variation_account_item_id,action,detail,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [clientId, saved.id, certificateId, item.id, action,
      JSON.stringify({ signedCurrentAssessment: assessment, previousCertified: previous, cumulativeCertified: cumulative, applicationVariationLineId: line.id, certificateWorkflow: true }), ...actor(auth)]);
    await db.query('COMMIT');
    return { ok: true, status: 200, variationAccountItemId: item.id, assessmentId: saved.id, forecastStatus: item.forecast_status || 'assessed' };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.status) return fail(error.status, error.message);
    throw error;
  } finally { db.release(); }
}

module.exports = { listCandidates, reconcileAndAssess, authorityCandidates };
