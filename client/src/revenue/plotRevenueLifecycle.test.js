import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/developments', () => import('../test/mockDevelopmentApi'));

import {
  getPlotContractPrice,
  getPlotEffectivePrice,
  getPlotForecastRevenue,
  getPlotSecuredRevenue,
} from '../developments/plotCommercial';
import {
  addPlot,
  getPlots,
  updatePlot,
  validatePlot,
} from '../developments/plotMaster';
import { createDevelopment, __resetDevelopmentsStoreForTests } from '../developments/developmentStore';
import { resetDevelopmentApiStore } from '../test/mockDevelopmentApi';
import {
  buildRevenueDashboardKpis,
  buildRevenueSummary,
  calculateRecognisedRevenue,
  calculateSecuredRevenue,
} from './revenueCalculations';
import {
  applyStrategyToPlots,
  enrichPlotWithPricing,
  enrichPlotsWithPricing,
} from './revenueStrategyCalculations';
import { emptyRevenueStrategy } from './revenueStrategy';

function manualPlot(overrides = {}) {
  return {
    id: overrides.id || 'plot-1',
    plotNumber: overrides.plotNumber || '1',
    houseType: 'Arundel',
    niaFt2: 686,
    revenueCategory: 'Open Market',
    revenueSource: 'Manual Value',
    manualForecastValue: overrides.manualForecastValue ?? 255100,
    forecastSellingPrice: overrides.forecastSellingPrice ?? 255100,
    sellingPrice: overrides.sellingPrice ?? 0,
    revenueStatus: overrides.revenueStatus || 'Available',
    plotPremium: 0,
    ...overrides,
  };
}

