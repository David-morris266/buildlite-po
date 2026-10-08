const { CVR_PERIOD_TYPES } = require("./cvrPeriodConstants");

function toYearMonth(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return null;
}

function periodTypeOf(period) {
  return period?.periodType || period?.period_type || CVR_PERIOD_TYPES.monthly;
}

function isSiteStartPeriod(period) {
  return periodTypeOf(period) === CVR_PERIOD_TYPES.siteStart;
}

function effectiveForecastMonth(period) {
  return toYearMonth(
    isSiteStartPeriod(period)
      ? period?.forecastAsAtMonth ?? period?.forecast_as_at_month
      : period?.reportingMonth ?? period?.reporting_month
  );
}

function periodContext(period) {
  const siteStart = isSiteStartPeriod(period);
  return {
    periodType: periodTypeOf(period),
    isSiteStart: siteStart,
    effectiveMonth: effectiveForecastMonth(period),
    periodLabel: siteStart ? "Site Start" : period?.periodKey || period?.period_key || "CVR",
    monthLabel: siteStart ? "Forecast as at" : "Reporting month",
  };
}

module.exports = {
  toYearMonth,
  periodTypeOf,
  isSiteStartPeriod,
  effectiveForecastMonth,
  periodContext,
};
