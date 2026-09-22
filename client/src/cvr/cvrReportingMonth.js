/**
 * BL-033C / BL-033C.1 — Next CVR reporting month.
 * Sequential monthly CVR: previous reportingMonth + 1 calendar month.
 * Do not invent today's date. Do not infer from period key.
 * If previous is missing, leave unresolved until the user selects YYYY-MM.
 */

import { formatNextPeriodKey } from './cvrPeriodStatus';
import { suggestNextReportingMonth, toYearMonth } from '../programme/programmeCalendar';

const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const REPORTING_PERIOD_STATES = Object.freeze({
  CLOSED: 'closed',
  CURRENT: 'current',
  FUTURE: 'future',
});
export const REPORTING_PERIOD_TIME_ZONE = 'Europe/London';

export function isValidReportingYearMonth(value) {
  const raw = String(value || '').trim();
  if (!YEAR_MONTH.test(raw)) return false;
  return toYearMonth(raw) === raw;
}

function currentYearMonth(currentDate = new Date()) {
  const date = currentDate instanceof Date ? currentDate : new Date(currentDate);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: REPORTING_PERIOD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}`;
}

export function classifyReportingPeriod(reportingMonth, currentDate = new Date()) {
  const reporting = toYearMonth(reportingMonth);
  const current = currentYearMonth(currentDate);
  if (!isValidReportingYearMonth(reporting) || !isValidReportingYearMonth(current)) return null;
  if (reporting < current) return REPORTING_PERIOD_STATES.CLOSED;
  if (reporting === current) return REPORTING_PERIOD_STATES.CURRENT;
  return REPORTING_PERIOD_STATES.FUTURE;
}

export function previousClosedCalendarMonth(currentDate = new Date()) {
  const current = currentYearMonth(currentDate);
  if (!current) return null;
  const [year, month] = current.split('-').map(Number);
  const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  return `${previous.year}-${String(previous.month).padStart(2, '0')}`;
}

export function formatReportingPeriod(value) {
  const yearMonth = toYearMonth(value);
  if (!isValidReportingYearMonth(yearMonth)) return '—';
  const [year, month] = yearMonth.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function reportingMonthForNextCvrPeriod(sourcePeriod, explicitReportingMonth) {
  if (explicitReportingMonth != null && String(explicitReportingMonth).trim() !== '') {
    return toYearMonth(explicitReportingMonth);
  }
  return suggestNextReportingMonth(sourcePeriod?.reportingMonth);
}

export function buildCreateNextReportingMonthPrompt({ periods = [], sourcePeriod = null, currentDate } = {}) {
  const suggestedMonth = sourcePeriod
    ? reportingMonthForNextCvrPeriod(sourcePeriod)
    : previousClosedCalendarMonth(currentDate);
  return {
    suggestedMonth,
    nextPeriodKey: formatNextPeriodKey((periods || []).map((period) => period.periodKey)),
    requiresExplicitSelection: !suggestedMonth,
    reportingPeriodState: classifyReportingPeriod(suggestedMonth, currentDate),
  };
}
