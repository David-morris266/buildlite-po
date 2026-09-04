const db = require('../db');

const PILOT_READINESS_POLICY = 'gp1_pilot_v1';

function evaluateTenantReadiness(counts = {}) {
  const normalized = {
    activeCostCodes: Number(counts.activeCostCodes || 0),
    developments: Number(counts.developments || 0),
    purchaseOrders: Number(counts.purchaseOrders || 0),
    packages: Number(counts.packages || 0),
    certificates: Number(counts.certificates || 0),
    cvrPeriods: Number(counts.cvrPeriods || 0),
  };
  const hasOperationalHistory =
    normalized.purchaseOrders > 0 ||
    normalized.packages > 0 ||
    normalized.certificates > 0 ||
    normalized.cvrPeriods > 0;
  const hasPilotMinimum =
    normalized.activeCostCodes > 0 && normalized.developments > 0;
  const configured = hasOperationalHistory || hasPilotMinimum;
  const reasons = [];
  if (!configured && normalized.activeCostCodes === 0) reasons.push('active_cost_codes_required');
  if (!configured && normalized.developments === 0) reasons.push('development_required');

  return {
    policy: PILOT_READINESS_POLICY,
    configured,
    establishedOperationalTenant: hasOperationalHistory,
    reasons,
    counts: normalized,
    tenant: counts.tenant || null,
  };
}

async function getTenantReadiness(clientId, query = db.query) {
  const { rows } = await query(
    `SELECT
       (SELECT code FROM clients WHERE id = $1) AS client_code,
       (SELECT name FROM clients WHERE id = $1) AS client_name,
       (SELECT COUNT(*) FROM cost_codes WHERE client_id = $1 AND is_active = TRUE) AS active_cost_codes,
       (SELECT COUNT(*) FROM developments WHERE client_id = $1) AS developments,
       (SELECT COUNT(*) FROM purchase_orders WHERE client_id = $1) AS purchase_orders,
       (SELECT COUNT(*) FROM packages WHERE client_id = $1) AS packages,
       (SELECT COUNT(*) FROM package_payment_certificates WHERE client_id = $1) AS certificates,
       (SELECT COUNT(*) FROM cvr_periods WHERE client_id = $1) AS cvr_periods`,
    [clientId]
  );
  const row = rows[0] || {};
  return evaluateTenantReadiness({
    activeCostCodes: row.active_cost_codes,
    developments: row.developments,
    purchaseOrders: row.purchase_orders,
    packages: row.packages,
    certificates: row.certificates,
    cvrPeriods: row.cvr_periods,
    tenant: { code: row.client_code || null, name: row.client_name || null },
  });
}

module.exports = {
  PILOT_READINESS_POLICY,
  evaluateTenantReadiness,
  getTenantReadiness,
};
