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
  stampLifecycleDatesOnStatusChange,
} from './plotCommercial';

describe('plotCommercial', () => {
  it('uses status-aware forecast before contractual selling price', () => {
    expect(
      getPlotEffectivePrice({
        revenueStatus: 'Available',
        sellingPrice: 300000,
        forecastSellingPrice: 325000,
      })
    ).toBe(325000);
    expect(
      getPlotEffectivePrice({
        revenueStatus: 'Available',
        sellingPrice: 300000,
        forecastSellingPrice: 0,
      })
    ).toBe(0);
  });

  it('calculates per ft2 and per m2 from NIA', () => {
    const plot = { forecastSellingPrice: 300000, niaFt2: 1000, niaM2: 93, revenueStatus: 'Available' };
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
    expect(commercial.reservedAt).toBe('');
    expect(commercial.exchangedAt).toBe('');
    expect(commercial.completedAt).toBe('');
  });

  it('does not fabricate lifecycle dates for existing plots', () => {
    const commercial = normalizePlotCommercialFields({
      revenueStatus: 'Available',
      forecastSellingPrice: 255100,
    });
    expect(commercial.reservedAt).toBe('');
    expect(commercial.exchangedAt).toBe('');
    expect(commercial.completedAt).toBe('');
  });

  it('stamps only the matching empty date when status changes', () => {
    const now = new Date(2026, 7, 20, 12, 0, 0);
    const reserved = stampLifecycleDatesOnStatusChange({ revenueStatus: 'Available' }, 'Reserved', now);
    expect(reserved.reservedAt).toBe('2026-08-20');
    expect(reserved.exchangedAt).toBe('');
    expect(reserved.completedAt).toBe('');

    const exchanged = stampLifecycleDatesOnStatusChange(reserved, 'Exchanged', now);
    expect(exchanged.reservedAt).toBe('2026-08-20');
    expect(exchanged.exchangedAt).toBe('2026-08-20');
    expect(exchanged.completedAt).toBe('');

    const completed = stampLifecycleDatesOnStatusChange(exchanged, 'Completed', now);
    expect(completed.completedAt).toBe('2026-08-20');
    expect(completed.exchangedAt).toBe('2026-08-20');
  });

  it('does not overwrite an existing lifecycle date on status change', () => {
    const next = stampLifecycleDatesOnStatusChange(
      { revenueStatus: 'Reserved', reservedAt: '2026-07-01' },
      'Reserved',
      new Date(2026, 7, 20, 12, 0, 0)
    );
    expect(next.reservedAt).toBe('2026-07-01');
  });
});
