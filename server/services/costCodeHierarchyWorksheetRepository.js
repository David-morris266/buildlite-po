const crypto = require('crypto');
const { pool } = require('../db');
const { assertServicePermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { STATES, clean, key, catalogueToken, loadHierarchyAuthority, resolvePath, consolidateProposals, createPath, signEvidence, evidenceMatches } = require('./costCodeHierarchyAuthority');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BLOCKED = new Set([STATES.INVALID, STATES.AMBIGUOUS, STATES.ARCHIVED]);
const fail = (status, message) => ({ ok: false, status, message, errors: [message] });
const same = (left, right) => String(left || '') === String(right || '');

function currentHierarchy(structure, row) {
  const head = structure.heads.find((item) => item.id === row.commercial_head_id);
  const family = row.commercial_family_id ? structure.families.find((item) => item.id === row.commercial_family_id) : null;
  const group = structure.reportingGroups.find((item) => item.id === row.reporting_group_id);
  const valid = Boolean(head && group && head.active && group.active && (!row.commercial_family_id || (family && family.active)) && group.headId === head.id && (group.familyId || null) === (family?.id || null));
  return {
    path: { commercialHeadId: row.commercial_head_id || null, commercialFamilyId: row.commercial_family_id || null, reportingGroupId: row.reporting_group_id || null },
    labels: { commercialHead: head?.name || row.commercial_head || '', commercialFamily: family?.name || row.commercial_family || '', reportingGroup: group?.name || row.reporting_group || '' },
    state: valid ? 'allocated' : row.hierarchy_review_disposition === 'not_applicable' && !row.commercial_head_id && !row.commercial_family_id && !row.reporting_group_id ? 'not_applicable' : (!row.commercial_head_id && !row.commercial_family_id && !row.reporting_group_id ? 'not_reviewed' : 'needs_attention'),
    valid,
  };
}

function normalizeDecision(value) {
  const normalized = key(value).replace(/[_-]+/g, ' ');
  if (!normalized) return '';
  if (normalized === 'not applicable' || normalized === 'n/a' || normalized === 'na') return 'not_applicable';
  if (normalized === 'keep existing' || normalized === 'keep') return 'keep_existing';
  return 'invalid';
}

function reviewedEvidence(preview) {
  return {
    catalogueRevision: preview.catalogueRevision,
    rows: preview.rows.map(({ rowNumber, id, code, description, version, action, before, after, resolution, sourceEvidence }) => ({ rowNumber, id, code, description, version, action, before, after, resolution, sourceEvidence })),
    proposals: preview.proposals,
  };
}

async function authoritativeSourceEvidence(db, clientId) {
  const result = await db.query(`SELECT DISTINCT ON(e.cost_code_id) e.cost_code_id,b.source_filename,e.source_row_number,e.selected_hierarchy_evidence FROM cost_code_import_row_evidence e JOIN cost_code_import_batches b ON b.id=e.batch_id WHERE e.client_id=$1 ORDER BY e.cost_code_id,e.created_at DESC`, [clientId]);
  return new Map(result.rows.map((row) => [row.cost_code_id, { import: { sourceFilename: row.source_filename, sourceRowNumber: row.source_row_number, hierarchyEvidence: row.selected_hierarchy_evidence || {} } }]));
}

function withAuthoritativeEvidence(rows, evidence) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row, sourceEvidence: evidence.get(clean(row.id || row.costCodeId)) || {} }));
}

