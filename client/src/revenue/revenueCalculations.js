/**
 * BL-019A/019B — Revenue calculations driven from Plot Master (Doc 48).
 */

import {
  getPlotEffectivePrice,
  getPlotNiaFt2,
  getPlotNiaM2,
  plotsToCommercialModels,
  roundPlotMoney,
} from '../developments/plotCommercial';
import { classifyPlotRevenueBucket } from './plotPricingTenure';

export function roundMoney(value) {
  return roundPlotMoney(value);
}

export function parseRevenueAmount(value) {
  const raw = String(value ?? '').replace(/[£,\s]/g, '').trim();
  if (!raw) return 0;
  const amount = Number.parseFloat(raw);
  return Number.isFinite(amount) ? roundMoney(Math.max(0, amount)) : 0;
}

export function calculateGrossDevelopmentValue(developmentRevenue = {}) {
  return roundMoney(
    Object.values(developmentRevenue).reduce((sum, value) => sum + roundMoney(value), 0)
  );
}

export function calculatePlotDrivenGdv(plots = []) {
  return roundMoney(
    plots.reduce((sum, plot) => sum + roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot)), 0)
  );
}

export function calculateRevenueSplitFromPlots(plots = []) {
  const split = {
    openMarketRevenue: 0,
    affordableHousingRevenue: 0,
    otherRevenue: 0,
    landSales: 0,
    miscellaneousRevenue: 0,
  };

  for (const plot of plots) {
    const price = roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot));
    if (!price) continue;
    const bucket = classifyPlotRevenueBucket(plot);
    if (bucket === 'openMarket') split.openMarketRevenue += price;
    else if (bucket === 'affordable') split.affordableHousingRevenue += price;
    else split.otherRevenue += price;
  }

  return {
    openMarketRevenue: roundMoney(split.openMarketRevenue),
    affordableHousingRevenue: roundMoney(split.affordableHousingRevenue),
    otherRevenue: roundMoney(split.otherRevenue),
    landSales: 0,
    miscellaneousRevenue: 0,
  };
}

export function calculateSalesMetrics(plots = []) {
  const models = plots.length && plots[0].effectivePrice != null
    ? plots
    : plotsToCommercialModels(plots);
  const pricedPlots = models.filter(
    (plot) => roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot)) > 0
  );

  if (!pricedPlots.length) {
    return {
      averageSellingPrice: 0,
      averagePerFt2: 0,
      averagePerM2: 0,
      pricedPlotCount: 0,
      totalNiaFt2: 0,
      totalNiaM2: 0,
    };
  }

  const totalPrice = roundMoney(
    pricedPlots.reduce(
      (sum, plot) => sum + roundMoney(plot.effectivePrice ?? getPlotEffectivePrice(plot)),
      0
    )
  );
  const totalNiaFt2 = roundMoney(
    pricedPlots.reduce((sum, plot) => sum + getPlotNiaFt2(plot), 0)
  );
  const totalNiaM2 = roundMoney(
    pricedPlots.reduce((sum, plot) => sum + getPlotNiaM2(plot), 0)
  );

  return {
    averageSellingPrice: roundMoney(totalPrice / pricedPlots.length),
    averagePerFt2: totalNiaFt2 > 0 ? roundMoney(totalPrice / totalNiaFt2) : 0,
    averagePerM2: totalNiaM2 > 0 ? roundMoney(totalPrice / totalNiaM2) : 0,
    pricedPlotCount: pricedPlots.length,
    totalNiaFt2,
    totalNiaM2,
  };
}

export function calculatePlotStatusCounts(plots = []) {
  const counts = {
    Available: 0,
    Reserved: 0,
    Exchanged: 0,
    Completed: 0,
    Cancelled: 0,
    total: plots.length,
  };

  for (const plot of plots) {
    const status = String(plot.revenueStatus || 'Available').trim();
    if (counts[status] != null) counts[status] += 1;
  }

  return counts;
}

export function calculateRecognisedRevenue(plots = []) {
  return roundMoney(
    plots
      .filter((plot) => plot.revenueStatus === 'Completed')
      .reduce(
        (sum, plot) =>
          sum + roundMoney(plot.sellingPrice || plot.effectivePrice || getPlotEffectivePrice(plot)),
        0
      )
  );
}

