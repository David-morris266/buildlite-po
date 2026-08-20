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

function snapshotPlotToDocument(row) {
  if (!row) return null;
  const metadata =
    row.display_metadata && typeof row.display_metadata === "object"
      ? row.display_metadata
      : {};
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    plotId: row.plot_id,
    plotNumber: row.plot_number || "",
    houseType: row.house_type || "",
    tenure: row.tenure || "",
    revenueCategory: row.revenue_category || "",
    revenueStatus: row.revenue_status || "",
    revenueSource: row.revenue_source || "",
    forecastRevenue: toNumber(row.forecast_revenue, 0),
    securedRevenue: toNumber(row.secured_revenue, 0),
    remainingForecastRevenue: toNumber(row.remaining_forecast_revenue, 0),
    sellingPrice: toNumberOrNull(row.selling_price),
    derivedForecast: toNumber(row.derived_forecast, 0),
    plotPremium: toNumber(row.plot_premium, 0),
    niaFt2: toNumber(row.nia_ft2, 0),
    effectiveGarage: row.effective_garage || "None",
    reservedAt: row.reserved_at || null,
    exchangedAt: row.exchanged_at || null,
    completedAt: row.completed_at || null,
    displayMetadata: metadata,
  };
}

function snapshotHeaderToDocument(header, rows = [], plots = []) {
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
    forecastRevenue: toNumberOrNull(header.forecast_revenue),
    securedRevenue: toNumberOrNull(header.secured_revenue),
    remainingForecastRevenue: toNumberOrNull(header.remaining_forecast_revenue),
    plotsSold: header.plots_sold == null ? null : Number(header.plots_sold),
    plotsRemaining: header.plots_remaining == null ? null : Number(header.plots_remaining),
    grossProfit: toNumberOrNull(header.gross_profit),
    grossMarginPercent:
      header.gross_margin_percent == null ? null : Number(header.gross_margin_percent),
    revenueAssumptions:
      header.revenue_assumptions && typeof header.revenue_assumptions === "object"
        ? header.revenue_assumptions
        : null,
    revenueSettingsId: header.revenue_settings_id ?? null,
    revenueSettingsVersion:
      header.revenue_settings_version == null ? null : Number(header.revenue_settings_version),
    createdAt: toIso(header.created_at),
    createdBy: header.created_by ?? null,
    rows: (rows || []).map(snapshotRowToDocument).filter(Boolean),
    plots: (plots || []).map(snapshotPlotToDocument).filter(Boolean),
  };
}

module.exports = {
  snapshotHeaderToDocument,
  snapshotRowToDocument,
  snapshotPlotToDocument,
};
