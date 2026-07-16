/**
 * BL-019C.2 — Revenue source migration helpers.
 */

import { roundPlotMoney } from '../developments/plotCommercial';
import { DEFAULT_REVENUE_SOURCE } from './revenueTypes';

export function isGenuineManualOverride(plot = {}) {
  if (plot.manualOverrideExplicit) return true;
  if (
    String(plot.revenueSource || '').trim() === 'Manual Value' &&
    roundPlotMoney(plot.manualForecastValue) > 0 &&
    !plot.pricingMigrated
  ) {
    return true;
  }
  return false;
}

export function isMisclassifiedManualPlot(plot = {}) {
  return String(plot.revenueSource || '').trim() === 'Manual Value' && !isGenuineManualOverride(plot);
}

export function migrateSinglePlotPricing(plot = {}) {
  if (plot.pricingMigrated && !isMisclassifiedManualPlot(plot)) {
    return plot;
  }

  if (isMisclassifiedManualPlot(plot)) {
    return {
      ...plot,
      revenueSource: DEFAULT_REVENUE_SOURCE,
      manualForecastValue: 0,
      manualOverrideExplicit: false,
      pricingMigrated: true,
    };
  }

  if (isGenuineManualOverride(plot)) {
    return {
      ...plot,
      revenueSource: 'Manual Value',
      manualForecastValue: roundPlotMoney(
        plot.manualForecastValue || plot.forecastSellingPrice || plot.sellingPrice
      ),
      manualOverrideExplicit: true,
      pricingMigrated: true,
    };
  }

  return {
    ...plot,
    revenueSource: DEFAULT_REVENUE_SOURCE,
    manualForecastValue: 0,
    manualOverrideExplicit: false,
    pricingMigrated: true,
  };
}

export function countRevenueSources(plots = []) {
  const counts = {
    total: plots.length,
    houseType: 0,
    developmentStrategy: 0,
    plotOverride: 0,
    manualValue: 0,
    misclassifiedManual: 0,
  };

  for (const plot of plots) {
    const source = String(plot.revenueSource || DEFAULT_REVENUE_SOURCE).trim();
    if (source === 'House Type') counts.houseType += 1;
    else if (source === 'Development Strategy') counts.developmentStrategy += 1;
    else if (source === 'Plot Override') counts.plotOverride += 1;
    else if (source === 'Manual Value') counts.manualValue += 1;
    if (isMisclassifiedManualPlot(plot)) counts.misclassifiedManual += 1;
  }

  return counts;
}

// BL-019C.2 TEMP — remove before commit
export function logRevenueSourceDiagnostics(developmentId, plots = []) {
  const counts = countRevenueSources(plots);
  console.info('[BL-019C.2 Revenue Source Diagnostics]', {
    developmentId,
    plots: counts.total,
    houseType: counts.houseType,
    developmentStrategy: counts.developmentStrategy,
    plotOverride: counts.plotOverride,
    manualValue: counts.manualValue,
    misclassifiedManual: counts.misclassifiedManual,
  });
}

export function countEligiblePlots(plots = [], predicate) {
  return plots.filter(predicate).length;
}
