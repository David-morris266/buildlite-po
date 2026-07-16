import { describe, expect, it } from 'vitest';
import { buildRevenuePricingModel } from './revenuePricingModel';
import { emptyRevenueStrategy } from './revenueStrategy';

describe('revenuePricingModel', () => {
  const strategy = {
    ...emptyRevenueStrategy(),
    openMarket: { ratePerFt2: 350, effectiveDate: '' },
    garagePremiums: { none: 0, single: 12500, double: 22500 },
  };

  const plots = [
    {
      id: 'plot-1',
      plotNumber: '1',
      houseType: 'Ash',
      niaFt2: 950,
      revenueSource: 'House Type',
      tenure: 'Open Market',
    },
    {
      id: 'plot-2',
      plotNumber: '2',
      houseType: 'Oak',
      niaFt2: 1000,
      revenueSource: 'House Type',
      tenure: 'Open Market',
      garage: 'Single',
      garageOverride: true,
    },
  ];

  const houseTypePricing = {
    Ash: { garage: 'Single', sellingBasis: 'Auto' },
    Oak: { garage: 'None', sellingBasis: 'Auto' },
  };

  it('builds a single shared pricing model for all workspace views', () => {
    const model = buildRevenuePricingModel({ plots, strategy, houseTypePricing });

    expect(model.houseTypeRows).toHaveLength(2);
    expect(model.plotOverrideRows).toHaveLength(2);
    expect(model.pricedPlots).toHaveLength(2);
    expect(model.strategyMetrics.pricedPlotCount).toBe(2);

    expect(model.houseTypeRows.find((row) => row.houseType === 'Ash')?.forecastValue).toBe(345000);
    expect(model.plotOverrideRows[0].forecastSellingPrice).toBe(345000);
    expect(model.plotOverrideRows[0].garage).toBe('Single');
    expect(model.plotOverrideRows[0].garageInherited).toBe(true);
    expect(model.plotOverrideRows[1].garage).toBe('Single');
    expect(model.plotOverrideRows[1].garageInherited).toBe(false);
  });

  it('updates plot forecasts when garage premiums change in strategy preview', () => {
    const previewStrategy = {
      ...strategy,
      garagePremiums: { none: 0, single: 20000, double: 30000 },
    };

    const baseline = buildRevenuePricingModel({ plots, strategy, houseTypePricing });
    const preview = buildRevenuePricingModel({
      plots,
      strategy: previewStrategy,
      houseTypePricing,
    });

    expect(preview.plotOverrideRows[0].forecastSellingPrice).toBeGreaterThan(
      baseline.plotOverrideRows[0].forecastSellingPrice
    );
    expect(preview.strategyMetrics.totalGaragePremium).toBeGreaterThan(
      baseline.strategyMetrics.totalGaragePremium
    );
  });
});