export function buildRevenueSummary({
  plots = [],
  pricedPlots = null,
  strategyMetrics = null,
  recognisedRevenue = null,
} = {}) {
  const models = pricedPlots || plotsToCommercialModels(plots);
  const developmentRevenue = calculateRevenueSplitFromPlots(models);
  const grossDevelopmentValue = calculatePlotDrivenGdv(models);
  const recognised =
    recognisedRevenue != null ? roundMoney(recognisedRevenue) : calculateRecognisedRevenue(plots);
  const forecastRevenue = grossDevelopmentValue;
  const outstandingRevenue = roundMoney(Math.max(0, forecastRevenue - recognised));
  const salesMetrics = calculateSalesMetrics(models);
  const statusCounts = calculatePlotStatusCounts(plots.length ? plots : models);
  const plotsSold = statusCounts.Completed;
  const plotsRemaining = Math.max(0, statusCounts.total - plotsSold - statusCounts.Cancelled);

  const openMarketPercent =
    grossDevelopmentValue > 0
      ? roundMoney((developmentRevenue.openMarketRevenue / grossDevelopmentValue) * 100)
      : 0;
  const affordablePercent =
    grossDevelopmentValue > 0
      ? roundMoney((developmentRevenue.affordableHousingRevenue / grossDevelopmentValue) * 100)
      : 0;
  const otherPercent =
    grossDevelopmentValue > 0
      ? roundMoney((developmentRevenue.otherRevenue / grossDevelopmentValue) * 100)
      : 0;

  return {
    developmentRevenue,
    grossDevelopmentValue,
    forecastRevenue,
    recognisedRevenue: recognised,
    outstandingRevenue,
    forecastProfit: null,
    forecastMarginPercent: null,
    openMarketPercent,
    affordablePercent,
    otherPercent,
    plotsSold,
    plotsRemaining,
    statusCounts,
    strategyMetrics: strategyMetrics || null,
    ...salesMetrics,
  };
}

export function buildStrategyKpiCards(strategyMetrics = {}) {
  return [
    { key: 'autoPriced', label: 'Auto-priced plots', value: strategyMetrics.autoPricedPlotCount ?? 0, format: 'count' },
    { key: 'manualOverrides', label: 'Manual overrides', value: strategyMetrics.manualOverrideCount ?? 0, format: 'count' },
    { key: 'averageOmPerFt2', label: 'Average OM £/ft²', value: strategyMetrics.averageOmPerFt2 ?? 0, format: 'rate' },
    { key: 'averageAhPercent', label: 'Average AH % of OM', value: strategyMetrics.averageAhPercentOfOm ?? 0, format: 'percent' },
    { key: 'totalGaragePremium', label: 'Total Garage Premium', value: strategyMetrics.totalGaragePremium ?? 0, format: 'money' },
    { key: 'totalPlotPremium', label: 'Total Plot Premium', value: strategyMetrics.totalPlotPremium ?? 0, format: 'money' },
    { key: 'manualAdjustmentValue', label: 'Manual Adjustment Value', value: strategyMetrics.manualAdjustmentValue ?? 0, format: 'money' },
  ];
}

export function buildRevenueDashboardKpis(summary = {}) {
  const strategyKpis = buildStrategyKpiCards(summary.strategyMetrics || {});
  return [
    { key: 'gdv', label: 'Gross Development Value', value: summary.grossDevelopmentValue ?? 0, format: 'money' },
    { key: 'forecastRevenue', label: 'Forecast Revenue', value: summary.forecastRevenue ?? 0, format: 'money' },
    { key: 'recognisedRevenue', label: 'Recognised Revenue', value: summary.recognisedRevenue ?? 0, format: 'money' },
    { key: 'outstandingRevenue', label: 'Outstanding Revenue', value: summary.outstandingRevenue ?? 0, format: 'money' },
    { key: 'averageSellingPrice', label: 'Average Selling Price', value: summary.averageSellingPrice ?? 0, format: 'money' },
    { key: 'averagePerFt2', label: 'Average £/ft²', value: summary.averagePerFt2 ?? 0, format: 'rate' },
    { key: 'averagePerM2', label: 'Average £/m²', value: summary.averagePerM2 ?? 0, format: 'rate' },
    { key: 'openMarketPercent', label: 'Open Market %', value: summary.openMarketPercent ?? 0, format: 'percent' },
    { key: 'affordablePercent', label: 'Affordable %', value: summary.affordablePercent ?? 0, format: 'percent' },
    { key: 'otherPercent', label: 'Other %', value: summary.otherPercent ?? 0, format: 'percent' },
    { key: 'plotsSold', label: 'Plots Sold', value: summary.plotsSold ?? 0, format: 'count' },
    { key: 'plotsRemaining', label: 'Plots Remaining', value: summary.plotsRemaining ?? 0, format: 'count' },
    ...strategyKpis,
    {
      key: 'forecastProfit',
      label: 'Forecast Profit',
      value: summary.forecastProfit,
      format: 'placeholder',
      placeholder: '—',
      hint: 'Requires CVR integration',
    },
    {
      key: 'forecastMarginPercent',
      label: 'Forecast Margin %',
      value: summary.forecastMarginPercent,
      format: 'placeholder',
      placeholder: '—',
      hint: 'Requires CVR integration',
    },
  ];
}

export function formatRevenueMoney(value) {
  const amount = roundMoney(value);
  return `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatRevenueRate(value) {
  const amount = roundMoney(value);
  if (!amount) return '£0';
  return `£${amount.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function formatRevenuePercent(value) {
  const amount = roundMoney(value);
  return `${amount}%`;
}

export function formatRevenueKpiValue(kpi) {
  if (kpi.format === 'placeholder') return kpi.placeholder || '—';
  if (kpi.format === 'percent') return formatRevenuePercent(kpi.value);
  if (kpi.format === 'count') return String(kpi.value ?? 0);
  if (kpi.format === 'rate') return formatRevenueRate(kpi.value);
  return formatRevenueMoney(kpi.value);
}
