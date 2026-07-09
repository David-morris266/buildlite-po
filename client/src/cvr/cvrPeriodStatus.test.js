import { describe, expect, it } from 'vitest';
import {
  canCreateNextCvrPeriod,
  formatNextPeriodKey,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  parsePeriodNumber,
  sortPeriodKeys,
} from './cvrPeriodStatus';

describe('cvrPeriodStatus', () => {
  it('sorts period keys numerically', () => {
    expect(sortPeriodKeys(['P03', 'P01', 'P02'])).toEqual(['P01', 'P02', 'P03']);
  });

  it('formats the next period key', () => {
    expect(formatNextPeriodKey(['P01', 'P02'])).toBe('P03');
    expect(formatNextPeriodKey([])).toBe('P01');
  });

  it('allows editing only in draft', () => {
    expect(isCvrPeriodEditable({ status: 'draft' })).toBe(true);
    expect(isCvrPeriodEditable({ status: 'submitted' })).toBe(false);
    expect(isCvrPeriodLocked({ status: 'locked' })).toBe(true);
  });

  it('blocks next period when a draft exists', () => {
    const gate = canCreateNextCvrPeriod([
      { periodKey: 'P01', status: 'locked' },
      { periodKey: 'P02', status: 'draft' },
    ]);
    expect(gate.ok).toBe(false);
    expect(gate.draftPeriodKey).toBe('P02');
  });

  it('allows next period when latest is locked and no draft exists', () => {
    const gate = canCreateNextCvrPeriod([{ periodKey: 'P01', status: 'locked' }]);
    expect(gate.ok).toBe(true);
  });

  it('parses period numbers', () => {
    expect(parsePeriodNumber('P07')).toBe(7);
  });
});
