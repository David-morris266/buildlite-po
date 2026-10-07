/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  formatProgrammeDateUk,
  inclusiveCalendarMonthCount,
  isCanonicalProgrammeDate,
  parseCanonicalProgrammeDate,
  suggestNextReportingMonth,
  toYearMonth,
} from './programmeCalendar';

describe('BL-033C programme calendar helpers', () => {
  it('enforces genuine four-digit programme calendar dates', () => {
    expect(parseCanonicalProgrammeDate('2027-03-01')?.iso).toBe('2027-03-01');
    expect(isCanonicalProgrammeDate('2028-02-29')).toBe(true);
    for (const value of ['27-03-01', '0027-03-01', '01/03/2027', '2027-02-29', '2027-04-31']) {
      expect(isCanonicalProgrammeDate(value)).toBe(false);
    }
  });

  it('formats canonical programme dates for read-only UK presentation without Date parsing', () => {
    expect(formatProgrammeDateUk('2027-03-01')).toBe('01/03/2027');
    expect(formatProgrammeDateUk('2030-08-31')).toBe('31/08/2030');
    expect(formatProgrammeDateUk('27-03-01')).toBeNull();
  });

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
