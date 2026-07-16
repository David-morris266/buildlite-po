import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { createDevelopment, getDevelopment } from '../developments/developmentStore';
import { addPlot } from '../developments/plotMaster';
import {
  applyStrategyToPlots,
  buildHouseTypePricingRows,
  calculateHouseTypeForecast,
  calculateOpenMarketBase,
  enrichPlotsWithPricing,
  getGaragePremium,
  resolvePlotForecastPrice,
} from './revenueStrategyCalculations';
import {
  emptyRevenueStrategy,
  getRevenuePricingContext,
  getRevenueStrategy,
  saveRevenueStrategy,
} from './revenueStrategy';

const strategy = emptyRevenueStrategy();

const samplePlots = [
  {
    id: 'plot-1',
    plotNumber: '1',
    houseType: 'Ash',
    niaFt2: 950,
    revenueCategory: 'Open Market',
    revenueSource: 'House Type',
    garage: 'None',
    plotPremium: 0,
  },
  {
    id: 'plot-2',
    plotNumber: '2',
    houseType: 'Oak',
    niaFt2: 1180,
    revenueCategory: 'Open Market',
    revenueSource: 'House Type',
    garage: 'Single',
    plotPremium: 10000,
    plotPremiumReason: 'Corner Plot',
  },
  {
    id: 'plot-3',
    plotNumber: '3',
    houseType: 'Ash',
    niaFt2: 950,
    revenueCategory: 'Affordable Housing',
    revenueSource: 'Manual Value',
    manualForecastValue: 200000,
    manualOverrideExplicit: true,
    pricingMigrated: true,
  },
];

const houseTypePricing = {
  Ash: { garage: 'None', sellingBasis: 'Auto' },
  Oak: { garage: 'Single', sellingBasis: 'Auto' },
};

describe('revenueStrategyCalculations', () => {
  it('calculates garage premiums from strategy defaults', () => {
    expect(getGaragePremium('None', strategy)).toBe(0);
    expect(getGaragePremium('Single', strategy)).toBe(12500);
    expect(getGaragePremium('Double', strategy)).toBe(22500);
  });

  it('calculates open market base from NIA and rate', () => {
    const base = calculateOpenMarketBase({
      niaFt2: 950,
      garage: 'None',
      strategy,
    });
    expect(base).toBe(332500);
  });

  it('calculates house type forecast with garage premium', () => {
    const ash = calculateHouseTypeForecast('Ash', houseTypePricing.Ash, strategy, samplePlots);
    const oak = calculateHouseTypeForecast('Oak', houseTypePricing.Oak, strategy, samplePlots);

    expect(ash).toBe(332500);
    expect(oak).toBe(425500);
  });

  it('applies plot premium and affordable discount', () => {
    const openMarketPlot = resolvePlotForecastPrice(
      samplePlots[1],
      strategy,
      houseTypePricing,
      samplePlots
    );
    expect(openMarketPlot).toBe(435500);

    const affordablePlot = resolvePlotForecastPrice(
      { ...samplePlots[0], revenueCategory: 'Affordable Housing' },
      strategy,
      houseTypePricing,
      samplePlots
    );
    expect(affordablePlot).toBe(192850);
  });

  it('preserves manual override values during resolution', () => {
    const manual = resolvePlotForecastPrice(samplePlots[2], strategy, houseTypePricing, samplePlots);
    expect(manual).toBe(200000);
  });

  it('builds house type pricing rows from plot master house types', () => {
    const rows = buildHouseTypePricingRows(samplePlots, strategy, houseTypePricing);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.houseType === 'Oak')?.forecastValue).toBe(425500);
  });

  it('enriches plots with strategy-driven effective prices', () => {
    const enriched = enrichPlotsWithPricing(samplePlots, strategy, houseTypePricing);
    expect(enriched[0].effectivePrice).toBe(332500);
    expect(enriched[1].effectivePrice).toBe(435500);
    expect(enriched[2].isManualOverride).toBe(true);
  });

  it('preserves plot overrides when applying development strategy', () => {
    const plots = [
      {
        ...samplePlots[0],
        revenueSource: 'Plot Override',
        plotOverrideValue: 360000,
      },
    ];
    const next = applyStrategyToPlots(plots, strategy, houseTypePricing, {
      revenueSource: 'Development Strategy',
      skipManual: true,
    });
    expect(next[0].revenueSource).toBe('Plot Override');
    expect(next[0].plotOverrideValue).toBe(360000);
  });

  it('applies affordable discount from plot tenure', () => {
    const tenurePlot = resolvePlotForecastPrice(
      { ...samplePlots[0], tenure: 'Affordable Rent', revenueCategory: 'Open Market' },
      strategy,
      houseTypePricing,
      samplePlots
    );
    expect(tenurePlot).toBe(192850);
  });
});

