const { isDeepStrictEqual } = require('node:util');

const BLOCK_CODE = 'PLOT_MASTER_UPDATE_BLOCKED_SUBMITTED_CVR';
const BLOCK_MESSAGE = 'The Plot Master cannot be changed while a Site Start or monthly CVR is Submitted. Reject or Approve & Lock that period first.';

async function lockPlotMasterAuthority(dbClient, clientId, developmentId) {
  await dbClient.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [`plot-master:${clientId}:${developmentId}`]
  );
}

async function submittedPeriod(dbClient, clientId, developmentId) {
  const result = await dbClient.query(
    `SELECT id, period_key, period_type
       FROM cvr_periods
      WHERE client_id = $1
        AND development_id = $2
        AND COALESCE(period_type, 'monthly_cvr') IN ('site_start', 'monthly_cvr')
        AND status = 'submitted'
      ORDER BY CASE WHEN period_type = 'site_start' THEN 0 ELSE 1 END, period_key
      LIMIT 1`,
    [clientId, developmentId]
  );
  return result.rows[0] || null;
}

function changesPlotMaster(existingDocument, patch = {}) {
  if (!Object.prototype.hasOwnProperty.call(patch, 'plotMaster')) return false;
  return !isDeepStrictEqual(existingDocument?.plotMaster, patch.plotMaster);
}

async function enforcePlotMasterMutationAuthority(dbClient, clientId, developmentId, existingDocument, patch) {
  if (!changesPlotMaster(existingDocument, patch)) return { ok: true, changed: false };
  const period = await submittedPeriod(dbClient, clientId, developmentId);
  if (!period) return { ok: true, changed: true };
  return { ok: false, changed: true, status: 409, code: BLOCK_CODE, message: BLOCK_MESSAGE, period };
}

module.exports = {
  BLOCK_CODE,
  BLOCK_MESSAGE,
  changesPlotMaster,
  enforcePlotMasterMutationAuthority,
  lockPlotMasterAuthority,
  submittedPeriod,
};