describe('private plot revenue lifecycle', () => {
  const strategy = emptyRevenueStrategy();

  it('Available uses forecast and secured is £0', () => {
    const plot = manualPlot({ revenueStatus: 'Available' });
    const enriched = enrichPlotWithPricing(plot, strategy, {});
    expect(enriched.forecastRevenue).toBe(255100);
    expect(enriched.securedRevenue).toBe(0);
    expect(enriched.remainingForecastRevenue).toBe(255100);
    expect(getPlotEffectivePrice(plot)).toBe(255100);
    expect(getPlotSecuredRevenue(plot)).toBe(0);
  });

  it('Reserved uses forecast and secured is £0', () => {
    const plot = manualPlot({ revenueStatus: 'Reserved' });
    const enriched = enrichPlotWithPricing(plot, strategy, {});
    expect(enriched.forecastRevenue).toBe(255100);
    expect(enriched.securedRevenue).toBe(0);
    expect(getPlotSecuredRevenue(plot)).toBe(0);
  });

  it('Reserved with stray sellingPrice is still not secured', () => {
    const plot = manualPlot({
      revenueStatus: 'Reserved',
      sellingPrice: 250000,
    });
    const enriched = enrichPlotWithPricing(plot, strategy, {});
    expect(enriched.forecastRevenue).toBe(255100);
    expect(enriched.securedRevenue).toBe(0);
    expect(getPlotSecuredRevenue(plot)).toBe(0);
    expect(getPlotEffectivePrice(plot)).toBe(255100);
  });

  it('Exchanged uses sellingPrice for Forecast and Secured', () => {
    const plot = manualPlot({
      revenueStatus: 'Exchanged',
      sellingPrice: 255100,
    });
    const enriched = enrichPlotWithPricing(plot, strategy, {});
    expect(enriched.forecastRevenue).toBe(255100);
    expect(enriched.securedRevenue).toBe(255100);
    expect(enriched.remainingForecastRevenue).toBe(0);
    expect(enriched.effectivePrice).toBe(255100);
    expect(getPlotEffectivePrice(plot)).toBe(255100);
    expect(getPlotForecastRevenue(plot)).toBe(255100);
  });

  it('Completed after Exchange leaves Secured unchanged', () => {
    const exchanged = enrichPlotWithPricing(
      manualPlot({ revenueStatus: 'Exchanged', sellingPrice: 255100 }),
      strategy,
      {}
    );
    const completed = enrichPlotWithPricing(
      manualPlot({ revenueStatus: 'Completed', sellingPrice: 255100 }),
      strategy,
      {}
    );
    expect(completed.securedRevenue).toBe(exchanged.securedRevenue);
    expect(completed.forecastRevenue).toBe(exchanged.forecastRevenue);
    expect(calculateRecognisedRevenue([completed])).toBe(255100);
    expect(calculateSecuredRevenue([exchanged])).toBe(255100);
    expect(calculateSecuredRevenue([completed])).toBe(255100);
  });

  it('Exchange at a different price from forecast moves development Forecast', () => {
    const available = manualPlot({
      id: 'a',
      plotNumber: '31',
      revenueStatus: 'Available',
      manualForecastValue: 255100,
    });
    const neighbour = manualPlot({
      id: 'b',
      plotNumber: '22',
      revenueStatus: 'Available',
      manualForecastValue: 535500,
      forecastSellingPrice: 535500,
    });
    const before = buildRevenueSummary({
      pricedPlots: enrichPlotsWithPricing([available, neighbour], strategy, {}),
      plots: [available, neighbour],
    });

    const exchanged = {
      ...available,
      revenueStatus: 'Exchanged',
      sellingPrice: 250000,
    };
    const after = buildRevenueSummary({
      pricedPlots: enrichPlotsWithPricing([exchanged, neighbour], strategy, {}),
      plots: [exchanged, neighbour],
    });

    expect(before.forecastRevenue).toBe(255100 + 535500);
    expect(before.securedRevenue).toBe(0);
    expect(after.forecastRevenue).toBe(250000 + 535500);
    expect(after.securedRevenue).toBe(250000);
    expect(after.remainingForecast).toBe(535500);
    expect(after.forecastRevenue - before.forecastRevenue).toBe(250000 - 255100);
  });

  it('Cancelled contributes £0 to forecast and secured', () => {
    const plot = manualPlot({
      revenueStatus: 'Cancelled',
      sellingPrice: 255100,
      manualForecastValue: 255100,
    });
    const enriched = enrichPlotWithPricing(plot, strategy, {});
    expect(enriched.forecastRevenue).toBe(0);
    expect(enriched.securedRevenue).toBe(0);
    expect(getPlotEffectivePrice(plot)).toBe(0);
  });

  it('backwards correction from Exchanged removes secured and restores forecast', () => {
    const exchanged = manualPlot({
      revenueStatus: 'Exchanged',
      sellingPrice: 255100,
    });
    const reverted = manualPlot({
      revenueStatus: 'Available',
      sellingPrice: 255100,
      manualForecastValue: 240100,
      forecastSellingPrice: 240100,
    });
    const after = enrichPlotWithPricing(exchanged, strategy, {});
    const back = enrichPlotWithPricing(reverted, strategy, {});
    expect(after.securedRevenue).toBe(255100);
    expect(back.securedRevenue).toBe(0);
    expect(back.forecastRevenue).toBe(240100);
    expect(getPlotEffectivePrice(reverted)).toBe(240100);
  });

  it('plotsSold equals Exchanged + Completed', () => {
    const plots = [
      manualPlot({ id: '1', plotNumber: '1', revenueStatus: 'Available' }),
      manualPlot({
        id: '2',
        plotNumber: '2',
        revenueStatus: 'Exchanged',
        sellingPrice: 255100,
      }),
      manualPlot({
        id: '3',
        plotNumber: '3',
        revenueStatus: 'Completed',
        sellingPrice: 250000,
      }),
      manualPlot({ id: '4', plotNumber: '4', revenueStatus: 'Cancelled' }),
    ];
    const summary = buildRevenueSummary({
      plots,
      pricedPlots: enrichPlotsWithPricing(plots, strategy, {}),
    });
    expect(summary.plotsSold).toBe(2);
    expect(summary.statusCounts.Exchanged).toBe(1);
    expect(summary.statusCounts.Completed).toBe(1);
    const kpis = buildRevenueDashboardKpis(summary);
    expect(kpis.find((item) => item.key === 'securedRevenue')?.value).toBe(505100);
    expect(kpis.find((item) => item.key === 'recognisedRevenue')).toBeUndefined();
  });

  it('Plot Master price display agrees with Revenue engine', () => {
    const available = manualPlot({ revenueStatus: 'Available' });
    const exchanged = manualPlot({
      revenueStatus: 'Exchanged',
      sellingPrice: 255100,
    });
    expect(getPlotEffectivePrice(available)).toBe(
      enrichPlotWithPricing(available, strategy, {}).effectivePrice
    );
    expect(getPlotEffectivePrice(exchanged)).toBe(
      enrichPlotWithPricing(exchanged, strategy, {}).effectivePrice
    );
  });

  it('does not apply strategy prices onto Exchanged plots', () => {
    const plots = [
      manualPlot({
        revenueStatus: 'Exchanged',
        sellingPrice: 255100,
        revenueSource: 'House Type',
      }),
    ];
    const next = applyStrategyToPlots(plots, strategy, {});
    expect(next[0].sellingPrice).toBe(255100);
    expect(next[0].revenueStatus).toBe('Exchanged');
  });
});