describe('revenueStrategy store', () => {
  beforeEach(() => storage.clear());

  it('persists development strategy defaults', () => {
    const development = createDevelopment({
      jobNumber: 'BL019C',
      developmentName: 'Strategy Test',
    });

    const result = saveRevenueStrategy(development.id, {
      ...emptyRevenueStrategy(),
      openMarket: { ratePerFt2: 360, effectiveDate: '2026-01-01' },
    });

    expect(result.ok).toBe(true);
    expect(getRevenueStrategy(development.id).openMarket.ratePerFt2).toBe(360);
  });

  it('builds pricing context from plots and strategy', () => {
    const development = createDevelopment({
      jobNumber: 'CTX-1',
      developmentName: 'Context Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '10',
      houseType: 'Ash',
      niaFt2: 950,
      revenueCategory: 'Open Market',
      revenueSource: 'House Type',
    });

    const context = getRevenuePricingContext(development.id);
    expect(context.pricedPlots).toHaveLength(1);
    expect(context.pricedPlots[0].effectivePrice).toBe(332500);
    expect(context.strategyMetrics.autoPricedPlotCount).toBe(1);
  });

  it('defaults imported plots with engine forecasts to House Type pricing', () => {
    const development = createDevelopment({
      jobNumber: 'MIG-1',
      developmentName: 'Migration Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '5',
      houseType: 'Beech',
      niaFt2: 1000,
      forecastSellingPrice: 275000,
    });

    const context = getRevenuePricingContext(development.id);
    const refreshed = getDevelopment(development.id);
    const plot = refreshed.plotMaster.plots[0];

    expect(plot.revenueSource).toBe('House Type');
    expect(plot.manualForecastValue).toBe(0);
    expect(plot.pricingMigrated).toBe(true);
    expect(context.pricedPlots[0].isManualOverride).toBe(false);
  });

  it('preserves explicit legacy manual overrides during migration', () => {
    const development = createDevelopment({
      jobNumber: 'MIG-2',
      developmentName: 'Manual Legacy Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '8',
      houseType: 'Ash',
      niaFt2: 950,
      revenueSource: 'Manual Value',
      manualForecastValue: 310000,
      pricingMigrated: false,
    });

    getRevenuePricingContext(development.id);
    const refreshed = getDevelopment(development.id);
    const plot = refreshed.plotMaster.plots[0];

    expect(plot.revenueSource).toBe('Manual Value');
    expect(plot.manualForecastValue).toBe(310000);
    expect(plot.manualOverrideExplicit).toBe(true);
    expect(plot.pricingMigrated).toBe(true);
  });

  it('repairs misclassified manual plots created by old migration logic', () => {
    const development = createDevelopment({
      jobNumber: 'MIG-3',
      developmentName: 'Repair Test',
    });

    saveRevenueStrategy(development.id, emptyRevenueStrategy());

    addPlot(development.id, {
      plotNumber: '12',
      houseType: 'Oak',
      niaFt2: 1180,
      revenueSource: 'Manual Value',
      manualForecastValue: 275000,
      forecastSellingPrice: 275000,
      pricingMigrated: true,
    });

    getRevenuePricingContext(development.id);
    const refreshed = getDevelopment(development.id);
    const plot = refreshed.plotMaster.plots[0];

    expect(plot.revenueSource).toBe('House Type');
    expect(plot.manualForecastValue).toBe(0);
    expect(plot.manualOverrideExplicit).toBe(false);
  });
});
