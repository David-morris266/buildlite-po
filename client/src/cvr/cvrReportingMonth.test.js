/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPORTING_PERIOD_STATES,
  buildCreateNextReportingMonthPrompt,
  classifyReportingPeriod,
  formatReportingPeriod,
  isValidReportingYearMonth,
  previousClosedCalendarMonth,
  reportingMonthForNextCvrPeriod,
} from './cvrReportingMonth';

describe('BL-033C.1 next CVR reporting month', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not invent a suggestion when previous reportingMonth is null', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: null })).toBeNull();
    expect(reportingMonthForNextCvrPeriod(null)).toBeNull();
    expect(buildCreateNextReportingMonthPrompt({
      periods: [{ periodKey: 'P03' }],
      sourcePeriod: { periodKey: 'P03', reportingMonth: null },
    })).toMatchObject({
      suggestedMonth: null,
      nextPeriodKey: 'P04',
      requiresExplicitSelection: true,
    });
  });

  it('suggests previous reportingMonth plus one calendar month', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-08' })).toBe('2026-09');
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-08-01' })).toBe('2026-09');
  });

  it('rolls December into January of the next year', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-12' })).toBe('2027-01');
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-12-01' })).toBe('2027-01');
  });

  it('rejects invalid YYYY-MM values', () => {
    expect(isValidReportingYearMonth('')).toBe(false);
    expect(isValidReportingYearMonth('2026-13')).toBe(false);
    expect(isValidReportingYearMonth('2026-00')).toBe(false);
    expect(isValidReportingYearMonth('P03')).toBe(false);
    expect(isValidReportingYearMonth('2026-08-01')).toBe(false);
    expect(isValidReportingYearMonth('2026-08')).toBe(true);
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-08' }, 'not-a-month')).toBeNull();
  });

  it('does not use today when previous reportingMonth is null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-03-15T12:00:00.000Z'));
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: null })).toBeNull();
    expect(buildCreateNextReportingMonthPrompt({
      sourcePeriod: { reportingMonth: null },
    }).suggestedMonth).toBeNull();
  });

  it('does not infer a month from the period key', () => {
    expect(reportingMonthForNextCvrPeriod({ periodKey: 'P03', reportingMonth: null })).toBeNull();
    expect(reportingMonthForNextCvrPeriod({ periodKey: 'P01', reportingMonth: '2026-08' })).toBe('2026-09');
  });

  it('accepts an explicit month instead of inventing one', () => {
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: null }, '2026-11')).toBe('2026-11');
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-08' }, '2026-10')).toBe('2026-10');
  });
});

describe('closed Reporting Period semantics', () => {
  const now = new Date('2026-10-08T12:00:00.000Z');

  it('classifies closed, current and future months deterministically', () => {
    expect(classifyReportingPeriod('2026-09', now)).toBe(REPORTING_PERIOD_STATES.CLOSED);
    expect(classifyReportingPeriod('2026-10', now)).toBe(REPORTING_PERIOD_STATES.CURRENT);
    expect(classifyReportingPeriod('2026-11', now)).toBe(REPORTING_PERIOD_STATES.FUTURE);
  });

  it('suggests the previous calendar month for the first CVR', () => {
    expect(previousClosedCalendarMonth(now)).toBe('2026-09');
    expect(buildCreateNextReportingMonthPrompt({ currentDate: now })).toMatchObject({
      suggestedMonth: '2026-09',
      reportingPeriodState: 'closed',
      requiresExplicitSelection: false,
    });
  });

  it('preserves sequential next-period arithmetic and year rollover', () => {
    expect(buildCreateNextReportingMonthPrompt({
      sourcePeriod: { reportingMonth: '2026-09' },
      currentDate: now,
    })).toMatchObject({ suggestedMonth: '2026-10', reportingPeriodState: 'current' });
    expect(reportingMonthForNextCvrPeriod({ reportingMonth: '2026-12' })).toBe('2027-01');
  });

  it('formats Reporting Period for people and never infers a missing historic month', () => {
    expect(formatReportingPeriod('2026-09-01')).toBe('September 2026');
    expect(formatReportingPeriod(null)).toBe('—');
  });
});
