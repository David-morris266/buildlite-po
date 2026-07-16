import { describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import {
  classifyRevenueBucket,
  getPlotEffectivePrice,
  getPlotPerFt2,
  getPlotPerM2,
  normalizePlotCommercialFields,
} from './plotCommercial';

describe('plotCommercial', () => {
  it('uses forecast price before selling price', () => {
    expect(
      getPlotEffectivePrice({ sellingPrice: 300000, forecastSellingPrice: 325000 })
    ).toBe(325000);
    expect(getPlotEffectivePrice({ sellingPrice: 300000, forecastSellingPrice: 0 })).toBe(300000);
  });

  it('calculates per ft2 and per m2 from NIA', () => {
    const plot = { sellingPrice: 300000, niaFt2: 1000, niaM2: 93 };
    expect(getPlotPerFt2(plot)).toBe(300);
    expect(getPlotPerM2(plot)).toBeCloseTo(3225.81, 1);
  });

  it('falls back to GIA for NIA ft2', () => {
    const commercial = normalizePlotCommercialFields({ gia: 950 });
    expect(commercial.niaFt2).toBe(950);
    expect(commercial.niaM2).toBeGreaterThan(0);
  });

  it('classifies revenue categories into buckets', () => {
    expect(classifyRevenueBucket('Open Market')).toBe('openMarket');
    expect(classifyRevenueBucket('Affordable Housing')).toBe('affordable');
    expect(classifyRevenueBucket('Shared Ownership')).toBe('affordable');
    expect(classifyRevenueBucket('Commercial')).toBe('other');
  });

  it('defaults revenue category and status', () => {
    const commercial = normalizePlotCommercialFields({});
    expect(commercial.revenueCategory).toBe('Open Market');
    expect(commercial.revenueStatus).toBe('Available');
  });
});
