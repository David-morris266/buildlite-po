import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORECAST_DRIVER,
  DEFAULT_SEMANTIC_GROUP,
  FORECAST_DRIVERS,
  SEMANTIC_GROUPS,
  indexClassificationsByKey,
  lookupClassification,
  normalizeCostCodeKey,
  unmappedClassification,
} from './costCodeClassification';
import { calculateFinalForecast, calculateSystemForecast } from '../cvr/cvrForecastEngine';

describe('BL-033B cost-code classification', () => {
  it('defaults unmapped codes to UNCLASSIFIED + STANDARD_CVR, never OTHER', () => {
    const unmapped = unmappedClassification('5231');
    expect(unmapped.semanticGroup).toBe(SEMANTIC_GROUPS.UNCLASSIFIED);
    expect(unmapped.forecastDriver).toBe(FORECAST_DRIVERS.STANDARD_CVR);
    expect(unmapped.exists).toBe(false);
    expect(DEFAULT_SEMANTIC_GROUP).not.toBe(SEMANTIC_GROUPS.OTHER);
    expect(DEFAULT_FORECAST_DRIVER).toBe('STANDARD_CVR');
  });

  it('preserves hyphenated customer keys and strips descriptions', () => {
    expect(normalizeCostCodeKey('P100-SM')).toBe('P100-SM');
    expect(normalizeCostCodeKey('P100-SM — Site Manager')).toBe('P100-SM');
    expect(normalizeCostCodeKey('5231 — Cleaning')).toBe('5231');
    expect(normalizeCostCodeKey('05.210')).toBe('05.210');
  });

  it('looks up persisted PRELIMS + STANDARD_CVR and PRELIMS + TIME as metadata', () => {
    const byKey = indexClassificationsByKey([
      {
        exists: true,
        costCodeKey: '5231',
        semanticGroup: 'PRELIMS',
        forecastDriver: 'STANDARD_CVR',
        version: 1,
      },
      {
        exists: true,
        costCodeKey: 'P100-SM',
        semanticGroup: 'PRELIMS',
        forecastDriver: 'TIME',
        version: 2,
      },
    ]);
    expect(lookupClassification(byKey, '5231 — Cleaning')).toMatchObject({
      semanticGroup: 'PRELIMS',
      forecastDriver: 'STANDARD_CVR',
      exists: true,
    });
    expect(lookupClassification(byKey, 'p100-sm')).toMatchObject({
      semanticGroup: 'PRELIMS',
      forecastDriver: 'TIME',
    });
    expect(lookupClassification(byKey, '9999')).toMatchObject({
      semanticGroup: 'UNCLASSIFIED',
      forecastDriver: 'STANDARD_CVR',
      exists: false,
    });
  });

  it('does not infer semantic group from Commercial Head labels', () => {
    const byKey = indexClassificationsByKey([]);
    expect(lookupClassification(byKey, '1300').semanticGroup).toBe('UNCLASSIFIED');
    expect(SEMANTIC_GROUPS.PRELIMS).not.toBe('Preliminaries');
  });

  it('does not change CVR forecast formulas', () => {
    expect(
      calculateSystemForecast({ committed: 50250, actualCost: 0, currentBudget: 0 })
    ).toBe(50250);
    expect(calculateFinalForecast(50250, 500)).toBe(50750);
  });
});
