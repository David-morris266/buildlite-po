/**
 * BL-033D.x.3R — Readable TIME offset / resolved-month labels.
 */

import { coerceOffsetMonths, toYearMonth } from '../programme/programmeCalendar';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function offsetMonthLabel(value) {
  const n = coerceOffsetMonths(value);
  if (n === 0) return '0 months';
  if (n === 1) return '+1 month';
  if (n === -1) return '-1 month';
  return n > 0 ? `+${n} months` : `${n} months`;
}

export function resolvedMonthLabel(isoDate) {
  const ym = toYearMonth(isoDate);
  if (!ym) return '—';
  const [year, month] = ym.split('-');
  const monthIndex = Number(month) - 1;
  if (monthIndex < 0 || monthIndex > 11) return '—';
  return `${MONTH_LABELS[monthIndex]} ${year}`;
}
