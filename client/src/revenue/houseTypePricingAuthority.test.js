import { describe, expect, it } from 'vitest';
import { validateRepresentativeNia } from './houseTypePricingAuthority';

describe('House Type representative NIA validation', () => {
  it('treats blank as unresolved and accepts finite positive areas', () => {
    expect(validateRepresentativeNia('')).toBe('');
    expect(validateRepresentativeNia(null)).toBe('');
    expect(validateRepresentativeNia('750')).toBe('');
    expect(validateRepresentativeNia(1400.5)).toBe('');
  });

  it('rejects zero, negative, non-numeric, infinite and implausibly large authority', () => {
    for (const value of [0, -1, 'not an area', Infinity, 100001]) {
      expect(validateRepresentativeNia(value)).toMatch(/positive NIA/);
    }
  });
});
