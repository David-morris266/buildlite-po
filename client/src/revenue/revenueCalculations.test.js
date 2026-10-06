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
import { buildStrategyInsights, buildStrategySummaryMetrics } from './revenueStrategyCalculations';
import { buildRevenueHouseTypeSummary } from './revenueHouseTypeSummary';
import { emptyRevenueStrategy } from './revenueStrategy';
import { getRevenueRecord, saveRevenueRecord } from './revenueStore';

const samplePlots = [
  {
    id: 'plot-1',
    plotNumber: '1',
    houseType: 'Type A',
    niaFt2: 1000,
    sellingPrice: 0,
    forecastSellingPrice: 300000,
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

const OAKFIELD_NIA = {
  Ashford: 750,
  Bramley: 950,
  Cedar: 1050,
  Dunham: 1250,
  Elm: 1400,
  Farley: 700,
  Grafton: 900,
  Hawley: 725,
};

function oakfieldShape() {
  const houseTypes = Object.keys(OAKFIELD_NIA);
  return Array.from({ length: 60 }, (_, index) => ({
    id: `oakfield-${index + 1}`,
    plotNumber: String(index + 1),
    houseType: houseTypes[index % houseTypes.length],
    tenure: index < 45 ? 'Open Market' : index < 55 ? 'Affordable Rent' : 'Shared Ownership',
    revenueCategory: 'Open Market',
    revenueStatus: 'Available',
    revenueSource: 'House Type',
    niaFt2: 0,
    gia: 0,
  }));
}

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
      { forecastSellingPrice: 300000, niaFt2: 1000, niaM2: 93, revenueStatus: 'Available' },
      { forecastSellingPrice: 400000, niaFt2: 1200, niaM2: 111, revenueStatus: 'Available' },
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
    expect(summary.securedRevenue).toBe(250000);
    expect(summary.remainingForecast).toBe(700000);
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
    expect(formatRevenueKpiValue(kpis.find((item) => item.key === 'securedRevenue'))).toBe('£250,000');
    expect(formatRevenueKpiValue(kpis.find((item) => item.key === 'remainingForecast'))).toBe('£700,000');
    expect(kpis.find((item) => item.key === 'recognisedRevenue')).toBeUndefined();
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

  it('presents Reserved Selling Price as effective authority and retains the fallback source', () => {
    const rows = buildPlotRevenueRegisterRows([{
      id: 'plot-7', plotNumber: '7', houseType: 'Ash', revenueStatus: 'Reserved',
      revenueSource: 'House Type', pricingSource: 'Reserved Selling Price',
      fallbackPricingSource: 'House Type', reservedSellingPriceAuthority: true,
      sellingPrice: 330000, forecastSellingPrice: 330000, effectivePrice: 330000,
    }]);
    expect(rows[0]).toMatchObject({
      pricingSource: 'Reserved Selling Price',
      fallbackPricingSource: 'House Type',
      reservedSellingPriceAuthority: true,
      forecastSellingPrice: 330000,
    });
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
        pricingRequiresArea: true,
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
    expect(exceptions.some((item) => item.type === 'completedNoPrice')).toBe(true);
    expect(exceptions.some((item) => item.type === 'reservedStillAvailable')).toBe(false);
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

describe('source-aware effective Revenue NIA', () => {
  it('uses explicit House Type NIA across Oakfield-shaped pricing, KPIs, register and insights', () => {
    const plots = oakfieldShape();
    const strategy = {
      ...emptyRevenueStrategy(),
      openMarket: { ratePerFt2: 350, effectiveDate: '' },
    };
    const houseTypePricing = Object.fromEntries(
      Object.entries(OAKFIELD_NIA).map(([houseType, representativeNiaFt2]) => [
        houseType,
        { sellingBasis: 'Auto', representativeNiaFt2, garage: 'None' },
      ])
    );
    const priced = enrichPlotsWithPricing(plots, strategy, houseTypePricing);
    const expectedNia = priced.reduce((sum, plot) => sum + OAKFIELD_NIA[plot.houseType], 0);
    const expectedRevenue = priced.reduce((sum, plot) => sum + plot.effectivePrice, 0);
    const salesMetrics = calculateSalesMetrics(priced);
    const register = buildPlotRevenueRegisterRows(priced);
    const houseTypes = buildRevenueHouseTypeSummary(priced);
    const strategyMetrics = buildStrategySummaryMetrics(plots, strategy, houseTypePricing);
    const insights = buildStrategyInsights(plots, strategy, houseTypePricing);

    expect(priced).toHaveLength(60);
    expect(priced.every((plot) => plot.effectivePrice > 0)).toBe(true);
    expect(priced.every((plot) => plot.effectiveRevenueNiaSource === 'explicit_house_type')).toBe(true);
    expect(buildRevenueExceptions(priced).filter((item) => item.type === 'missingNia')).toEqual([]);
    expect(insights.items.find((item) => item.key === 'missing-nia')).toBeUndefined();
    expect(register.every((row) => row.perFt2 > 0 && row.perM2 > 0)).toBe(true);
    expect(register.every((row) => row.niaSource === 'explicit_house_type')).toBe(true);
    expect(salesMetrics.totalNiaFt2).toBe(expectedNia);
    expect(salesMetrics.averagePerFt2).toBe(Math.round((expectedRevenue / expectedNia) * 100) / 100);
    expect(salesMetrics.averagePerM2).toBeGreaterThan(0);
    expect(houseTypes.rows.every((row) => row.averagePerFt2 > 0 && row.averagePerM2 > 0)).toBe(true);
    expect(houseTypes.totals.averagePerFt2).toBe(salesMetrics.averagePerFt2);
    expect(strategyMetrics.averageOmPerFt2).toBeGreaterThan(0);
    expect(insights.items.find((item) => item.key === 'highest-ft2')).toBeTruthy();
    expect(insights.items.find((item) => item.key === 'lowest-ft2')).toBeTruthy();
    expect(plots.every((plot) => plot.niaFt2 === 0 && plot.gia === 0)).toBe(true);
  });

  it('keeps Development Strategy Plot-area authority separate from House Type NIA', () => {
    const plot = {
      id: 'development-strategy-no-area', plotNumber: '1', houseType: 'Ashford',
      tenure: 'Open Market', revenueStatus: 'Available', revenueSource: 'Development Strategy',
      niaFt2: 0, gia: 0,
    };
    const priced = enrichPlotsWithPricing(
      [plot],
      { ...emptyRevenueStrategy(), openMarket: { ratePerFt2: 350, effectiveDate: '' } },
      { Ashford: { sellingBasis: 'Auto', representativeNiaFt2: 750, garage: 'None' } }
    );

    expect(priced[0]).toMatchObject({
      effectivePrice: 0,
      effectiveRevenueNiaFt2: 0,
      effectiveRevenueNiaSource: 'unresolved',
      pricingRequiresArea: true,
      revenueNiaResolved: false,
    });
    expect(buildRevenueExceptions(priced).some((item) => item.type === 'missingNia')).toBe(true);
  });

  it('does not make area a prerequisite for manual or secured monetary authority', () => {
    const plots = [
      { id: 'manual', plotNumber: '1', houseType: 'Unknown', revenueSource: 'Manual Value', manualForecastValue: 200000, revenueStatus: 'Available', niaFt2: 0, gia: 0 },
      { id: 'reserved', plotNumber: '2', houseType: 'Unknown', revenueSource: 'House Type', sellingPrice: 210000, revenueStatus: 'Reserved', niaFt2: 0, gia: 0 },
      { id: 'secured', plotNumber: '3', houseType: 'Unknown', revenueSource: 'House Type', sellingPrice: 220000, revenueStatus: 'Exchanged', niaFt2: 0, gia: 0 },
    ];
    const priced = enrichPlotsWithPricing(plots, emptyRevenueStrategy(), {});

    expect(priced.map((plot) => plot.effectivePrice)).toEqual([200000, 210000, 220000]);
    expect(priced.every((plot) => plot.pricingRequiresArea === false)).toBe(true);
    expect(buildRevenueExceptions(priced).some((item) => item.type === 'missingNia')).toBe(false);
  });
});
