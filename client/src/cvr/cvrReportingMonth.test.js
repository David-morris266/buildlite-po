/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { reportingMonthForNextCvrPeriod } from './cvrReportingMonth';

describe('BL-033C next CVR reporting month', () => {
  it('derives previous reporting month plus one calendar month', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-01-01' })).toBe('2026-02');
  });

  it('leaves the month unresolved when previous is null and does not use today', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: null })).toBeNull();
    expect(reportingMonthForNextCvrPeriod(null)).toBeNull();
  });

  it('accepts an explicit month instead of inventing one', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: null }, '2026-11')).toBe('2026-11');
  });
});