function previewDocument(structure, inputRows = []) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const byId = new Map(structure.costCodes.map((row) => [String(row.id), row]));
  const seen = new Set();
  const resolved = rows.slice(0, 501).map((input, index) => {
    const rowNumber = Number(input.rowNumber) || index + 2;
    const id = String(input.id ?? input.costCodeId ?? '');
    // Cost Code and Description are protected identity evidence. Preserve them
    // byte-for-byte through the worksheet round-trip; hierarchy labels below
    // deliberately retain their existing user-input normalization.
    const code = String(input.code ?? '');
    const description = String(input.description ?? '');
    const version = Number(input.version);
    const commercialHead = clean(input.commercialHead);
    const commercialFamily = clean(input.commercialFamily);
    const reportingGroup = clean(input.reportingGroup);
    const reviewDecision = normalizeDecision(input.reviewDecision);
    const sourceEvidence = input.sourceEvidence && typeof input.sourceEvidence === 'object' ? input.sourceEvidence : {};
    let blocker = null;
    if (!UUID.test(id)) blocker = 'Cost Code ID is invalid.';
    else if (seen.has(id)) blocker = 'Cost Code is duplicated in the worksheet.';
    seen.add(id);
    const current = byId.get(id);
    if (!blocker && !current) blocker = 'Cost Code is unknown for this company.';
    if (!blocker && current.is_active === false) blocker = 'Inactive Cost Codes cannot be reviewed through this worksheet.';
    if (!blocker && (!same(current.code, code) || !same(current.description, description))) blocker = 'Cost Code identity or description no longer matches the server record.';
    if (!blocker && Number(current.version) !== version) blocker = 'Cost Code changed after this worksheet was exported.';
    const before = current ? currentHierarchy(structure, current) : { path: {}, labels: {}, state: 'unknown', valid: false };
    let action = 'blocked'; let resolution = null; let after = before;
    const hasTarget = Boolean(commercialHead || commercialFamily || reportingGroup);
    if (!blocker && reviewDecision === 'invalid') blocker = 'Review Decision must be blank, Keep Existing or Not Applicable.';
    if (!blocker && reviewDecision === 'not_applicable') {
      if (hasTarget) blocker = 'Not Applicable requires blank hierarchy target columns.';
      else { action = before.state === 'not_applicable' ? 'unchanged' : 'not_applicable'; after = { path: { commercialHeadId: null, commercialFamilyId: null, reportingGroupId: null }, labels: { commercialHead: '', commercialFamily: '', reportingGroup: '' }, state: 'not_applicable', valid: true }; }
    } else if (!blocker && reviewDecision === 'keep_existing') {
      if (hasTarget && (!same(commercialHead, before.labels.commercialHead) || !same(commercialFamily, before.labels.commercialFamily) || !same(reportingGroup, before.labels.reportingGroup))) blocker = 'Keep Existing cannot change the current hierarchy path.';
      else if (!before.valid && before.state !== 'not_applicable') blocker = 'This Cost Code has no valid reviewed hierarchy to keep.';
      else action = 'unchanged';
    } else if (!blocker && hasTarget) {
      resolution = resolvePath(structure, { commercialHead, commercialFamily, reportingGroup });
      if (BLOCKED.has(resolution.state) || resolution.state === STATES.UNALLOCATED) blocker = resolution.reason || 'Hierarchy path is invalid.';
      else {
        after = { path: resolution.path || {}, labels: resolution.labels || resolution.proposal, state: 'allocated', valid: true };
        const unchanged = resolution.state === STATES.MATCHED && before.valid && before.path.commercialHeadId === resolution.path.commercialHeadId && (before.path.commercialFamilyId || null) === (resolution.path.commercialFamilyId || null) && before.path.reportingGroupId === resolution.path.reportingGroupId;
        action = unchanged ? 'unchanged' : 'allocate';
      }
    } else if (!blocker && (before.valid || before.state === 'not_applicable')) action = 'unchanged';
    else if (!blocker) blocker = 'Choose a complete hierarchy path or mark this Cost Code Not Applicable.';
    if (blocker) resolution = { state: STATES.INVALID, reason: blocker };
    return { rowNumber, id, code, description, version, reviewDecision, action, before, after, resolution, sourceEvidence, blocker };
  });
  if (rows.length > 500) resolved.push({ rowNumber: 0, id: '', code: '', description: '', version: 0, action: 'blocked', before: {}, after: {}, resolution: { state: STATES.INVALID, reason: 'Worksheet cannot contain more than 500 Cost Codes.' }, sourceEvidence: {}, blocker: 'Worksheet cannot contain more than 500 Cost Codes.' });
  const proposals = consolidateProposals(resolved);
  const summary = {
    rowsReviewed: resolved.length,
    unchanged: resolved.filter((row) => row.action === 'unchanged').length,
    allocations: resolved.filter((row) => row.action === 'allocate').length,
    notApplicable: resolved.filter((row) => row.action === 'not_applicable').length,
    existingPathsMatched: resolved.filter((row) => row.action === 'allocate' && row.resolution?.state === STATES.MATCHED).length,
    newHeads: new Set(proposals.map((item) => key(item.commercialHead))).size,
    newFamilies: new Set(proposals.filter((item) => item.commercialFamily).map((item) => `${key(item.commercialHead)}::${key(item.commercialFamily)}`)).size,
    newReportingGroups: proposals.length,
    blockers: resolved.filter((row) => row.blocker).length,
    warnings: 0,
  };
  return { catalogueRevision: catalogueToken(structure), rows: resolved, proposals, summary };
}

