import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import {
  buildRevenueDashboardKpis,
  buildRevenueSummary,
  calculatePlotDrivenGdv,
  calculateRevenueSplitFromPlots,
  calculateSalesMetrics,
  formatRevenueKpiValue,
  parseRevenueAmount,
} from './revenueCalculations';
import {
  buildCommercialInsights,
  buildPlotRevenueRegisterRows,
  buildRevenueExceptions,
  filterPlotRevenueRows,
  sortPlotRevenueRows,
} from './plotRevenueEngine';
import { enrichPlotsWithPricing } from './revenueStrategyCalculations';
import { emptyRevenueStrategy } from './revenueStrategy';
import { getRevenueRecord, saveRevenueRecord } from './revenueStore';

const samplePlots = [
  {
    id: 'plot-1',
    plotNumber: '1',
    houseType: 'Type A',
    niaFt2: 1000,
    sellingPrice: 300000,
    forecastSellingPrice: 0,
    revenueCategory: 'Open Market',
    revenueStatus: 'Available',
  },
  {
    id: 'plot-2',
    plotNumber: '2',
    houseType: 'Type B',
    niaFt2: 1200,
    sellingPrice: 0,
    forecastSellingPrice: 400000,
    revenueCategory: 'Affordable Housing',
    revenueStatus: 'Reserved',
  },
  {
    id: 'plot-3',
    plotNumber: '3',
    houseType: 'Type C',
    gia: 900,
    sellingPrice: 250000,
    forecastSellingPrice: 0,
    revenueCategory: 'Commercial',
    revenueStatus: 'Completed',
  },
];

describe('revenueCalculations', () => {
  it('calculates plot-driven GDV from forecast or selling prices', () => {
    expect(calculatePlotDrivenGdv(samplePlots)).toBe(950000);
  });

  it('calculates revenue split by category bucket', () => {
    const split = calculateRevenueSplitFromPlots(samplePlots);

    expect(split.openMarketRevenue).toBe(300000);
    expect(split.affordableHousingRevenue).toBe(400000);
    expect(split.otherRevenue).toBe(250000);
    expect(
      split.openMarketRevenue + split.affordableHousingRevenue + split.otherRevenue
    ).toBe(950000);
  });

  it('returns zero sales metrics when no priced plots exist', () => {
    const metrics = calculateSalesMetrics([
      { sellingPrice: 0, forecastSellingPrice: 0, niaFt2: 900 },
    ]);

    expect(metrics.averageSellingPrice).toBe(0);
    expect(metrics.averagePerFt2).toBe(0);
    expect(metrics.averagePerM2).toBe(0);
  });

  it('calculates average selling price and area rates from plots', () => {
    const metrics = calculateSalesMetrics([
      { sellingPrice: 300000, niaFt2: 1000, niaM2: 93 },
      { sellingPrice: 400000, niaFt2: 1200, niaM2: 111 },
    ]);

    expect(metrics.averageSellingPrice).toBe(350000);
    expect(metrics.averagePerFt2).toBeCloseTo(318.18, 2);
    expect(metrics.averagePerM2).toBeCloseTo(3431.37, 1);
  });

  it('builds revenue summary with plot status counts and percentages', () => {
    const summary = buildRevenueSummary({ plots: samplePlots });

    expect(summary.grossDevelopmentValue).toBe(950000);
    expect(summary.forecastRevenue).toBe(950000);
    expect(summary.recognisedRevenue).toBe(250000);
    expect(summary.outstandingRevenue).toBe(700000);
    expect(summary.statusCounts.Available).toBe(1);
    expect(summary.statusCounts.Reserved).toBe(1);
    expect(summary.statusCounts.Completed).toBe(1);
    expect(summary.plotsSold).toBe(1);
    expect(summary.plotsRemaining).toBe(2);
    expect(summary.openMarketPercent).toBeCloseTo(31.58, 1);
    expect(summary.forecastProfit).toBeNull();
    expect(summary.forecastMarginPercent).toBeNull();
  });

  it('builds dashboard KPI cards including placeholders', () => {
    const summary = buildRevenueSummary({ plots: samplePlots });
    const kpis = buildRevenueDashboardKpis(summary);

    expect(kpis.length).toBeGreaterThanOrEqual(19);
    expect(kpis.find((item) => item.key === 'forecastProfit')?.placeholder).toBe('—');
    expect(formatRevenueKpiValue(kpis.find((item) => item.key === 'gdv'))).toBe('£950,000');
    expect(formatRevenueKpiValue(kpis.find((item) => item.key === 'plotsSold'))).toBe('1');
  });

  it('parses revenue amounts from formatted input', () => {
    expect(parseRevenueAmount('£1,250,000')).toBe(1250000);
    expect(parseRevenueAmount('')).toBe(0);
  });
});

