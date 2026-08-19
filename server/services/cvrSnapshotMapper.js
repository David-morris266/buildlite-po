/**
 * BL-031E.3B — Map persisted CVR snapshot header + rows to the API document.
 * Historic client rendering is E.4; this mapper only exposes the stored facts.
 */

const { toIso, toNumberOrNull } = require("./cvrPeriodMapper");
const { emptyCommentary } = require("./cvrPeriodConstants");

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

function commentaryOf(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const base = emptyCommentary();
  return {
    keyCommercialIssues: String(value.keyCommercialIssues || base.keyCommercialIssues),
    commercialOpportunities: String(
      value.commercialOpportunities || base.commercialOpportunities
    ),
    financialRisks: String(value.financialRisks || base.financialRisks),
    actionsBeforeNextCvr: String(value.actionsBeforeNextCvr || base.actionsBeforeNextCvr),
  };
}

function sourceReadinessOf(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function snapshotRowToDocument(row) {
  if (!row) return null;
  const metadata =
    row.display_metadata && typeof row.display_metadata === "object"
      ? row.display_metadata
      : {};
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    costCodeKey: row.cost_code_key,
    costCodeLabel: row.cost_code_label,
    description: row.description || "",
    commercialHead: row.commercial_head || "",
    commercialFamily: row.commercial_family || "",
    trade: row.trade || "",
    active: row.active !== false,
    originalBudget: toNumberOrNull(row.original_budget),
    currentBudget: toNumberOrNull(row.current_budget),
    commercialAdjustment: toNumber(row.commercial_adjustment, 0),
    adjustmentReason: row.adjustment_reason || "",
    manualAccrual: toNumber(row.manual_accrual, 0),
    notes: row.notes || "",
    committed: toNumber(row.committed, 0),
    certified: toNumber(row.certified, 0),
    actualCost: toNumber(row.actual_cost, 0),
    currentCost: toNumber(row.current_cost, 0),
    systemForecast: toNumber(row.system_forecast, 0),
    finalForecast: toNumber(row.final_forecast, 0),
    costToComplete: toNumber(row.cost_to_complete, 0),
    outstandingCertified: toNumber(row.outstanding_certified, 0),
    variance: toNumber(row.variance, 0),
    displayMetadata: metadata,
    adjustmentHistory: Array.isArray(metadata.adjustmentHistory)
      ? metadata.adjustmentHistory
      : [],
  };
}

function snapshotHeaderToDocument(header, rows = []) {
  if (!header) return null;
  return {
    id: header.id,
    clientId: header.client_id,
    developmentId: header.development_id,
    periodId: header.period_id,
    periodKey: header.period_key,
    schemaVersion: Number(header.schema_version) || 1,
    commentary: commentaryOf(header.commentary),
    sourceReadiness: sourceReadinessOf(header.source_readiness),
    currentBudget: toNumber(header.current_budget, 0),
    committed: toNumber(header.committed, 0),
    certified: toNumber(header.certified, 0),
    actualCost: toNumber(header.actual_cost, 0),
    manualAccrual: toNumber(header.manual_accrual, 0),
    currentCost: toNumber(header.current_cost, 0),
    systemForecast: toNumber(header.system_forecast, 0),
    commercialAdjustment: toNumber(header.commercial_adjustment, 0),
    finalForecast: toNumber(header.final_forecast, 0),
    costToComplete: toNumber(header.cost_to_complete, 0),
    outstandingCertified: toNumber(header.outstanding_certified, 0),
    variance: toNumber(header.variance, 0),
    createdAt: toIso(header.created_at),
    createdBy: header.created_by ?? null,
    rows: (rows || []).map(snapshotRowToDocument).filter(Boolean),
  };
}

module.exports = {
  snapshotHeaderToDocument,
  snapshotRowToDocument,
};