async function exportWorksheet(clientId, auth) {
  assertServicePermission(auth, PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE);
  if (String(auth.clientId) !== String(clientId)) return fail(403, 'Tenant boundary violation.');
  const db = await pool.connect();
  try {
    const structure = await loadHierarchyAuthority(db, clientId);
    const evidenceByCode = await authoritativeSourceEvidence(db, clientId);
    return { ok: true, document: { catalogueRevision: catalogueToken(structure), rows: structure.costCodes.filter((row) => row.is_active).map((row) => { const current = currentHierarchy(structure, row); const source = evidenceByCode.get(row.id); return { id: row.id, code: String(row.code), description: row.description || '', version: Number(row.version), currentReviewState: current.state, currentCommercialHead: current.labels.commercialHead, currentCommercialFamily: current.labels.commercialFamily, currentReportingGroup: current.labels.reportingGroup, sourceEvidence: { legacy: { subHeading: row.sub_heading || null, trade: row.trade || null, element: row.element || null }, ...(source || {}) } }; }) } };
  } finally { db.release(); }
}

async function preview(clientId, body, auth) {
  assertServicePermission(auth, PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE);
  if (String(auth.clientId) !== String(clientId)) return fail(403, 'Tenant boundary violation.');
  const db = await pool.connect();
  try { const document = previewDocument(await loadHierarchyAuthority(db, clientId), withAuthoritativeEvidence(body.rows, await authoritativeSourceEvidence(db, clientId))); document.sourceFilename = clean(body.sourceFilename) || 'Cost Code hierarchy mapping.xlsx'; document.reviewToken = signEvidence('cost-code-hierarchy-worksheet', reviewedEvidence(document)); return { ok: true, preview: document }; }
  finally { db.release(); }
}

