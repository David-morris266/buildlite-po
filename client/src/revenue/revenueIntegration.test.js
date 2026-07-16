import { describe, expect, it } from 'vitest';
import {
  getPlotTenureLabel,
  getTenureBadgeTone,
  normalizeTenureLabel,
} from './tenureDisplay';
import { buildPlotOverrideRows } from './revenueStrategyCalculations';
import { emptyRevenueStrategy } from './revenueStrategy';
import { auditPlotPricingSources, validatePlotPricingConsistency } from './revenuePricingValidation';

describe('tenureDisplay', () => {
  it('normalizes accepted tenure labels', () => {
    expect(normalizeTenureLabel('private')).toBe('Open Market');
    expect(normalizeTenureLabel('Affordable Rent')).toBe('Affordable Rent');
    expect(normalizeTenureLabel('dms')).toBe('Discount Market Sale');
    expect(normalizeTenureLabel('Social Shared')).toBe('Shared Ownership');
  });

  it('derives tenure labels from plot master tenure', () => {
    expect(getPlotTenureLabel({ tenure: 'Shared Ownership' })).toBe('Shared Ownership');
    expect(getPlotTenureLabel({ tenure: 'Social Shared' })).toBe('Shared Ownership');
    expect(getPlotTenureLabel({ revenueCategory: 'First Homes' })).toBe('First Homes');
  });

  it('maps tenure badge tones', () => {
    expect(getTenureBadgeTone('Open Market')).toBe('open-market');
    expect(getTenureBadgeTone('Affordable Rent')).toBe('affordable-rent');
    expect(getTenureBadgeTone('First Homes')).toBe('first-homes');
  });
});

describe('revenuePricingValidation', () => {
  it('validates a single canonical revenue source per plot', () => {
    const result = validatePlotPricingConsistency({
      revenueSource: 'House Type',
      pricingSource: 'House Type',
    });
    expect(result.valid).toBe(true);
    expect(result.source).toBe('House Type');
  });

  it('flags multiple declared revenue sources', () => {
    const result = validatePlotPricingConsistency({
      revenueSource: 'House Type',
      pricingSource: 'Manual Value',
    });
    expect(result.valid).toBe(false);
    expect(result.issues[0]).toContain('Multiple revenue sources');
  });

  it('audits plot pricing source counts', () => {
    const audit = auditPlotPricingSources([
      { id: '1', plotNumber: '1', revenueSource: 'House Type' },
      { id: '2', plotNumber: '2', revenueSource: 'Plot Override', plotOverrideValue: 300000 },
      { id: '3', plotNumber: '3', revenueSource: 'Manual Value', manualForecastValue: 250000 },
    ]);

    expect(audit.sourceCounts['House Type']).toBe(1);
    expect(audit.sourceCounts['Plot Override']).toBe(1);
    expect(audit.sourceCounts['Manual Value']).toBe(1);
    expect(audit.isConsistent).toBe(true);
  });
});

describe('buildPlotOverrideRows garage integration', () => {
  const strategy = {
    ...emptyRevenueStrategy(),
    openMarket: { ratePerFt2: 350, effectiveDate: '' },
    garagePremiums: { none: 0, single: 12500, double: 22500 },
  };

  it('includes garage premium in plot forecast for plot-specific garage overrides', () => {
    const rows = buildPlotOverrideRows(
      [
        {
          id: 'plot-1',
          plotNumber: '1',
          houseType: 'Ash',
          niaFt2: 950,
          revenueSource: 'House Type',
          garage: 'Single',
          garageOverride: true,
          tenure: 'Open Market',
        },
      ],
      strategy,
      { Ash: { garage: 'None', sellingBasis: 'Auto' } }
    );

    expect(rows[0].forecastSellingPrice).toBe(345000);
    expect(rows[0].garage).toBe('Single');
    expect(rows[0].garageInherited).toBe(false);
  });

  it('inherits house type garage when plot has no garage override', () => {
    const rows = buildPlotOverrideRows(
      [
        {
          id: 'plot-2',
          plotNumber: '2',
          houseType: 'Oak',
          niaFt2: 1000,
          revenueSource: 'House Type',
          tenure: 'Open Market',
        },
      ],
      strategy,
      { Oak: { garage: 'Double', sellingBasis: 'Auto' } }
    );

    expect(rows[0].forecastSellingPrice).toBe(372500);
    expect(rows[0].garage).toBe('Double');
    expect(rows[0].garageInherited).toBe(true);
  });
});
