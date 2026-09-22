const REPORTING_PERIOD_STATES = Object.freeze({
  CLOSED: "closed",
  CURRENT: "current",
  FUTURE: "future",
});

const REPORTING_MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/;
const UK_TIME_ZONE = "Europe/London";

function yearMonthParts(value) {
  const match = String(value || "").trim().match(REPORTING_MONTH_PATTERN);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function currentYearMonth(currentDate = new Date()) {
  const date = currentDate instanceof Date ? currentDate : new Date(currentDate);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: UK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value),
    month: Number(parts.find((part) => part.type === "month")?.value),
  };
}

function classifyReportingPeriod(reportingMonth, currentDate = new Date()) {
  const reporting = yearMonthParts(reportingMonth);
  const current = currentYearMonth(currentDate);
  if (!reporting || !current) return null;
  const reportingIndex = reporting.year * 12 + reporting.month;
  const currentIndex = current.year * 12 + current.month;
  if (reportingIndex < currentIndex) return REPORTING_PERIOD_STATES.CLOSED;
  if (reportingIndex === currentIndex) return REPORTING_PERIOD_STATES.CURRENT;
  return REPORTING_PERIOD_STATES.FUTURE;
}

module.exports = {
  REPORTING_PERIOD_STATES,
  UK_TIME_ZONE,
  classifyReportingPeriod,
};
