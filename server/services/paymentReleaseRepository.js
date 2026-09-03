const { pool, query } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { toPence, fromPence } = require('./variationAccountAuthorityRepository');
const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('./canonicalJsonIntegrity');

const money = value => fromPence(toPence(value));
const clean = value => String(value ?? '').trim();
const fail = (status, message) => ({ ok: false, status, message });
const actor = auth => [auth.userId, auth.membershipId, auth.providerUserId, auth.displayName];
const dateOnly = value => value instanceof Date ? value.toISOString().slice(0, 10) : value ? String(value).slice(0, 10) : null;

function requireReleasePermission(auth) {
  assertServicePermission(auth, PERMISSIONS.PAYMENT_RELEASE_EXECUTE);
  if (!auth?.userId || !auth?.membershipId || !auth?.providerUserId) {
    const error = new Error('Authenticated Payment Release identity is required.');
    error.status = 401;
    throw error;
  }
}

async function loadRows(db, clientId, decisionIds = null, lock = false) {
  const params = [clientId];
  let filter = '';
  if (decisionIds) {
    params.push(decisionIds);
    filter = 'AND d.id=ANY($2::uuid[])';
  }
  return (await db.query(`SELECT d.*,c.status certificate_status,c.certificate_number,
      p.supplier_id,p.supplier_label,p.development_name,p.cost_code,p.payload package_payload,
      s.payload supplier_payload,
      COALESCE((SELECT SUM(r.signed_cash_amount) FROM payment_authority_decisions r
        WHERE r.client_id=d.client_id AND r.reverses_decision_id=d.id),0) reversal_cash,
      COALESCE((SELECT SUM(i.signed_released_cash) FROM payment_release_items i
        WHERE i.client_id=d.client_id AND i.payment_authority_decision_id=d.id),0) released_cash
    FROM payment_authority_decisions d
    JOIN package_payment_certificates c ON c.id=d.certificate_id AND c.client_id=d.client_id
    JOIN packages p ON p.id=d.package_id AND p.client_id=d.client_id
    LEFT JOIN suppliers s ON s.id=p.supplier_id AND s.client_id=d.client_id
    WHERE d.client_id=$1 AND d.decision_kind='authority' ${filter}
    ORDER BY d.final_payment_date NULLS LAST,d.approved_at,d.id${lock ? ' FOR UPDATE OF d' : ''}`, params)).rows;
}

function releaseReadiness(row) {
  const authorised = toPence(row.signed_cash_amount);
  const reversed = toPence(row.reversal_cash);
  const released = toPence(row.released_cash);
  const effective = authorised + reversed;
  const reasons = [];
  const warnings = [];
  const integrity = verifyJsonIntegrity(row.source_snapshot, row.source_snapshot_sha256, row.source_snapshot_hash_scheme);
  if (row.certificate_status !== 'locked') reasons.push('Source certificate is no longer Locked.');
  if (!authorised) reasons.push('Payment Authority cash is zero.');
  if (reversed) reasons.push('Payment Authority changed after approval; corrected/reapproved authority is required.');
  if (integrity.verifiable && !integrity.valid) reasons.push('Payment Authority source integrity verification failed.');
  if (integrity.reason === 'unsupported_scheme') reasons.push('Payment Authority source hash scheme is unsupported.');
  if (integrity.reason === 'legacy_unversioned') warnings.push('Legacy Payment Authority hash is not canonically verifiable.');
  if (!row.supplier_payload?.bankDetailsVerified) warnings.push('Verified bank details are not held; Release stops at Accounts.');
  let workflowState = 'ready';
  if (released !== 0) workflowState = released === authorised && !reversed ? 'released' : 'needs_review';
  else if (reasons.length) workflowState = 'needs_review';
  return {
    workflowState,
    eligible: workflowState === 'ready',
    reasons,
    warnings,
    authorisedCash: fromPence(authorised),
    effectiveCashAuthority: fromPence(effective),
    previouslyReleased: fromPence(released),
    releasableCash: workflowState === 'ready' ? fromPence(authorised) : 0,
    integrity,
  };
}

