/**
 * BL-019C.4 — Extended developer diagnostics for revenue integration.
 */

import { countPlotsByTenure } from './plotPricingTenure';
import { auditPlotPricingSources } from './revenuePricingValidation';
import { countRevenueSources } from './revenueSourceMigration';

export function buildRevenueDiagnostics({
  plots = [],
  strategyMetrics = {},
  houseTypePricing = {},
  lastWorkflowStats = null,
} = {}) {
  const sources = countRevenueSources(plots);
  const tenure = countPlotsByTenure(plots);
  const pricingAudit = auditPlotPricingSources(plots);

  return {
    plotCount: plots.length,
    sources,
    tenure,
    pricingAudit,
    garagePremiumTotal: strategyMetrics.totalGaragePremium ?? 0,
    plotPremiumTotal: strategyMetrics.totalPlotPremium ?? 0,
    averageOmPerFt2: strategyMetrics.averageOmPerFt2 ?? 0,
    averageAhPercent: strategyMetrics.averageAhPercentOfOm ?? 0,
    protectedManualOverrides: strategyMetrics.manualOverrideCount ?? sources.manualValue,
    plotsRecalculated:
      lastWorkflowStats?.plotsRecalculated ??
      lastWorkflowStats?.updatedCount ??
      0,
    plotsSkipped: lastWorkflowStats?.skippedCount ?? 0,
    skipReason: lastWorkflowStats?.skipReason ?? null,
    houseTypesUpdated:
      lastWorkflowStats?.houseTypeCount ?? Object.keys(houseTypePricing).length,
    lastRecalculationTime: lastWorkflowStats?.recalculatedAt ?? null,
  };
}
