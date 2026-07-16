/**
 * BL-019C.4.1 — Single revenue pricing model for the entire workspace.
 */

import {
  buildHouseTypePricingMap,
  buildHouseTypePricingRows,
  buildStrategySummaryMetrics,
  enrichPlotsWithPricing,
  mapPricedPlotsToOverrideRows,
} from './revenueStrategyCalculations';

export function buildRevenuePricingModel({
  plots = [],
  strategy = {},
  houseTypePricing = {},
} = {}) {
  const mergedHouseTypes = buildHouseTypePricingMap(plots, houseTypePricing);
  const pricedPlots = enrichPlotsWithPricing(plots, strategy, mergedHouseTypes);
  const strategyMetrics = buildStrategySummaryMetrics(plots, strategy, mergedHouseTypes);
  const houseTypeRows = buildHouseTypePricingRows(plots, strategy, mergedHouseTypes);
  const plotOverrideRows = mapPricedPlotsToOverrideRows(pricedPlots);

  return {
    plots,
    strategy,
    houseTypePricing: mergedHouseTypes,
    pricedPlots,
    strategyMetrics,
    houseTypeRows,
    plotOverrideRows,
  };
}
