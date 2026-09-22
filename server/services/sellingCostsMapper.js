/**
 * BL-034B — Map Selling Costs settings rows and build API proposal documents.
 * Calculated forecast £ is derived only — never read from persistence as authority.
 */

const {
  ASSUMPTION_SOURCES,
  DEFAULT_ASSUMPTION_PERCENT,
  SELLING_COSTS_MODES,
} = require("./sellingCostsConstants");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

function settingsRowToCore(row, developmentId) {
  if (!row) {
    return {
      exists: false,
      id: null,
      developmentId,
      mode: SELLING_COSTS_MODES.SIMPLE,
      assumptionPercent: DEFAULT_ASSUMPTION_PERCENT,
      assumptionPercentOverride: null,
      assumptionSource: ASSUMPTION_SOURCES.DEFAULT,
      destinationCostCodeKey: null,
      destinationCostCodeId: null,
      version: 0,
      createdAt: null,
      updatedAt: null,
      createdBy: null,
      updatedBy: null,
    };
  }

  return {
    exists: true,
    id: row.id,
    developmentId: row.development_id || developmentId,
    mode: row.mode || SELLING_COSTS_MODES.SIMPLE,
    assumptionPercent: toNumberOrNull(row.assumption_percent),
    assumptionPercentOverride: toNumberOrNull(row.assumption_percent),
    assumptionSource: ASSUMPTION_SOURCES.DEVELOPMENT,
    destinationCostCodeKey: row.destination_cost_code_key
      ? String(row.destination_cost_code_key).trim()
      : null,
    destinationCostCodeId: row.destination_cost_code_id || null,
    sourceTemplateId: row.source_template_id || null,
    sourceTemplateVersion: Number(row.source_template_version) || null,
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

function buildProposalDocument({
  settings,
  assumptionPercent,
  assumptionSource,
  forecastRevenue,
  forecastSellingCosts,
  revenue,
  destination,
  companyTemplate,
}) {
  return {
    mode: settings.mode || SELLING_COSTS_MODES.SIMPLE,
    assumptionSource,
    assumptionPercent,
    forecastRevenue,
    forecastSellingCosts,
    revenue,
    destination,
    companyTemplate: companyTemplate ? {id:companyTemplate.id,name:companyTemplate.name,version:companyTemplate.version,isDefault:companyTemplate.isDefault,simpleAssumptionPercent:companyTemplate.simpleAssumptionPercent,simpleDestination:companyTemplate.simpleDestination,lines:companyTemplate.lines||[]} : null,
    settings: {
      exists: Boolean(settings.exists),
      id: settings.id || null,
      version: Number(settings.version) || 0,
      destinationCostCodeKey: settings.destinationCostCodeKey || null,
      destinationCostCodeId: settings.destinationCostCodeId || null,
      sourceTemplateId: settings.sourceTemplateId || null,
      sourceTemplateVersion: settings.sourceTemplateVersion || null,
      updatedAt: settings.updatedAt || null,
      updatedBy: settings.updatedBy || null,
    },
  };
}

module.exports = {
  settingsRowToCore,
  buildProposalDocument,
  toNumberOrNull,
};
