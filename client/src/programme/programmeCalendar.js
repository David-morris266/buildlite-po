/**
 * BL-033C — Inclusive calendar-month helpers (client).
 * V1: no partial-month proration. Month 1 = calendar month containing siteStart.
 */

export function parseIsoDateParts(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 1;
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  return { year, month, day };
}

export function toYearMonth(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}`;
}

export function toIsoDate(value) {
  const parts = parseIsoDateParts(value);
  if (!parts) return null;
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function addCalendarMonths(value, delta) {
  const parts = parseIsoDateParts(value);
  if (!parts || !Number.isInteger(delta)) return null;
  const zeroBased = parts.year * 12 + (parts.month - 1) + delta;
  const year = Math.floor(zeroBased / 12);
  const month = (zeroBased % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function inclusiveCalendarMonthCount(startDate, endDate) {
  const start = parseIsoDateParts(startDate);
  const end = parseIsoDateParts(endDate);
  if (!start || !end) return null;
  const startIndex = start.year * 12 + (start.month - 1);
  const endIndex = end.year * 12 + (end.month - 1);
  if (endIndex < startIndex) return null;
  return endIndex - startIndex + 1;
}

export function suggestNextReportingMonth(previousReportingMonth) {
  return addCalendarMonths(previousReportingMonth, 1);
}
