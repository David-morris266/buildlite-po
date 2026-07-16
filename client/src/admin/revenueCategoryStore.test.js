import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import {
  ensureRevenueCategories,
  getDefaultRevenueCategory,
  listRevenueCategoryNames,
  normalizeRevenueCategory,
} from './revenueCategoryStore';

describe('revenueCategoryStore', () => {
  beforeEach(() => storage.clear());

  it('seeds default categories when store is empty', () => {
    ensureRevenueCategories();
    const names = listRevenueCategoryNames();

    expect(names).toContain('Open Market');
    expect(names).toContain('Affordable Housing');
    expect(names).toContain('Other');
  });

  it('returns Open Market as the default category', () => {
    ensureRevenueCategories();
    expect(getDefaultRevenueCategory()).toBe('Open Market');
  });

  it('normalizes unknown categories to the default', () => {
    ensureRevenueCategories();
    expect(normalizeRevenueCategory('Unknown Category')).toBe('Open Market');
    expect(normalizeRevenueCategory('Affordable Housing')).toBe('Affordable Housing');
  });
});
