import { describe, expect, it } from 'vitest';

import { buildRevenueHouseTypeSummary } from './revenueHouseTypeSummary';
import { calculatePlotDrivenGdv, calculateSalesMetrics } from './revenueCalculations';

const displayPricedPlots = [
  {
    id: '1',
    houseType: 'Ash',
    tenure: 'Open Market',
    revenueCategory: 'Open Market',
    niaFt2: 1000,
    effectivePrice: 350000,
    perFt2: 350,
  },
  {
    id: '2',
    houseType: 'Ash',
    tenure: 'Affordable Rent',
    revenueCategory: 'Open Market',
    niaFt2: 900,
    effectivePrice: 200000,
    perFt2: 222.22,
  },
  {
    id: '3',
    houseType: 'Cedar',
    tenure: 'Shared Ownership',
    revenueCategory: 'Open Market',
    niaFt2: 1100,
    effectivePrice: 300000,
    perFt2: 272.73,
  },
  {
    id: '4',
    houseType: 'Cedar',
    tenure: 'Open Market',
    revenueCategory: 'Open Market',
    niaFt2: 1000,
    effectivePrice: 0,
    perFt2: 0,
  },
];

describe('buildRevenueHouseTypeSummary', () => {
  it('groups by house type sorted by highest total revenue first', () => {
    const summary = buildRevenueHouseTypeSummary(displayPricedPlots);

    expect(summary.rows.map((row) => row.houseType)).toEqual(['Ash', 'Cedar']);
    expect(summary.rows[0].totalRevenue).toBe(550000);
    expect(summary.rows[1].totalRevenue).toBe(300000);
  });

  it('calculates row metrics and tenure plot counts', () => {
    const summary = buildRevenueHouseTypeSummary(displayPricedPlots);
    const ash = summary.rows[0];

    expect(ash.plotCount).toBe(2);
    expect(ash.averageSellingPrice).toBe(275000);
    expect(ash.averagePerFt2).toBe(289.47);
    expect(ash.openMarketPlots).toBe(1);
    expect(ash.affordablePlots).toBe(1);

    const cedar = summary.rows[1];
    expect(cedar.plotCount).toBe(2);
    expect(cedar.openMarketPlots).toBe(1);
    expect(cedar.affordablePlots).toBe(1);
  });

  it('reconciles footer totals exactly with dashboard GDV and sales metrics', () => {
    const summary = buildRevenueHouseTypeSummary(displayPricedPlots);
    const gdv = calculatePlotDrivenGdv(displayPricedPlots);
    const salesMetrics = calculateSalesMetrics(displayPricedPlots);

    const rowRevenueSum = summary.rows.reduce((sum, row) => sum + row.totalRevenue, 0);

    expect(summary.totals.totalRevenue).toBe(gdv);
    expect(rowRevenueSum).toBe(gdv);
    expect(summary.totals.plotCount).toBe(displayPricedPlots.length);
    expect(summary.totals.averagePerFt2).toBe(salesMetrics.averagePerFt2);
    expect(summary.totals.averagePerM2).toBe(salesMetrics.averagePerM2);
  });
});
