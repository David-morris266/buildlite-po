/**
 * BL-033D.1 — Pure TIME / LUMP_SUM proposal calculations (client).
 * Does not read committed/certified/actual. Does not write CVR money.
 * forecastAsAt is the CVR reporting month. Never today.
 */

import { inclusiveCalendarMonthCount, toIsoDate, toYearMonth } from '../programme/programmeCalendar';
import {
  PRELIMS_CALC_STATES,
  PRELIMS_DRIVERS,
  PRELIMS_STATUSES,
  PRELIMS_UNRESOLVED_REASONS,
  TIME_BASES,
} from './prelimsConstants';

export function roundMoney(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function emptyCalculation(overrides = {}) {
  return {
    state: PRELIMS_CALC_STATES.UNRESOLVED,
    reason: null,
    resolvedStart: null,
    resolvedEnd: null,
    totalMonths: null,
    elapsedMonths: null,
    remainingMonths: null,
    totalForecast: null,
    forecastToDate: null,
    forecastToComplete: null,
    assumptionAmount: null,
    remainingExposure: null,
    includedInActiveProposal: false,
    ...overrides,
  };
}

function unresolved(reason, extra = {}) {
  return emptyCalculation({
    state: PRELIMS_CALC_STATES.UNRESOLVED,
    reason,
    ...extra,
  });
}

function invalid(reason, extra = {}) {
  return emptyCalculation({
    state: PRELIMS_CALC_STATES.INVALID,
    reason,
    ...extra,
  });
}

function isActive(status) {
  return String(status || PRELIMS_STATUSES.ACTIVE) === PRELIMS_STATUSES.ACTIVE;
}

function isComplete(status) {
  return String(status) === PRELIMS_STATUSES.COMPLETE;
}

function isCancelled(status) {
  return String(status) === PRELIMS_STATUSES.CANCELLED;
}

export function resolveBasisDate(basis, fixedDate, programme = {}) {
  const key = String(basis || '').trim();
  if (key === TIME_BASES.SITE_START) return toIsoDate(programme.siteStart) || null;
  if (key === TIME_BASES.FIRST_COMPLETION) return toIsoDate(programme.firstCompletion) || null;
  if (key === TIME_BASES.FINAL_COMPLETION) return toIsoDate(programme.finalCompletion) || null;
  if (key === TIME_BASES.FIXED_DATE) return toIsoDate(fixedDate) || null;
  return null;
}

function unresolvedReasonForBasis(basis, kind) {
  const key = String(basis || '').trim();
  if (key === TIME_BASES.SITE_START) return PRELIMS_UNRESOLVED_REASONS.MISSING_SITE_START;
  if (key === TIME_BASES.FIRST_COMPLETION) return PRELIMS_UNRESOLVED_REASONS.MISSING_FIRST_COMPLETION;
  if (key === TIME_BASES.FINAL_COMPLETION) return PRELIMS_UNRESOLVED_REASONS.MISSING_FINAL_COMPLETION;
  if (key === TIME_BASES.FIXED_DATE) {
    return kind === 'start'
      ? PRELIMS_UNRESOLVED_REASONS.MISSING_FIXED_START_DATE
      : PRELIMS_UNRESOLVED_REASONS.MISSING_FIXED_END_DATE;
  }
  return PRELIMS_UNRESOLVED_REASONS.MISSING_PROGRAMME;
}

export function elapsedCalendarMonths(startDate, endDate, reportingMonth) {
  const total = inclusiveCalendarMonthCount(startDate, endDate);
  const startYm = toYearMonth(startDate);
  const endYm = toYearMonth(endDate);
  const asAtYm = toYearMonth(reportingMonth);
  if (total == null || !startYm || !endYm || !asAtYm) return null;
  if (asAtYm < startYm) return 0;
  if (asAtYm >= endYm) return total;
  return inclusiveCalendarMonthCount(startDate, asAtYm);
}

function applyStatusToAssumption(calculation, status, assumptionAmount) {
  if (isCancelled(status)) {
    return {
      ...calculation,
      assumptionAmount,
      remainingExposure: 0,
      includedInActiveProposal: false,
    };
  }
  if (isComplete(status)) {
    return {
      ...calculation,
      assumptionAmount,
      remainingExposure: 0,
      forecastToComplete: 0,
      includedInActiveProposal: false,
    };
  }
  return {
    ...calculation,
    assumptionAmount,
    remainingExposure:
      calculation.remainingExposure != null ? calculation.remainingExposure : assumptionAmount,
    includedInActiveProposal: calculation.state === PRELIMS_CALC_STATES.RESOLVED,
  };
}

export function resolveTimeSpan(line = {}, programme = null) {
  if (String(line.forecastDriver || '').trim() !== PRELIMS_DRIVERS.TIME) {
    return {
      state: PRELIMS_CALC_STATES.RESOLVED,
      reason: null,
      resolvedStart: null,
      resolvedEnd: null,
      totalMonths: null,
    };
  }

  if (!programme || (!programme.siteStart && !programme.finalCompletion && !programme.firstCompletion)) {
    const needsProgramme =
      line.startBasis !== TIME_BASES.FIXED_DATE || line.endBasis !== TIME_BASES.FIXED_DATE;
    if (needsProgramme) {
      return {
        state: PRELIMS_CALC_STATES.UNRESOLVED,
        reason: PRELIMS_UNRESOLVED_REASONS.MISSING_PROGRAMME,
        resolvedStart: null,
        resolvedEnd: null,
        totalMonths: null,
      };
    }
  }

  const resolvedStart = resolveBasisDate(line.startBasis, line.startFixedDate, programme || {});
  if (!resolvedStart) {
    return {
      state: PRELIMS_CALC_STATES.UNRESOLVED,
      reason: unresolvedReasonForBasis(line.startBasis, 'start'),
      resolvedStart: null,
      resolvedEnd: null,
      totalMonths: null,
    };
  }
  const resolvedEnd = resolveBasisDate(line.endBasis, line.endFixedDate, programme || {});
  if (!resolvedEnd) {
    return {
      state: PRELIMS_CALC_STATES.UNRESOLVED,
      reason: unresolvedReasonForBasis(line.endBasis, 'end'),
      resolvedStart,
      resolvedEnd: null,
      totalMonths: null,
    };
  }

  const totalMonths = inclusiveCalendarMonthCount(resolvedStart, resolvedEnd);
  if (totalMonths == null) {
    return {
      state: PRELIMS_CALC_STATES.INVALID,
      reason: PRELIMS_UNRESOLVED_REASONS.INVALID_SPAN,
      resolvedStart,
      resolvedEnd,
      totalMonths: null,
    };
  }

  return {
    state: PRELIMS_CALC_STATES.RESOLVED,
    reason: null,
    resolvedStart,
    resolvedEnd,
    totalMonths,
  };
}

export function calculateTimeLine(line = {}, { programme = null, reportingMonth = null } = {}) {
  const rate = roundMoney(line.monthlyRate);
  if (rate == null || rate < 0) {
    return invalid(PRELIMS_UNRESOLVED_REASONS.INVALID_RATE);
  }

  const asAt = toYearMonth(reportingMonth);
  if (!asAt) {
    return unresolved(PRELIMS_UNRESOLVED_REASONS.MISSING_REPORTING_MONTH);
  }

  const span = resolveTimeSpan({ ...line, forecastDriver: PRELIMS_DRIVERS.TIME }, programme);
  if (span.state !== PRELIMS_CALC_STATES.RESOLVED) {
    return span.state === PRELIMS_CALC_STATES.INVALID
      ? invalid(span.reason, {
          resolvedStart: span.resolvedStart,
          resolvedEnd: span.resolvedEnd,
        })
      : unresolved(span.reason, {
          resolvedStart: span.resolvedStart,
          resolvedEnd: span.resolvedEnd,
        });
  }

  const { resolvedStart, resolvedEnd, totalMonths } = span;

  const elapsedMonths = elapsedCalendarMonths(resolvedStart, resolvedEnd, asAt);
  const remainingMonths = totalMonths - elapsedMonths;
  const totalForecast = roundMoney(rate * totalMonths) ?? 0;
  const forecastToDate = roundMoney(rate * elapsedMonths) ?? 0;
  const forecastToComplete = roundMoney(rate * remainingMonths) ?? 0;

  const resolved = {
    state: PRELIMS_CALC_STATES.RESOLVED,
    reason: null,
    resolvedStart,
    resolvedEnd,
    totalMonths,
    elapsedMonths,
    remainingMonths,
    totalForecast,
    forecastToDate,
    forecastToComplete,
    assumptionAmount: totalForecast,
    remainingExposure: forecastToComplete,
    includedInActiveProposal: false,
  };
  return applyStatusToAssumption(resolved, line.status, totalForecast);
}

export function calculateLumpSumLine(line = {}) {
  const amount = roundMoney(line.lumpSumAmount);
  if (amount == null || amount < 0) {
    return invalid(PRELIMS_UNRESOLVED_REASONS.INVALID_AMOUNT);
  }
  const resolved = {
    state: PRELIMS_CALC_STATES.RESOLVED,
    reason: null,
    resolvedStart: null,
    resolvedEnd: null,
    totalMonths: null,
    elapsedMonths: null,
    remainingMonths: null,
    totalForecast: amount,
    forecastToDate: isActive(line.status) ? 0 : amount,
    forecastToComplete: amount,
    assumptionAmount: amount,
    remainingExposure: amount,
    includedInActiveProposal: false,
  };
  if (isComplete(line.status) || isCancelled(line.status)) {
    resolved.forecastToDate = amount;
    resolved.forecastToComplete = 0;
  }
  return applyStatusToAssumption(resolved, line.status, amount);
}

export function calculatePrelimsLine(line = {}, context = {}) {
  const driver = String(line.forecastDriver || '').trim();
  if (driver === PRELIMS_DRIVERS.TIME) return calculateTimeLine(line, context);
  if (driver === PRELIMS_DRIVERS.LUMP_SUM) return calculateLumpSumLine(line);
  return invalid(PRELIMS_UNRESOLVED_REASONS.INVALID_AMOUNT);
}

function moneyOrNull(values, { anyUnresolved = false } = {}) {
  if (anyUnresolved && !values.length) return null;
  let hasValue = false;
  let total = 0;
  for (const value of values) {
    const money = roundMoney(value);
    if (money == null) continue;
    hasValue = true;
    total += money;
  }
  return hasValue ? roundMoney(total) : anyUnresolved ? null : 0;
}

export function aggregatePrelimsLines(lines = []) {
  const byCostCode = new Map();

  for (const line of lines) {
    const key = String(line.costCodeKey || '').trim() || '(blank)';
    if (!byCostCode.has(key)) {
      byCostCode.set(key, {
        costCodeKey: key,
        lineCount: 0,
        unresolvedCount: 0,
        resolvedZeroCount: 0,
        activeProposal: null,
        remainingExposure: null,
        hasUnresolved: false,
        hasResolvedAmount: false,
      });
    }
    const bucket = byCostCode.get(key);
    bucket.lineCount += 1;
    const calc = line.calculation || {};
    const unresolvedCalc =
      calc.state === PRELIMS_CALC_STATES.UNRESOLVED || calc.state === PRELIMS_CALC_STATES.INVALID;
    if (unresolvedCalc && isActive(line.status)) {
      bucket.unresolvedCount += 1;
      bucket.hasUnresolved = true;
    }
    if (calc.includedInActiveProposal) {
      bucket.hasResolvedAmount = true;
      bucket.activeProposal = roundMoney((bucket.activeProposal || 0) + (calc.totalForecast || 0));
      bucket.remainingExposure = roundMoney(
        (bucket.remainingExposure || 0) + (calc.remainingExposure || 0)
      );
      if (Math.abs(calc.totalForecast || 0) <= 0.005) bucket.resolvedZeroCount += 1;
    }
  }

  const costCodes = [...byCostCode.values()].map((bucket) => {
    if (!bucket.hasResolvedAmount) {
      bucket.activeProposal = bucket.hasUnresolved ? null : 0;
      bucket.remainingExposure = bucket.hasUnresolved ? null : 0;
    }
    return bucket;
  });

  const resolvedProposalParts = costCodes
    .filter((row) => row.hasResolvedAmount)
    .map((row) => row.activeProposal);
  const unresolvedGroups = costCodes.filter((row) => row.hasUnresolved && !row.hasResolvedAmount);

  return {
    byCostCode: costCodes,
    development: {
      lineCount: lines.length,
      unresolvedCount: costCodes.reduce((sum, row) => sum + row.unresolvedCount, 0),
      activeProposal: moneyOrNull(resolvedProposalParts, {
        anyUnresolved: unresolvedGroups.length > 0 && resolvedProposalParts.length === 0,
      }),
      remainingExposure: moneyOrNull(
        costCodes.filter((row) => row.hasResolvedAmount).map((row) => row.remainingExposure),
        {
          anyUnresolved: unresolvedGroups.length > 0 && resolvedProposalParts.length === 0,
        }
      ),
      hasUnresolved: costCodes.some((row) => row.hasUnresolved),
    },
  };
}

export function suggestedPrelimsDriver(classificationDriver) {
  const driver = String(classificationDriver || '').trim();
  if (driver === PRELIMS_DRIVERS.TIME || driver === PRELIMS_DRIVERS.LUMP_SUM) return driver;
  return null;
}
