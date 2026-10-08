const test = require("node:test");
const assert = require("node:assert/strict");

const {
  effectiveForecastMonth,
  periodContext,
} = require("../services/cvrPeriodContext");

test("monthly CVR keeps reporting month as effective forecast month", () => {
  const period = {
    periodType: "monthly_cvr",
    periodKey: "P01",
    reportingMonth: "2027-04-01",
    forecastAsAtMonth: "2027-09-01",
  };
  assert.equal(effectiveForecastMonth(period), "2027-04");
  assert.deepEqual(periodContext(period), {
    periodType: "monthly_cvr",
    isSiteStart: false,
    effectiveMonth: "2027-04",
    periodLabel: "P01",
    monthLabel: "Reporting month",
  });
});

test("Site Start uses explicit forecast-as-at month without a fake reporting month", () => {
  const period = {
    periodType: "site_start",
    periodKey: "SITE_START",
    reportingMonth: null,
    forecastAsAtMonth: "2027-06-01",
  };
  assert.equal(effectiveForecastMonth(period), "2027-06");
  assert.deepEqual(periodContext(period), {
    periodType: "site_start",
    isSiteStart: true,
    effectiveMonth: "2027-06",
    periodLabel: "Site Start",
    monthLabel: "Forecast as at",
  });
});
