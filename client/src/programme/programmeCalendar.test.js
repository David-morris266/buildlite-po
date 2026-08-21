/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  inclusiveCalendarMonthCount,
  suggestNextReportingMonth,
  toYearMonth,
} from './programmeCalendar';

describe('BL-033C programme calendar helpers', () => {
  it('counts Test Site 1 Sep 2026 through Oct 2029 as 38 inclusive months', () => {
    expect(inclusiveCalendarMonthCount('2026-09-01', '2029-10-01')).toBe(38);
  });

  it('counts mid-month dates as whole calendar months', () => {
    expect(inclusiveCalendarMonthCount('2026-09-15', '2029-10-20')).toBe(38);
    expect(toYearMonth('2026-09-15')).toBe('2026-09');
  });

  it('does not prorate and rejects inverted spans', () => {
    expect(inclusiveCalendarMonthCount('2029-10-01', '2026-09-01')).toBeNull();
    expect(toYearMonth('2026-09-15')).toBe('2026-09');
  });

  it('does not invent today as the next reporting month', () => {
    expect(suggestNextReportingMonth('2026-01-01')).toBe('2026-02');
    expect(suggestNextReportingMonth(null)).toBeNull();
  });

  it('rolls December into January of the next year', () => {
    expect(suggestNextReportingMonth('2026-12')).toBe('2027-01');
  });
});