function mapRow(row) {
  const ready = releaseReadiness(row);
  return {
    id: row.id,
    paymentAuthorityDecisionId: row.id,
    certificateId: row.certificate_id,
    certificateVersion: Number(row.certificate_version),
    certificateNumber: Number(row.certificate_number),
    packageId: row.package_id,
    developmentId: row.development_id,
    development: row.development_name,
    supplierId: row.supplier_id,
    supplier: row.supplier_label,
    packageTrade: row.package_payload?.description || row.cost_code,
    costCode: row.cost_code,
    paymentAuthorityDate: row.approved_at,
    paymentAuthorityActor: row.approved_by_display_name,
    finalPaymentDate: dateOnly(row.final_payment_date),
    notifiedSum: money(row.notified_sum),
    intendedPayment: money(row.intended_payment),
    noticeMode: row.notice_mode,
    externalStatus: 'not_exported',
    ...ready,
  };
}

async function listQueue(clientId, auth) {
  requireReleasePermission(auth);
  return (await loadRows({ query }, clientId)).map(mapRow).sort((a, b) => {
    const rank = { ready: 0, needs_review: 1, released: 2 };
    return rank[a.workflowState] - rank[b.workflowState]
      || String(a.finalPaymentDate || '9999').localeCompare(String(b.finalPaymentDate || '9999'));
  });
}

