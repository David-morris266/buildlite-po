/**
 * BL-033C — Next CVR reporting month.
 * Sequential monthly CVR: previous reportingMonth + 1 calendar month.
 * Do not invent today's date. If previous is missing, leave unresolved.
 */

import { suggestNextReportingMonth, toYearMonth } from '../programme/programmeCalendar';

export function reportingMonthForNextCvrPeriod(sourcePeriod, explicitReportingMonth) {
  const explicit = toYearMonth(explicitReportingMonth);
  if (explicit) return explicit;
  return suggestNextReportingMonth(sourcePeriod?.reportingMonth);
}