describe('plotRevenueEngine', () => {
  const pricedSamplePlots = enrichPlotsWithPricing(
    samplePlots.map((plot, index) => {
      if (index === 0) {
        return {
          ...plot,
          revenueSource: 'Manual Value',
          manualForecastValue: 300000,
          pricingMigrated: true,
        };
      }
      if (index === 1) {
        return {
          ...plot,
          revenueSource: 'Manual Value',
          manualForecastValue: 400000,
          pricingMigrated: true,
        };
      }
      return plot;
    }),
    emptyRevenueStrategy(),
    {}
  );

  it('builds register rows with per-area rates', () => {
    const rows = buildPlotRevenueRegisterRows(pricedSamplePlots);

    expect(rows).toHaveLength(3);
    expect(rows[0].perFt2).toBe(300);
    expect(rows[1].effectivePrice).toBe(400000);
  });

  it('builds register rows with commercial tenure from plot master', () => {
    const rows = buildPlotRevenueRegisterRows([
      {
        id: 'plot-om',
        plotNumber: '1',
        houseType: 'Type A',
        tenure: 'Open Market',
        revenueCategory: 'Open Market',
        revenueStatus: 'Available',
        niaFt2: 1000,
        forecastSellingPrice: 300000,
      },
      {
        id: 'plot-ah',
        plotNumber: '2',
        houseType: 'Type B',
        tenure: 'Affordable Rent',
        revenueCategory: 'Open Market',
        revenueStatus: 'Available',
        niaFt2: 1000,
        forecastSellingPrice: 200000,
      },
    ]);

    expect(rows[0].tenure).toBe('Open Market');
    expect(rows[1].tenure).toBe('Affordable Rent');
    expect(rows[0].revenueCategory).toBe('Open Market');
    expect(rows[1].revenueCategory).toBe('Open Market');
  });

  it('sorts register rows numerically and alphabetically', () => {
    const rows = buildPlotRevenueRegisterRows(pricedSamplePlots);
    const byPrice = sortPlotRevenueRows(rows, { key: 'effectivePrice', direction: 'desc' });

    expect(byPrice[0].plotNumber).toBe('2');
    expect(byPrice[1].plotNumber).toBe('1');
    expect(byPrice[2].plotNumber).toBe('3');
  });

  it('filters register rows by status and query', () => {
    const rows = buildPlotRevenueRegisterRows(samplePlots);
    const filtered = filterPlotRevenueRows(rows, { status: 'Completed' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].plotNumber).toBe('3');
  });

  it('builds commercial insights for priced plots', () => {
    const insights = buildCommercialInsights(samplePlots);

    expect(insights.available).toBe(true);
    expect(insights.items.find((item) => item.key === 'highest-value')?.plotId).toBe('plot-2');
  });

  it('detects revenue exceptions', () => {
    const exceptions = buildRevenueExceptions([
      {
        id: 'plot-x',
        plotNumber: '17',
        sellingPrice: 285000,
        forecastSellingPrice: 250000,
        revenueStatus: 'Available',
      },
      {
        id: 'plot-y',
        plotNumber: '18',
        sellingPrice: 0,
        forecastSellingPrice: 0,
        revenueStatus: 'Completed',
      },
    ]);

    expect(exceptions.some((item) => item.type === 'missingNia')).toBe(true);
    expect(exceptions.some((item) => item.type === 'forecastLowerThanPrice')).toBe(true);
    expect(exceptions.some((item) => item.type === 'reservedStillAvailable')).toBe(true);
    expect(exceptions.some((item) => item.type === 'completedNoPrice')).toBe(true);
  });
});

describe('revenueStore', () => {
  beforeEach(() => storage.clear());

  it('creates an empty revenue record for a development', () => {
    const record = getRevenueRecord('dev-1');

    expect(record.revenueAdjustments).toEqual([]);
    expect(record.recognitionSettings).toEqual({});
    expect(record.metadata.version).toBe(3);
  });

  it('persists adjustments and recognition settings', () => {
    const result = saveRevenueRecord('dev-1', {
      revenueAdjustments: [{ id: 'adj-1', amount: 1000 }],
      recognitionSettings: { method: 'completion' },
      metadata: { version: 2 },
    });

    expect(result.ok).toBe(true);
    expect(getRevenueRecord('dev-1').revenueAdjustments).toHaveLength(1);
    expect(getRevenueRecord('dev-1').recognitionSettings).toMatchObject({
      method: 'completion',
    });
  });
});
