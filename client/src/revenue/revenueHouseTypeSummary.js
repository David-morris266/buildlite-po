/**
 * BL-020A — Revenue by House Type summary (presentation aggregation).
 */

import {
  getPlotEffectivePrice,
  getPlotNiaFt2,
  getPlotNiaM2,
} from '../developments/plotCommercial';
import { classifyPlotRevenueBucket } from './plotPricingTenure';
import {
  calculatePlotDrivenGdv,
  calculateSalesMetrics,
  roundMoney,
} from './revenueCalculations';

function plotRevenue(plot) {
  return roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot));
}

function resolveHouseType(plot = {}) {
  const value = String(plot.houseType || '').trim();
  return value || 'Unspecified';
}

export function buildRevenueHouseTypeSummary(displayPricedPlots = []) {
  const groups = new Map();

  for (const plot of displayPricedPlots) {
    const houseType = resolveHouseType(plot);
    if (!groups.has(houseType)) {
      groups.set(houseType, {
        houseType,
        plotCount: 0,
        totalRevenue: 0,
        pricedNiaFt2: 0,
        pricedNiaM2: 0,
        openMarketPlots: 0,
        affordablePlots: 0,
      });
    }

    const row = groups.get(houseType);
    const revenue = plotRevenue(plot);
    row.plotCount += 1;
    row.totalRevenue += revenue;

    if (revenue > 0) {
      row.pricedNiaFt2 += getPlotNiaFt2(plot);
      row.pricedNiaM2 += getPlotNiaM2(plot);
    }

    const bucket = classifyPlotRevenueBucket(plot);
    if (bucket === 'openMarket') row.openMarketPlots += 1;
    else if (bucket === 'affordable') row.affordablePlots += 1;
  }

  const rows = [...groups.values()]
    .map((row) => ({
      houseType: row.houseType,
      plotCount: row.plotCount,
      totalRevenue: roundMoney(row.totalRevenue),
      averageSellingPrice:
        row.plotCount > 0 ? roundMoney(row.totalRevenue / row.plotCount) : 0,
      averagePerFt2:
        row.pricedNiaFt2 > 0 ? roundMoney(row.totalRevenue / row.pricedNiaFt2) : 0,
      averagePerM2:
        row.pricedNiaM2 > 0 ? roundMoney(row.totalRevenue / row.pricedNiaM2) : 0,
      openMarketPlots: row.openMarketPlots,
      affordablePlots: row.affordablePlots,
    }))
    .sort(
      (left, right) =>
        right.totalRevenue - left.totalRevenue ||
        left.houseType.localeCompare(right.houseType, undefined, { sensitivity: 'base' })
    );

  const salesMetrics = calculateSalesMetrics(displayPricedPlots);

  const totals = {
    plotCount: displayPricedPlots.length,
    totalRevenue: calculatePlotDrivenGdv(displayPricedPlots),
    averagePerFt2: salesMetrics.averagePerFt2,
    averagePerM2: salesMetrics.averagePerM2,
  };

  return { rows, totals };
}
