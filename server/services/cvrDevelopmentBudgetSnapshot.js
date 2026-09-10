const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('./canonicalJsonIntegrity');
const { getAuthority } = require('./developmentBudgetRepository');
const { PERMISSIONS } = require('../auth/permissions');

async function liveDocument(db, clientId, developmentId) {
  const result = await getAuthority(clientId, developmentId, { userId: 'internal-cvr-budget-reader', permissions: [PERMISSIONS.COMMERCIAL_READ] }, db);
  if (!result.ok || !result.authority.exists) return null;
  const a = result.authority;
  return JSON.parse(JSON.stringify({ schemaVersion: 'cvr_development_budget_source_v1', calculationVersion: a.calculationVersion,
    dataVersion: a.dataVersion, canonicalAuthorityDigest: a.canonicalDigest,
    originalBudgetPence: Math.round(a.totalOriginalBudget * 100), currentBudgetPence: Math.round(a.totalCurrentBudget * 100),
    positions: a.perCostCode.map((p) => ({ costCodeId: p.costCodeId, costCode: p.costCode, description: p.description || '', originalPence: Math.round(p.originalBudget * 100), currentPence: Math.round(p.currentBudget * 100) })) }));
}
async function appendSubmission(db, { clientId, developmentId, periodId, actor }) {
  const document = await liveDocument(db, clientId, developmentId);
  if (!document) return { ok: false, message: 'Development Budget Authority is unavailable.' };
  const attempt = Number((await db.query('SELECT COALESCE(MAX(attempt_number),0)+1 n FROM cvr_period_budget_submissions WHERE client_id=$1 AND period_id=$2', [clientId, periodId])).rows[0].n);
  const hash = hashCanonicalJson(document);
  const row = (await db.query(`INSERT INTO cvr_period_budget_submissions(client_id,development_id,period_id,attempt_number,source_snapshot,source_snapshot_hash_scheme,source_snapshot_sha256,captured_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`, [clientId, developmentId, periodId, attempt, JSON.stringify(document), CANONICAL_JSON_SHA256_V1, hash, actor || null])).rows[0];
  return { ok: true, row, document, hash };
}
async function latest(db, clientId, periodId) { return (await db.query('SELECT * FROM cvr_period_budget_submissions WHERE client_id=$1 AND period_id=$2 ORDER BY attempt_number DESC LIMIT 1', [clientId, periodId])).rows[0] || null; }
async function compare(db, { clientId, developmentId, periodId }) {
  const submitted = await latest(db, clientId, periodId);
  if (!submitted) return { captured: false, stale: false, reasons: [] };
  const live = await liveDocument(db, clientId, developmentId);
  const integrity = verifyJsonIntegrity(submitted.source_snapshot, submitted.source_snapshot_sha256, submitted.source_snapshot_hash_scheme);
  const reasons = [];
  if (!integrity.valid) reasons.push('submitted_budget_snapshot_integrity_invalid');
  if (!live || hashCanonicalJson(live) !== submitted.source_snapshot_sha256) reasons.push('development_budget_changed');
  return { captured: true, stale: reasons.length > 0, reasons, submitted, live, integrity };
}
module.exports = { liveDocument, appendSubmission, latest, compare };