async function apply(clientId, body, auth) {
  assertServicePermission(auth, PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE);
  if (String(auth.clientId) !== String(clientId)) return fail(403, 'Tenant boundary violation.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const structure = await loadHierarchyAuthority(db, clientId, { lock: true });
    const current = previewDocument(structure, withAuthoritativeEvidence(body.rows, await authoritativeSourceEvidence(db, clientId)));
    if (current.summary.blockers) { await db.query('ROLLBACK'); return fail(400, 'Worksheet contains unresolved hierarchy rows.'); }
    if (!body.catalogueRevision || body.catalogueRevision !== current.catalogueRevision) { await db.query('ROLLBACK'); return fail(409, 'Commercial Structure changed after preview. Preview the worksheet again.'); }
    if (!evidenceMatches('cost-code-hierarchy-worksheet', reviewedEvidence(current), body.reviewToken)) { await db.query('ROLLBACK'); return fail(409, 'The worksheet differs from the reviewed preview. Preview it again.'); }
    const digest = crypto.createHash('sha256').update(JSON.stringify(reviewedEvidence(current))).digest('hex');
    const sourceFilename = clean(body.sourceFilename) || 'Cost Code hierarchy mapping.xlsx';
    const batch = (await db.query(`INSERT INTO cost_code_import_batches(client_id,source_filename,reviewed_rows_digest,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [clientId, sourceFilename, digest, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey])).rows[0];
    const pathCache = new Map(); let updated = 0;
    for (const row of current.rows) {
      const existing = structure.costCodes.find((item) => String(item.id) === row.id);
      let target = null;
      if (row.action === 'allocate') {
        if (row.resolution.state === STATES.MATCHED) target = { h: { id: row.resolution.path.commercialHeadId, name: row.resolution.labels.commercialHead }, f: row.resolution.path.commercialFamilyId ? { id: row.resolution.path.commercialFamilyId, name: row.resolution.labels.commercialFamily } : null, g: { id: row.resolution.path.reportingGroupId, name: row.resolution.labels.reportingGroup } };
        else { const cacheKey = [key(row.resolution.proposal.commercialHead), key(row.resolution.proposal.commercialFamily), key(row.resolution.proposal.reportingGroup)].join('::'); if (!pathCache.has(cacheKey)) pathCache.set(cacheKey, await createPath(db, clientId, row.resolution.proposal, auth, 'hierarchy_mapping_worksheet')); target = pathCache.get(cacheKey); }
      }
      if (row.action === 'allocate' || row.action === 'not_applicable') {
        const before = { commercialHeadId: existing.commercial_head_id, commercialFamilyId: existing.commercial_family_id, reportingGroupId: existing.reporting_group_id, reviewDisposition: existing.hierarchy_review_disposition };
        const after = row.action === 'allocate' ? { commercialHeadId: target.h.id, commercialFamilyId: target.f?.id || null, reportingGroupId: target.g.id, reviewDisposition: null } : { commercialHeadId: null, commercialFamilyId: null, reportingGroupId: null, reviewDisposition: 'not_applicable' };
        const changed = await db.query(`UPDATE cost_codes SET commercial_head=$1,commercial_family=$2,reporting_group=$3,commercial_head_id=$4,commercial_family_id=$5,reporting_group_id=$6,hierarchy_mode=$7,hierarchy_review_disposition=$8,hierarchy_reviewed_at=NOW(),hierarchy_reviewed_by_user_id=$9,hierarchy_reviewed_by_membership_id=$10,hierarchy_reviewed_by_provider_user_id=$11,hierarchy_reviewed_by_display_name=$12,hierarchy_reviewed_by_role_key=$13,version=version+1,updated_at=NOW(),updated_by=$12 WHERE client_id=$14 AND id=$15 AND version=$16 RETURNING version`, [target?.h?.name || null, target?.f?.name || null, target?.g?.name || null, after.commercialHeadId, after.commercialFamilyId, after.reportingGroupId, target ? (target.f ? 'three-level' : 'two-level') : null, after.reviewDisposition, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey, clientId, row.id, row.version]);
        if (!changed.rowCount) { await db.query('ROLLBACK'); return fail(409, `Cost Code ${row.code} changed after preview.`); }
        await db.query(`INSERT INTO cost_code_hierarchy_review_audit(client_id,cost_code_id,operation,before_document,after_document,resulting_cost_code_version,actor_user_id,actor_membership_id,actor_provider_user_id,actor_display_name,actor_role_key,actor_permission_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [clientId, row.id, row.action === 'allocate' ? 'allocate' : 'mark_not_applicable', JSON.stringify(before), JSON.stringify(after), changed.rows[0].version, auth.userId, auth.membershipId, auth.providerUserId, auth.displayName, auth.roleKey, PERMISSIONS.COMMERCIAL_STRUCTURE_MANAGE]);
        updated += 1;
      }
      await db.query(`INSERT INTO cost_code_import_row_evidence(client_id,batch_id,cost_code_id,source_row_number,source_code,source_description,selected_hierarchy_evidence,selected_target_mapping) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [clientId, batch.id, row.id, row.rowNumber, row.code, row.description, JSON.stringify(row.sourceEvidence || {}), JSON.stringify({ workflow: 'hierarchy_mapping_worksheet', action: row.action, commercialHead: row.after?.labels?.commercialHead || null, commercialFamily: row.after?.labels?.commercialFamily || null, reportingGroup: row.after?.labels?.reportingGroup || null })]);
    }
    await db.query('COMMIT');
    return { ok: true, summary: { ...current.summary, updated, batchId: batch.id } };
  } catch (error) { await db.query('ROLLBACK'); if (error.code === '23505') return fail(409, 'Commercial Structure or Cost Code changed after preview. Preview again.'); throw error; }
  finally { db.release(); }
}

module.exports = { normalizeDecision, reviewedEvidence, previewDocument, exportWorksheet, preview, apply };
