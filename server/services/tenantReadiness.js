const db = require('../db');

const PILOT_READINESS_POLICY = 'gp10_company_readiness_v1';

function evaluateTenantReadiness(counts = {}) {
  const normalized = {
    companySettings: Number(counts.companySettings || 0),
    activeCostCodes: Number(counts.activeCostCodes || 0),
    allocatedCostCodes: Number(counts.allocatedCostCodes || 0),
    notApplicableCostCodes: Number(counts.notApplicableCostCodes || 0),
    notReviewedCostCodes: Number(counts.notReviewedCostCodes || 0),
    needsAttentionCostCodes: Number(counts.needsAttentionCostCodes || 0),
    activeHeads: Number(counts.activeHeads || 0),
    categorizedHeads: Number(counts.categorizedHeads || 0),
    discoveryHeads: Number(counts.discoveryHeads || 0),
    developments: Number(counts.developments || 0),
    purchaseOrders: Number(counts.purchaseOrders || 0),
    packages: Number(counts.packages || 0),
    certificates: Number(counts.certificates || 0),
    cvrPeriods: Number(counts.cvrPeriods || 0),
  };
  const hasOperationalHistory = normalized.purchaseOrders > 0 || normalized.packages > 0 ||
    normalized.certificates > 0 || normalized.cvrPeriods > 0;
  const companySettingsReady = normalized.companySettings > 0;
  const hierarchyReviewComplete = normalized.activeCostCodes > 0 &&
    normalized.notReviewedCostCodes === 0 && normalized.needsAttentionCostCodes === 0 &&
    normalized.allocatedCostCodes + normalized.notApplicableCostCodes === normalized.activeCostCodes;
  const commercialStructureReady = normalized.activeHeads > 0 && hierarchyReviewComplete;
  const headCategoriesReviewed = normalized.discoveryHeads === 2;
  const commerciallyReady = companySettingsReady && commercialStructureReady && headCategoriesReviewed;
  const configured = hasOperationalHistory || (commerciallyReady && normalized.developments > 0);
  const reasons = [];
  if (!companySettingsReady) reasons.push('company_settings_required');
  if (normalized.activeHeads === 0) reasons.push('commercial_structure_required');
  if (normalized.activeCostCodes === 0) reasons.push('active_cost_codes_required');
  if (normalized.notReviewedCostCodes > 0) reasons.push('cost_code_review_required');
  if (normalized.needsAttentionCostCodes > 0) reasons.push('cost_code_attention_required');
  if (normalized.activeHeads > 0 && !headCategoriesReviewed) reasons.push('head_category_review_required');
  if (normalized.developments === 0) reasons.push('development_required');

  return {
    policy: PILOT_READINESS_POLICY,
    configured,
    establishedOperationalTenant: hasOperationalHistory,
    companyExists: Boolean(counts.tenant?.name),
    companySettingsReady,
    commercialStructureReady,
    hierarchyReviewComplete,
    headCategoriesReviewed,
    commerciallyReady,
    developmentExists: normalized.developments > 0,
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
       (SELECT COUNT(*) FROM tenant_company_settings WHERE client_id = $1) AS company_settings,
       (SELECT COUNT(*) FROM cost_codes WHERE client_id = $1 AND is_active = TRUE) AS active_cost_codes,
       (SELECT COUNT(*) FROM cost_codes c JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id AND h.is_active LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id WHERE c.client_id=$1 AND c.is_active=TRUE AND (c.commercial_family_id IS NULL OR (f.is_active AND f.head_id=h.id)) AND (c.reporting_group_id IS NULL OR (g.is_active AND g.head_id=h.id AND g.family_id IS NOT DISTINCT FROM c.commercial_family_id))) AS allocated_cost_codes,
       (SELECT COUNT(*) FROM cost_codes WHERE client_id=$1 AND is_active=TRUE AND commercial_head_id IS NULL AND commercial_family_id IS NULL AND reporting_group_id IS NULL AND hierarchy_review_disposition='not_applicable') AS not_applicable_cost_codes,
       (SELECT COUNT(*) FROM cost_codes WHERE client_id=$1 AND is_active=TRUE AND commercial_head_id IS NULL AND commercial_family_id IS NULL AND reporting_group_id IS NULL AND hierarchy_review_disposition IS NULL) AS not_reviewed_cost_codes,
       (SELECT COUNT(*) FROM cost_codes c LEFT JOIN commercial_structure_heads h ON h.client_id=c.client_id AND h.id=c.commercial_head_id LEFT JOIN commercial_structure_families f ON f.client_id=c.client_id AND f.id=c.commercial_family_id LEFT JOIN commercial_structure_reporting_groups g ON g.client_id=c.client_id AND g.id=c.reporting_group_id WHERE c.client_id=$1 AND c.is_active=TRUE AND (c.commercial_head_id IS NOT NULL OR c.commercial_family_id IS NOT NULL OR c.reporting_group_id IS NOT NULL) AND NOT(c.commercial_head_id IS NOT NULL AND h.id IS NOT NULL AND h.is_active AND (c.commercial_family_id IS NULL OR (f.id IS NOT NULL AND f.is_active AND f.head_id=h.id)) AND (c.reporting_group_id IS NULL OR (g.id IS NOT NULL AND g.is_active AND g.head_id=h.id AND g.family_id IS NOT DISTINCT FROM c.commercial_family_id)))) AS needs_attention_cost_codes,
       (SELECT COUNT(*) FROM commercial_structure_heads WHERE client_id=$1 AND is_active=TRUE) AS active_heads,
       (SELECT COUNT(*) FROM commercial_structure_heads WHERE client_id=$1 AND is_active=TRUE AND buildlite_category IS NOT NULL) AS categorized_heads,
       (SELECT COUNT(*) FROM commercial_structure_heads WHERE client_id=$1 AND is_active=TRUE AND buildlite_category IN('PRELIMINARIES','SELLING_COSTS')) AS discovery_heads,
       (SELECT COUNT(*) FROM developments WHERE client_id = $1) AS developments,
       (SELECT COUNT(*) FROM purchase_orders WHERE client_id = $1) AS purchase_orders,
       (SELECT COUNT(*) FROM packages WHERE client_id = $1) AS packages,
       (SELECT COUNT(*) FROM package_payment_certificates WHERE client_id = $1) AS certificates,
       (SELECT COUNT(*) FROM cvr_periods WHERE client_id = $1) AS cvr_periods`,
    [clientId]
  );
  const row = rows[0] || {};
  return evaluateTenantReadiness({
    companySettings: row.company_settings,
    activeCostCodes: row.active_cost_codes,
    allocatedCostCodes: row.allocated_cost_codes,
    notApplicableCostCodes: row.not_applicable_cost_codes,
    notReviewedCostCodes: row.not_reviewed_cost_codes,
    needsAttentionCostCodes: row.needs_attention_cost_codes,
    activeHeads: row.active_heads,
    categorizedHeads: row.categorized_heads,
    discoveryHeads: row.discovery_heads,
    developments: row.developments,
    purchaseOrders: row.purchase_orders,
    packages: row.packages,
    certificates: row.certificates,
    cvrPeriods: row.cvr_periods,
    tenant: { code: row.client_code || null, name: row.client_name || null },
  });
}

module.exports = { PILOT_READINESS_POLICY, evaluateTenantReadiness, getTenantReadiness };