describe('plot lifecycle validation and dates', () => {
  beforeEach(async () => {
    storage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
  });

  it('rejects Exchanged and Completed without sellingPrice > 0', () => {
    expect(
      validatePlot(
        {
          plotNumber: '31',
          houseType: 'Arundel',
          revenueStatus: 'Exchanged',
          sellingPrice: 0,
        },
        []
      )
    ).toContain('Exchanged and Completed plots require a selling price greater than 0.');
    expect(
      validatePlot(
        {
          plotNumber: '31',
          houseType: 'Arundel',
          revenueStatus: 'Completed',
          sellingPrice: '',
        },
        []
      )
    ).toContain('Exchanged and Completed plots require a selling price greater than 0.');
    expect(
      validatePlot(
        {
          plotNumber: '31',
          houseType: 'Arundel',
          revenueStatus: 'Reserved',
          sellingPrice: 0,
        },
        []
      )
    ).toEqual([]);
  });

  it('accepts contractual sellingPrice values that are not £1,000 increments', () => {
    const exchanged = {
      plotNumber: '31',
      houseType: 'Arundel',
      revenueStatus: 'Exchanged',
      sellingPrice: 255100,
    };
    const withPence = {
      plotNumber: '31',
      houseType: 'Arundel',
      revenueStatus: 'Completed',
      sellingPrice: 255100.5,
    };
    expect(validatePlot(exchanged, [])).toEqual([]);
    expect(validatePlot(withPence, [])).toEqual([]);
    expect(getPlotContractPrice(exchanged)).toBe(255100);
    expect(getPlotContractPrice(withPence)).toBe(255100.5);
    expect(getPlotSecuredRevenue(exchanged)).toBe(255100);
    expect(getPlotSecuredRevenue(withPence)).toBe(255100.5);
  });

  it('persists reservedAt/exchangedAt/completedAt without fabricating historic values', async () => {
    const development = await createDevelopment({
      developmentName: 'Lifecycle Dates',
      location: 'Test',
    });

    const added = await addPlot(development.id, {
      plotNumber: '31',
      houseType: 'Arundel',
      niaFt2: 686,
      revenueStatus: 'Available',
      forecastSellingPrice: 255100,
    });
    expect(added.ok).toBe(true);
    expect(added.plot.reservedAt).toBe('');
    expect(added.plot.exchangedAt).toBe('');
    expect(added.plot.completedAt).toBe('');

    const reserved = await updatePlot(development.id, added.plot.id, {
      ...added.plot,
      revenueStatus: 'Reserved',
      reservedAt: '2026-08-21',
    });
    expect(reserved.ok).toBe(true);
    expect(reserved.plot.reservedAt).toBe('2026-08-21');
    expect(reserved.plot.exchangedAt).toBe('');
    expect(reserved.plot.completedAt).toBe('');

    const exchanged = await updatePlot(development.id, added.plot.id, {
      ...reserved.plot,
      revenueStatus: 'Exchanged',
      sellingPrice: 255100,
      exchangedAt: '2026-09-01',
    });
    expect(exchanged.ok).toBe(true);
    expect(exchanged.plot.exchangedAt).toBe('2026-09-01');
    expect(exchanged.plot.reservedAt).toBe('2026-08-21');

    const completed = await updatePlot(development.id, added.plot.id, {
      ...exchanged.plot,
      revenueStatus: 'Completed',
      completedAt: '2026-12-15',
    });
    expect(completed.ok).toBe(true);
    expect(completed.plot.completedAt).toBe('2026-12-15');

    const stored = getPlots(development.id)[0];
    expect(stored.reservedAt).toBe('2026-08-21');
    expect(stored.exchangedAt).toBe('2026-09-01');
    expect(stored.completedAt).toBe('2026-12-15');
  });

  it('persists a non-thousand contractual sellingPrice including pence', async () => {
    const development = await createDevelopment({
      developmentName: 'Contract Price Precision',
      location: 'Test',
    });
    const added = await addPlot(development.id, {
      plotNumber: '31',
      houseType: 'Arundel',
      niaFt2: 686,
      revenueStatus: 'Available',
      forecastSellingPrice: 255100,
    });
    expect(added.ok).toBe(true);

    const exchanged = await updatePlot(development.id, added.plot.id, {
      ...added.plot,
      revenueStatus: 'Exchanged',
      sellingPrice: 255100.5,
    });
    expect(exchanged.ok).toBe(true);
    expect(exchanged.plot.sellingPrice).toBe(255100.5);
    expect(getPlots(development.id)[0].sellingPrice).toBe(255100.5);
  });
});
