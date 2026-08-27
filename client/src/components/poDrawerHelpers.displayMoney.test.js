import { describe, expect, it } from 'vitest';
import {
  formatDisplayMoney,
  formatExactDisplayMoney,
  formatSignedExactDisplayMoney,
  formatSignedDisplayMoney,
} from './poDrawerHelpers';

describe('display money formatting', () => {
  it('removes pence for sub-thousand values', () => {
    expect(formatDisplayMoney(999.99)).toBe('£1,000');
    expect(formatDisplayMoney(250)).toBe('£250');
    expect(formatDisplayMoney(0)).toBe('£0');
  });

  it('abbreviates thousands and millions without pence', () => {
    expect(formatDisplayMoney(2500)).toBe('£2.5k');
    expect(formatDisplayMoney(296700)).toBe('£296.7k');
    expect(formatDisplayMoney(50000)).toBe('£50k');
    expect(formatDisplayMoney(1_500_000)).toBe('£1.5m');
  });

  it('formats signed dashboard values compactly', () => {
    expect(formatSignedDisplayMoney(2500)).toBe('+£2.5k');
    expect(formatSignedDisplayMoney(-3800)).toBe('−£3.8k');
    expect(formatSignedDisplayMoney(0)).toBe('£0');
  });

  it('formats package commercial summary values exactly and preserves material pence', () => {
    expect(formatExactDisplayMoney(5750)).toBe('£5,750');
    expect(formatExactDisplayMoney(13200)).toBe('£13,200');
    expect(formatExactDisplayMoney(1750.25)).toBe('£1,750.25');
    expect(formatSignedExactDisplayMoney(5750)).toBe('+£5,750');
    expect(formatSignedExactDisplayMoney(-13200)).toBe('−£13,200');
  });
});
