/**
 * BL-033C / BL-033C.1 — Next CVR reporting month.
 * Sequential monthly CVR: previous reportingMonth + 1 calendar month.
 * Do not invent today's date. Do not infer from period key.
 * If previous is missing, leave unresolved until the user selects YYYY-MM.
 */

import { formatNextPeriodKey } from './cvrPeriodStatus';
import { suggestNextReportingMonth, toYearMonth } from '../programme/programmeCalendar';

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidReportingYearMonth(value) {
  const raw = String(value || '').trim();
  if (!YEAR_MONTH.test(raw)) return false;
  return toYearMonth(raw) === raw;
}

export function reportingMonthForNextCvrPeriod(sourcePeriod, explicitReportingMonth) {
  if (explicitReportingMonth != null && String(explicitReportingMonth).trim() !== '') {
    return toYearMonth(explicitReportingMonth);
  }
  return suggestNextReportingMonth(sourcePeriod?.reportingMonth);
}

export function buildCreateNextReportingMonthPrompt({ periods = [], sourcePeriod = null } = {}) {
  return {
    suggestedMonth: reportingMonthForNextCvrPeriod(sourcePeriod),
    nextPeriodKey: formatNextPeriodKey((periods || []).map((period) => period.periodKey)),
    requiresExplicitSelection: !reportingMonthForNextCvrPeriod(sourcePeriod),
  };
}
