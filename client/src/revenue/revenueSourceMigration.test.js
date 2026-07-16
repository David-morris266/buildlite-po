import { describe, expect, it } from 'vitest';
import {
  countRevenueSources,
  isGenuineManualOverride,
  isMisclassifiedManualPlot,
  migrateSinglePlotPricing,
} from './revenueSourceMigration';

describe('revenueSourceMigration', () => {
  it('treats explicit manual overrides as genuine', () => {
    expect(
      isGenuineManualOverride({
        revenueSource: 'Manual Value',
        manualForecastValue: 275000,
      })
    ).toBe(true);
    expect(
      isGenuineManualOverride({
        revenueSource: 'Manual Value',
        manualOverrideExplicit: true,
      })
    ).toBe(true);
  });

  it('does not treat engine forecasts as manual overrides', () => {
    expect(
      isGenuineManualOverride({
        revenueSource: 'House Type',
        forecastSellingPrice: 275000,
      })
    ).toBe(false);
  });

  it('detects misclassified manual plots from bad migration', () => {
    expect(
      isMisclassifiedManualPlot({
        revenueSource: 'Manual Value',
        manualForecastValue: 275000,
        pricingMigrated: true,
      })
    ).toBe(true);
  });

  it('defaults unmigrated forecast-only plots to House Type', () => {
    const next = migrateSinglePlotPricing({
      plotNumber: '1',
      forecastSellingPrice: 275000,
      pricingMigrated: false,
    });

    expect(next.revenueSource).toBe('House Type');
    expect(next.manualForecastValue).toBe(0);
    expect(next.pricingMigrated).toBe(true);
    expect(next.manualOverrideExplicit).toBe(false);
  });

  it('preserves genuine legacy manual overrides', () => {
    const next = migrateSinglePlotPricing({
      plotNumber: '2',
      revenueSource: 'Manual Value',
      manualForecastValue: 300000,
      pricingMigrated: false,
    });

    expect(next.revenueSource).toBe('Manual Value');
    expect(next.manualForecastValue).toBe(300000);
    expect(next.manualOverrideExplicit).toBe(true);
    expect(next.pricingMigrated).toBe(true);
  });

  it('repairs misclassified manual plots to House Type', () => {
    const next = migrateSinglePlotPricing({
      plotNumber: '3',
      revenueSource: 'Manual Value',
      manualForecastValue: 275000,
      forecastSellingPrice: 275000,
      pricingMigrated: true,
    });

    expect(next.revenueSource).toBe('House Type');
    expect(next.manualForecastValue).toBe(0);
    expect(next.manualOverrideExplicit).toBe(false);
  });

  it('counts revenue sources for diagnostics', () => {
    const counts = countRevenueSources([
      { revenueSource: 'House Type' },
      { revenueSource: 'Development Strategy' },
      { revenueSource: 'Plot Override' },
      {
        revenueSource: 'Manual Value',
        manualForecastValue: 100000,
        pricingMigrated: true,
      },
      {
        revenueSource: 'Manual Value',
        manualForecastValue: 200000,
        manualOverrideExplicit: true,
      },
    ]);

    expect(counts.total).toBe(5);
    expect(counts.houseType).toBe(1);
    expect(counts.developmentStrategy).toBe(1);
    expect(counts.plotOverride).toBe(1);
    expect(counts.manualValue).toBe(2);
    expect(counts.misclassifiedManual).toBe(1);
  });
});
