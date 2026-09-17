/**
 * BL-032A — Map development_revenue_settings rows to API documents.
 */

const {
  DEFAULT_REVENUE_RECOGNITION_POLICY,
  LOCAL_RECORD_SCHEMA_VERSION,
  emptySettingsDocument,
} = require("./revenueSettingsConstants");
const {
  normalizeHouseTypePricing,
  normalizeRevenueStrategy,
} = require("./revenueSettingsValidation");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function emptyDocument(developmentId) {
  const defaults = emptySettingsDocument();
  return {
    id: null,
    developmentId,
    exists: false,
    recognitionPolicy: defaults.recognitionPolicy,
    revenueMode: defaults.revenueMode,
    summaryRevenueLines: defaults.summaryRevenueLines,
    revenueStrategy: defaults.revenueStrategy,
    houseTypePricing: defaults.houseTypePricing,
    revenueAdjustments: defaults.revenueAdjustments,
    recognitionSettings: defaults.recognitionSettings,
    version: 0,
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
  };
}

function settingsRowToDocument(row, developmentId) {
  if (!row) return emptyDocument(developmentId);
  const errors = [];
  return {
    id: row.id,
    developmentId: row.development_id,
    exists: true,
    recognitionPolicy: row.recognition_policy || DEFAULT_REVENUE_RECOGNITION_POLICY,
    revenueMode: row.revenue_mode === "summary" ? "summary" : "sales_register",
    summaryRevenueLines: Array.isArray(row.summary_revenue_lines) ? row.summary_revenue_lines : [],
    revenueStrategy: normalizeRevenueStrategy(row.strategy, errors),
    houseTypePricing: normalizeHouseTypePricing(row.house_type_pricing, errors),
    revenueAdjustments: Array.isArray(row.revenue_adjustments) ? row.revenue_adjustments : [],
    recognitionSettings:
      row.recognition_settings && typeof row.recognition_settings === "object"
        ? row.recognition_settings
        : {},
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    updatedByMembershipId: row.updated_by_membership_id ?? null,
    updatedByProviderUserId: row.updated_by_provider_user_id ?? null,
    metadata: {
      version: LOCAL_RECORD_SCHEMA_VERSION,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    },
  };
}

module.exports = {
  emptyDocument,
  settingsRowToDocument,
};