async function executeBatch(clientId, body, auth) {
  requireReleasePermission(auth);
  const idempotencyKey = clean(body.idempotencyKey);
  const reason = clean(body.reason);
  const decisionIds = [...new Set((body.paymentAuthorityDecisionIds || []).map(clean).filter(Boolean))];
  if (!idempotencyKey || !reason || !decisionIds.length) return fail(400, 'Idempotency key, reason and at least one Payment Authority decision are required.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const existing = (await db.query('SELECT * FROM payment_release_batches WHERE client_id=$1 AND idempotency_key=$2', [clientId, idempotencyKey])).rows[0];
    if (existing) {
      await db.query('COMMIT');
      return { ok: true, status: 200, batchId: existing.id, batchReference: existing.batch_reference, idempotent: true };
    }
    const rows = await loadRows(db, clientId, decisionIds, true);
    if (rows.length !== decisionIds.length) {
      await db.query('ROLLBACK');
      return fail(404, 'One or more Payment Authority decisions were not found.');
    }
    const items = rows.map(row => ({ row, ready: releaseReadiness(row) }));
    const blocked = items.find(item => !item.ready.eligible);
    if (blocked) {
      await db.query('ROLLBACK');
      return fail(409, blocked.ready.workflowState === 'released'
        ? 'Payment Authority cash has already been released.'
        : blocked.ready.reasons[0] || 'Payment Authority is not ready for Release.');
    }
    const itemSnapshots = items.map(({ row, ready }) => ({
      paymentAuthorityDecisionId: row.id,
      paymentAuthorityHash: row.source_snapshot_sha256,
      paymentAuthorityHashScheme: row.source_snapshot_hash_scheme || null,
      certificateId: row.certificate_id,
      certificateVersion: Number(row.certificate_version),
      packageId: row.package_id,
      supplierId: row.supplier_id,
      supplierLabel: row.supplier_label,
      authorisedCash: ready.authorisedCash,
      previouslyReleased: 0,
      releasedCash: ready.releasableCash,
      finalPaymentDate: dateOnly(row.final_payment_date),
      intendedPaymentDecisionId: row.intended_payment_decision_id,
      intendedPaymentDecisionVersion: row.intended_payment_decision_version,
      paymentNoticeSnapshotId: row.payment_notice_snapshot_id,
      payLessSnapshotId: row.pay_less_snapshot_id,
      deadlineSnapshotId: row.deadline_snapshot_id,
      noticeMode: row.notice_mode,
      externalStatus: 'not_exported',
    }));
    const totalPence = itemSnapshots.reduce((sum, item) => sum + toPence(item.releasedCash), 0);
    if (!totalPence) {
      await db.query('ROLLBACK');
      return fail(409, 'Payment Release total cannot be zero.');
    }
    const batchReference = clean(body.batchReference) || `PR-${Date.now()}`;
    const batchSnapshot = { meaning: 'released_to_accounts', externalStatus: 'not_exported', items: itemSnapshots };
    const batch = (await db.query(`INSERT INTO payment_release_batches(client_id,batch_reference,item_count,signed_total_released,reason,
      idempotency_key,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,released_by_user_id,
      released_by_membership_id,released_by_provider_user_id,released_by_display_name,released_role_key,released_permission_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [clientId,batchReference,itemSnapshots.length,fromPence(totalPence),reason,idempotencyKey,JSON.stringify(batchSnapshot),
        hashCanonicalJson(batchSnapshot),CANONICAL_JSON_SHA256_V1,...actor(auth),auth.roleKey,PERMISSIONS.PAYMENT_RELEASE_EXECUTE])).rows[0];
    for (const snapshot of itemSnapshots) {
      const row = rows.find(candidate => candidate.id === snapshot.paymentAuthorityDecisionId);
      const item = (await db.query(`INSERT INTO payment_release_items(client_id,batch_id,payment_authority_decision_id,development_id,
        package_id,certificate_id,supplier_id,supplier_label,signed_authorised_cash,signed_previously_released,signed_released_cash,
        final_payment_date,intended_payment_decision_id,intended_payment_decision_version,payment_notice_snapshot_id,pay_less_snapshot_id,
        deadline_snapshot_id,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [clientId,batch.id,row.id,row.development_id,row.package_id,row.certificate_id,row.supplier_id,row.supplier_label,
          row.signed_cash_amount,row.final_payment_date,row.intended_payment_decision_id,row.intended_payment_decision_version,
          row.payment_notice_snapshot_id,row.pay_less_snapshot_id,row.deadline_snapshot_id,JSON.stringify(snapshot),
          hashCanonicalJson(snapshot),CANONICAL_JSON_SHA256_V1])).rows[0];
      await db.query(`INSERT INTO payment_release_audit(client_id,batch_id,item_id,action,detail,actor_user_id,actor_membership_id,
        actor_provider_user_id,actor_display_name,actor_role_key,permission_key)
        VALUES($1,$2,$3,'item_released',$4,$5,$6,$7,$8,$9,$10)`,
        [clientId,batch.id,item.id,JSON.stringify({ amount: snapshot.releasedCash, externalStatus: 'not_exported' }),...actor(auth),auth.roleKey,PERMISSIONS.PAYMENT_RELEASE_EXECUTE]);
    }
    await db.query(`INSERT INTO payment_release_audit(client_id,batch_id,action,detail,actor_user_id,actor_membership_id,
      actor_provider_user_id,actor_display_name,actor_role_key,permission_key)
      VALUES($1,$2,'batch_released',$3,$4,$5,$6,$7,$8,$9)`,
      [clientId,batch.id,JSON.stringify({ itemCount: itemSnapshots.length, totalReleased: fromPence(totalPence) }),...actor(auth),auth.roleKey,PERMISSIONS.PAYMENT_RELEASE_EXECUTE]);
    await db.query('COMMIT');
    return { ok: true, status: 201, batchId: batch.id, batchReference, itemCount: itemSnapshots.length, totalReleased: fromPence(totalPence), externalStatus: 'not_exported' };
  } catch (error) {
    await db.query('ROLLBACK');
    if (error.code === '23505') return fail(409, 'Payment Authority cash has already been released.');
    throw error;
  } finally {
    db.release();
  }
}

module.exports = { listQueue, executeBatch, releaseReadiness, loadRows };
