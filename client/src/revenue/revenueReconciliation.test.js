/**
 * BL-019C.5.6 — Affordable revenue reconciliation diagnostics.
 */
import { describe, expect, it } from 'vitest';

import { buildAffordableRevenueReconciliation } from './revenueReconciliation';
import { buildRevenueSummary, calculateRevenueSplitFromPlots } from './revenueCalculations';
import { classifyPlotRevenueBucket } from './plotPricingTenure';
import { getPlotEffectivePrice } from '../developments/plotCommercial';

function makePlot(overrides = {}) {
  return {
    id: overrides.id ?? 'plot-1',
    plotNumber: overrides.plotNumber ?? '1',
    tenure: overrides.tenure ?? 'Open Market',
    revenueCategory: overrides.revenueCategory ?? 'Open Market',
    forecastSellingPrice: overrides.forecastSellingPrice ?? 300000,
    effectivePrice: overrides.effectivePrice ?? 300000,
    ...overrides,
  };
}

describe('buildAffordableRevenueReconciliation', () => {
  it('matches dashboard summary when displayPricedPlots drives both paths', () => {
    const displayPricedPlots = [
      makePlot({ id: 'ar-1', plotNumber: '1', tenure: 'Affordable Rent', effectivePrice: 166402 }),
      makePlot({
        id: 'so-1',
        plotNumber: '5',
        tenure: 'Shared Ownership',
        effectivePrice: 336100,
      }),
    ];
    const summary = buildRevenueSummary({ pricedPlots: displayPricedPlots });
    const reconciliation = buildAffordableRevenueReconciliation(displayPricedPlots, summary);

    expect(reconciliation.dashboardMatchesReconciledSplit).toBe(true);
    expect(reconciliation.totals.sharedOwnershipRevenue).toBe(336100);
    expect(reconciliation.totals.affordableRentRevenue).toBe(166402);
    expect(reconciliation.totals.totalAffordableHousingRevenue).toBe(502502);
    expect(reconciliation.reconciledSplit.affordableHousingRevenue).toBe(502502);
    expect(summary.developmentRevenue.affordableHousingRevenue).toBe(502502);
  });

  it('classifies Social Shared tenure as shared ownership affordable revenue', () => {
    const displayPricedPlots = [
      makePlot({ id: 'ar-1', plotNumber: '1', tenure: 'Affordable Rent', effectivePrice: 665608 }),
      makePlot({
        id: 'so-1',
        plotNumber: '5',
        tenure: 'Social Shared',
        revenueCategory: 'Open Market',
        effectivePrice: 336100,
      }),
    ];
    const summary = buildRevenueSummary({ pricedPlots: displayPricedPlots });
    const reconciliation = buildAffordableRevenueReconciliation(displayPricedPlots, summary);

    expect(reconciliation.rows[1].percentKey).toBe('sharedOwnership');
    expect(reconciliation.rows[1].bucket).toBe('affordable');
    expect(reconciliation.rows[1].includedInSplit).toBe(true);
    expect(reconciliation.rows[1].registerTenure).toBe('Shared Ownership');
    expect(classifyPlotRevenueBucket(displayPricedPlots[1])).toBe('affordable');
    expect(reconciliation.totals.sharedOwnershipRevenue).toBe(336100);
    expect(summary.developmentRevenue.affordableHousingRevenue).toBe(1001708);
    expect(summary.affordablePercent).toBeGreaterThan(
      (665608 / summary.grossDevelopmentValue) * 100
    );
    expect(reconciliation.flags.openMarketSharedOwnershipCount).toBe(0);
  });

  it('flags Shared Ownership bucketed as openMarket', () => {
    const plot = makePlot({
      id: 'so-bad',
      plotNumber: '5',
      tenure: 'Shared Ownership',
      revenueCategory: 'Open Market',
      effectivePrice: 250000,
    });
    const reconciliation = buildAffordableRevenueReconciliation([plot], null);

    expect(classifyPlotRevenueBucket(plot)).toBe('affordable');
    expect(reconciliation.rows[0].bucket).toBe('affordable');
    expect(reconciliation.flags.openMarketSharedOwnershipCount).toBe(0);
  });

  it('flags register forecast vs zero split price divergence', () => {
    const plot = makePlot({
      id: 'so-zero',
      plotNumber: '5',
      tenure: 'Shared Ownership',
      forecastSellingPrice: 250000,
      effectivePrice: 0,
    });
    const displayPricedPlots = [plot];
    const split = calculateRevenueSplitFromPlots(displayPricedPlots);
    const reconciliation = buildAffordableRevenueReconciliation(displayPricedPlots, null);

    expect(reconciliation.rows[0].registerTenure).toBe('Shared Ownership');
    expect(reconciliation.rows[0].bucket).toBe('affordable');
    expect(reconciliation.rows[0].includedInSplit).toBe(false);
    expect(reconciliation.rows[0].getPlotEffectivePrice).toBe(250000);
    expect(getPlotEffectivePrice(plot)).toBe(250000);
    expect(split.affordableHousingRevenue).toBe(0);
    expect(reconciliation.flags.sharedOwnershipForecastButZeroSplitCount).toBe(1);
    expect(reconciliation.totals.sharedOwnershipRevenue).toBe(0);
  });

  it('shows Shared Ownership revenue in open market when misclassified via fallback', () => {
    const plot = makePlot({
      id: 'so-fallback',
      plotNumber: '5',
      tenure: '',
      revenueCategory: 'Open Market',
      forecastSellingPrice: 240000,
      effectivePrice: 240000,
    });
    const reconciliation = buildAffordableRevenueReconciliation([plot], null);

    expect(reconciliation.rows[0].bucket).toBe('openMarket');
    expect(reconciliation.totals.openMarketRevenue).toBe(240000);
    expect(reconciliation.totals.sharedOwnershipRevenue).toBe(0);
    expect(reconciliation.reconciledSplit.affordableHousingRevenue).toBe(0);
  });
});
