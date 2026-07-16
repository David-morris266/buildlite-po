/**
 * BL-019C.5.5 — Runtime pipeline trace (vitest + in-memory storage).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { createDevelopment } from '../developments/developmentStore';
import { addPlot } from '../developments/plotMaster';
import { saveRevenueStrategy, getRevenuePricingContext } from '../revenue/revenueStrategy';
import { buildRevenuePricingModel } from '../revenue/revenuePricingModel';
import { buildRevenueSummary, calculateRevenueSplitFromPlots } from '../revenue/revenueCalculations';
import { buildPlotRevenueRegisterRows } from '../revenue/plotRevenueEngine';
import {
  classifyPlotRevenueBucket,
  getAffordablePercentKey,
  getPlotPricingTenure,
} from '../revenue/plotPricingTenure';
import { getPlotTenureLabel, normalizeTenureLabel } from '../revenue/tenureDisplay';
import { emptyRevenueStrategy } from '../revenue/revenueStrategy';

function tracePlot(rawPlot, enrichedPlot, registerRow) {
  const pricingTenure = getPlotPricingTenure(enrichedPlot);
  return {
    plotNumber: enrichedPlot.plotNumber,
    rawTenure: rawPlot?.tenure,
    revenueCategory: enrichedPlot.revenueCategory,
    pricingTenure,
    normalizedTenure: normalizeTenureLabel(pricingTenure),
    registerTenure: registerRow?.tenure ?? getPlotTenureLabel(enrichedPlot),
    percentKey: getAffordablePercentKey(pricingTenure),
    bucket: classifyPlotRevenueBucket(enrichedPlot),
    forecastSellingPrice: enrichedPlot.forecastSellingPrice,
    effectivePrice: enrichedPlot.effectivePrice,
    registerForecast: registerRow?.forecastSellingPrice,
    contributesAffordable:
      classifyPlotRevenueBucket(enrichedPlot) === 'affordable' &&
      (enrichedPlot.effectivePrice ?? 0) > 0,
  };
}

function runPipeline(developmentId) {
  const context = getRevenuePricingContext(developmentId);
  const model = buildRevenuePricingModel({
    plots: context.plots,
    strategy: context.strategy,
    houseTypePricing: context.houseTypePricing,
  });
  const displayPricedPlots = model.pricedPlots;
  const registerRows = buildPlotRevenueRegisterRows(displayPricedPlots);
  const split = calculateRevenueSplitFromPlots(displayPricedPlots);
  const summary = buildRevenueSummary({
    plots: context.plots,
    pricedPlots: displayPricedPlots,
    strategyMetrics: model.strategyMetrics,
  });
  return { context, model, displayPricedPlots, registerRows, split, summary };
}

describe('BL-019C.5.5 revenue pipeline trace', () => {
  beforeEach(() => storage.clear());

  it('traces Shared Ownership vs Affordable Rent through the full runtime pipeline', () => {
    const development = createDevelopment({
      jobNumber: 'TRACE-1',
      developmentName: 'Pipeline Trace Dev',
    });
    saveRevenueStrategy(development.id, {
      ...emptyRevenueStrategy(),
      openMarket: { ratePerFt2: 350, effectiveDate: '' },
    });

    // ~£166,402 discounted each at 58% (nia 820 ft²)
    for (let i = 1; i <= 4; i += 1) {
      addPlot(development.id, {
        plotNumber: String(i),
        houseType: 'AR Type',
        niaFt2: 820,
        tenure: 'Affordable Rent',
        revenueCategory: 'Open Market',
        revenueSource: 'House Type',
      });
    }

    // ~£241,080 discounted each at 72% (nia 950 ft²)
    for (let i = 5; i <= 11; i += 1) {
      addPlot(development.id, {
        plotNumber: String(i),
        houseType: 'SO Type',
        niaFt2: 950,
        tenure: 'Shared Ownership',
        revenueCategory: 'Open Market',
        revenueSource: 'House Type',
      });
    }

    const { context, displayPricedPlots, registerRows, split } = runPipeline(
      development.id
    );

    const arPlots = displayPricedPlots.filter((p) => getPlotTenureLabel(p) === 'Affordable Rent');
    const soPlots = displayPricedPlots.filter((p) => getPlotTenureLabel(p) === 'Shared Ownership');

    expect(arPlots).toHaveLength(4);
    expect(soPlots).toHaveLength(7);

    const arTrace = tracePlot(
      context.plots.find((p) => p.plotNumber === '1'),
      arPlots[0],
      registerRows.find((r) => r.plotNumber === '1')
    );
    const soTrace = tracePlot(
      context.plots.find((p) => p.plotNumber === '5'),
      soPlots[0],
      registerRows.find((r) => r.plotNumber === '5')
    );

    expect(soTrace.bucket).toBe('affordable');
    expect(soTrace.percentKey).toBe('sharedOwnership');
    expect(soTrace.contributesAffordable).toBe(true);
    expect(arTrace.bucket).toBe('affordable');
    expect(arTrace.percentKey).toBe('affordableRent');

    const arBucketSum = arPlots.reduce(
      (sum, p) => sum + (classifyPlotRevenueBucket(p) === 'affordable' ? p.effectivePrice : 0),
      0
    );
    const soBucketSum = soPlots.reduce(
      (sum, p) => sum + (classifyPlotRevenueBucket(p) === 'affordable' ? p.effectivePrice : 0),
      0
    );

    expect(split.affordableHousingRevenue).toBeCloseTo(arBucketSum + soBucketSum, 0);
    expect(split.affordableHousingRevenue).toBeGreaterThan(arBucketSum);
  });

  it('identifies when register forecast display diverges from split effectivePrice', () => {
    const development = createDevelopment({
      jobNumber: 'TRACE-2',
      developmentName: 'Zero effectivePrice edge',
    });
    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: 'SO-1',
      houseType: 'SO Type',
      niaFt2: 950,
      tenure: 'Shared Ownership',
      revenueCategory: 'Open Market',
      revenueSource: 'House Type',
    });

    const { context, displayPricedPlots, registerRows } = runPipeline(development.id);
    const enriched = displayPricedPlots[0];
    const registerRow = registerRows[0];

    // Simulate object state where register || fallback would show forecast but split skips zero
    enriched.effectivePrice = 0;
    enriched.forecastSellingPrice = 250000;

    const splitAfter = calculateRevenueSplitFromPlots([enriched]);
    const trace = tracePlot(context.plots[0], enriched, registerRow);

    expect(trace.bucket).toBe('affordable');
    expect(trace.contributesAffordable).toBe(false);
    expect(splitAfter.affordableHousingRevenue).toBe(0);
    expect(registerRow.forecastSellingPrice).toBeGreaterThan(0);
  });

  it('traces tenure label vs bucket when raw tenure is non-canonical but display-normalized', () => {
    const development = createDevelopment({
      jobNumber: 'TRACE-3',
      developmentName: 'Alias tenure',
    });
    saveRevenueStrategy(development.id, {
      ...emptyRevenueStrategy(),
      openMarket: { ratePerFt2: 350, effectiveDate: '' },
    });

    addPlot(development.id, {
      plotNumber: 'DMS-1',
      houseType: 'Type A',
      niaFt2: 900,
      tenure: 'dms',
      revenueCategory: 'Open Market',
      revenueSource: 'House Type',
    });

    const { context, displayPricedPlots, registerRows, split } = runPipeline(development.id);
    const trace = tracePlot(context.plots[0], displayPricedPlots[0], registerRows[0]);

    expect(trace.registerTenure).toBe('Discount Market Sale');
    expect(trace.bucket).toBe('affordable');
    expect(split.affordableHousingRevenue).toBeGreaterThan(0);
  });
});
