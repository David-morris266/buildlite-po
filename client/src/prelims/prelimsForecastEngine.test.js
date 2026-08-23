/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest';
import {
  aggregatePrelimsLines,
  calculateLumpSumLine,
  calculateTimeLine,
  resolveTimeSpan,
} from './prelimsForecastEngine';
import { PRELIMS_UNRESOLVED_REASONS } from './prelimsConstants';

const TEST_SITE_1 = {
  exists: true,
  siteStart: '2026-09-01',
  firstCompletion: null,
  finalCompletion: '2029-10-01',
};

function timeLine(overrides = {}) {
  return {
    forecastDriver: 'TIME',
    status: 'active',
    monthlyRate: 1000,
    startBasis: 'SITE_START',
    endBasis: 'FINAL_COMPLETION',
    ...overrides,
  };
}

describe('BL-033D.1 Prelims TIME and LUMP_SUM calculations', () => {
  it('resolves TIME duration against the programme before a rate is entered', () => {
    const span = resolveTimeSpan(timeLine({ monthlyRate: null }), TEST_SITE_1);
    expect(span.state).toBe('resolved');
    expect(span.totalMonths).toBe(38);
    expect(span.resolvedStart).toBe('2026-09-01');
    expect(span.resolvedEnd).toBe('2029-10-01');
    expect(calculateTimeLine(timeLine({ monthlyRate: null }), {
      programme: TEST_SITE_1,
      reportingMonth: '2026-08',
    }).reason).toBe(PRELIMS_UNRESOLVED_REASONS.INVALID_RATE);
  });

  it('calculates Test Site 1 SITE_START → FINAL_COMPLETION as 38 months at P04 2026-08', () => {
    const calc = calculateTimeLine(timeLine(), {
      programme: TEST_SITE_1,
      reportingMonth: '2026-08',
    });
    expect(calc.totalMonths).toBe(38);
    expect(calc.totalForecast).toBe(38000);
    expect(calc.elapsedMonths).toBe(0);
    expect(calc.remainingMonths).toBe(38);
    expect(calc.forecastToDate).toBe(0);
    expect(calc.forecastToComplete).toBe(38000);
  });

  it('counts the start month as elapsed 1 and includes the end month', () => {
    expect(
      calculateTimeLine(timeLine(), { programme: TEST_SITE_1, reportingMonth: '2026-09' }).elapsedMonths
    ).toBe(1);
    expect(
      calculateTimeLine(timeLine(), { programme: TEST_SITE_1, reportingMonth: '2029-10' }).elapsedMonths
    ).toBe(38);
    expect(
      calculateTimeLine(timeLine(), { programme: TEST_SITE_1, reportingMonth: '2029-11' }).elapsedMonths
    ).toBe(38);
  });

  it('treats mid-month FIXED_DATE as whole calendar months and allows mixed bases', () => {
    const fixed = calculateTimeLine(
      timeLine({
        startBasis: 'FIXED_DATE',
        startFixedDate: '2026-09-15',
        endBasis: 'FIXED_DATE',
        endFixedDate: '2029-10-20',
      }),
      { programme: TEST_SITE_1, reportingMonth: '2026-08' }
    );
    expect(fixed.totalMonths).toBe(38);
    const mixed = calculateTimeLine(
      timeLine({
        startBasis: 'SITE_START',
        endBasis: 'FIXED_DATE',
        endFixedDate: '2027-01-31',
      }),
      { programme: TEST_SITE_1, reportingMonth: '2026-09' }
    );
    expect(mixed.totalMonths).toBe(5);
  });

  it('leaves missing FIRST_COMPLETION and missing reportingMonth unresolved, not £0', () => {
    const missingFirst = calculateTimeLine(timeLine({ startBasis: 'FIRST_COMPLETION' }), {
      programme: TEST_SITE_1,
      reportingMonth: '2026-08',
    });
    expect(missingFirst.state).toBe('unresolved');
    expect(missingFirst.reason).toBe(PRELIMS_UNRESOLVED_REASONS.MISSING_FIRST_COMPLETION);
    expect(missingFirst.totalForecast).toBeNull();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-12-15T12:00:00Z'));
    const missingMonth = calculateTimeLine(timeLine(), {
      programme: TEST_SITE_1,
      reportingMonth: null,
    });
    expect(missingMonth.reason).toBe(PRELIMS_UNRESOLVED_REASONS.MISSING_REPORTING_MONTH);
    expect(missingMonth.elapsedMonths).toBeNull();
    vi.useRealTimers();
  });

  it('marks start after end as invalid', () => {
    const calc = calculateTimeLine(
      timeLine({
        startBasis: 'FIXED_DATE',
        startFixedDate: '2029-11-01',
        endBasis: 'FINAL_COMPLETION',
      }),
      { programme: TEST_SITE_1, reportingMonth: '2026-08' }
    );
    expect(calc.state).toBe('invalid');
    expect(calc.totalForecast).toBeNull();
  });

  it('keeps LUMP_SUM assumption authoritative and does not auto-complete from spend', () => {
    const active = calculateLumpSumLine({
      lumpSumAmount: 20000,
      status: 'active',
      committed: 50000,
      actualCost: 18000,
    });
    expect(active.assumptionAmount).toBe(20000);
    expect(active.includedInActiveProposal).toBe(true);
    const complete = calculateLumpSumLine({ lumpSumAmount: 20000, status: 'complete' });
    expect(complete.assumptionAmount).toBe(20000);
    expect(complete.remainingExposure).toBe(0);
    expect(complete.includedInActiveProposal).toBe(false);
    const cancelled = calculateLumpSumLine({ lumpSumAmount: 20000, status: 'cancelled' });
    expect(cancelled.includedInActiveProposal).toBe(false);
  });

  it('aggregates by cost code and development without treating unresolved as £0', () => {
    const unresolved = {
      costCodeKey: '5231',
      status: 'active',
      calculation: calculateTimeLine(timeLine({ startBasis: 'FIRST_COMPLETION' }), {
        programme: TEST_SITE_1,
        reportingMonth: '2026-08',
      }),
    };
    const time = {
      costCodeKey: '5231',
      status: 'active',
      calculation: calculateTimeLine(timeLine(), {
        programme: TEST_SITE_1,
        reportingMonth: '2026-08',
      }),
    };
    const zero = {
      costCodeKey: '5200',
      status: 'active',
      calculation: calculateTimeLine(timeLine({ monthlyRate: 0 }), {
        programme: TEST_SITE_1,
        reportingMonth: '2026-08',
      }),
    };
    const summary = aggregatePrelimsLines([unresolved, time, zero]);
    expect(summary.byCostCode.find((row) => row.costCodeKey === '5231').activeProposal).toBe(38000);
    expect(summary.byCostCode.find((row) => row.costCodeKey === '5231').hasUnresolved).toBe(true);
    expect(summary.byCostCode.find((row) => row.costCodeKey === '5200').activeProposal).toBe(0);
    expect(summary.development.activeProposal).toBe(38000);
  });
});
