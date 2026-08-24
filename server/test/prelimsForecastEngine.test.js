/**
 * BL-033D.1 — TIME / LUMP_SUM proposal calculations (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  aggregatePrelimsLines,
  calculateLumpSumLine,
  calculatePrelimsLine,
  calculateTimeLine,
  resolveTimeSpan,
  suggestedPrelimsDriver,
} = require("../services/prelimsForecastEngine");
const { attachPrelimsCalculation } = require("../services/prelimsItemMapper");
const { PRELIMS_UNRESOLVED_REASONS } = require("../services/prelimsConstants");

const TEST_SITE_1 = {
  exists: true,
  siteStart: "2026-09-01",
  firstCompletion: null,
  finalCompletion: "2029-10-01",
};

const P04 = "2026-08";

function timeLine(overrides = {}) {
  return {
    forecastDriver: "TIME",
    status: "active",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    ...overrides,
  };
}

test("TIME duration resolves against the programme before a monthly rate is entered", () => {
  const span = resolveTimeSpan(timeLine({ monthlyRate: null }), TEST_SITE_1);
  assert.equal(span.state, "resolved");
  assert.equal(span.totalMonths, 38);
  assert.equal(span.resolvedStart, "2026-09-01");
  assert.equal(span.resolvedEnd, "2029-10-01");
  const calc = calculateTimeLine(timeLine({ monthlyRate: null }), {
    programme: TEST_SITE_1,
    reportingMonth: P04,
  });
  assert.equal(calc.reason, PRELIMS_UNRESOLVED_REASONS.INVALID_RATE);
});

test("Test Site 1 SITE_START → FINAL_COMPLETION at P04 2026-08 is 38 months elapsed 0", () => {
  const calc = calculateTimeLine(timeLine(), { programme: TEST_SITE_1, reportingMonth: P04 });
  assert.equal(calc.state, "resolved");
  assert.equal(calc.resolvedStart, "2026-09-01");
  assert.equal(calc.resolvedEnd, "2029-10-01");
  assert.equal(calc.totalMonths, 38);
  assert.equal(calc.elapsedMonths, 0);
  assert.equal(calc.remainingMonths, 38);
  assert.equal(calc.totalForecast, 38000);
  assert.equal(calc.forecastToDate, 0);
  assert.equal(calc.forecastToComplete, 38000);
  assert.equal(calc.includedInActiveProposal, true);
});

test("start month counts as elapsed 1", () => {
  const calc = calculateTimeLine(timeLine(), {
    programme: TEST_SITE_1,
    reportingMonth: "2026-09",
  });
  assert.equal(calc.elapsedMonths, 1);
  assert.equal(calc.remainingMonths, 37);
  assert.equal(calc.forecastToDate, 1000);
  assert.equal(calc.forecastToComplete, 37000);
});

test("inside span uses inclusive months from start through reporting month", () => {
  const calc = calculateTimeLine(timeLine(), {
    programme: TEST_SITE_1,
    reportingMonth: "2027-09",
  });
  assert.equal(calc.elapsedMonths, 13);
  assert.equal(calc.remainingMonths, 25);
  assert.equal(calc.forecastToDate, 13000);
  assert.equal(calc.forecastToComplete, 25000);
});

test("end month is inclusive and after end is capped", () => {
  const atEnd = calculateTimeLine(timeLine(), {
    programme: TEST_SITE_1,
    reportingMonth: "2029-10",
  });
  assert.equal(atEnd.elapsedMonths, 38);
  assert.equal(atEnd.remainingMonths, 0);
  const after = calculateTimeLine(timeLine(), {
    programme: TEST_SITE_1,
    reportingMonth: "2029-11",
  });
  assert.equal(after.elapsedMonths, 38);
  assert.equal(after.forecastToComplete, 0);
});

test("mid-month FIXED_DATE occupies whole calendar months", () => {
  const calc = calculateTimeLine(
    timeLine({
      startBasis: "FIXED_DATE",
      startFixedDate: "2026-09-15",
      endBasis: "FIXED_DATE",
      endFixedDate: "2029-10-20",
    }),
    { programme: TEST_SITE_1, reportingMonth: P04 }
  );
  assert.equal(calc.totalMonths, 38);
  assert.equal(calc.elapsedMonths, 0);
});

test("independent mixed bases are valid", () => {
  const calc = calculateTimeLine(
    timeLine({
      startBasis: "SITE_START",
      endBasis: "FIXED_DATE",
      endFixedDate: "2027-01-31",
    }),
    { programme: TEST_SITE_1, reportingMonth: "2026-09" }
  );
  assert.equal(calc.totalMonths, 5);
  assert.equal(calc.elapsedMonths, 1);
  assert.equal(calc.resolvedEnd, "2027-01-31");
});

test("missing FIRST_COMPLETION is unresolved, not a genuine £0", () => {
  const calc = calculateTimeLine(
    timeLine({ startBasis: "FIRST_COMPLETION" }),
    { programme: TEST_SITE_1, reportingMonth: P04 }
  );
  assert.equal(calc.state, "unresolved");
  assert.equal(calc.reason, PRELIMS_UNRESOLVED_REASONS.MISSING_FIRST_COMPLETION);
  assert.equal(calc.totalForecast, null);
  assert.equal(calc.includedInActiveProposal, false);
});

test("missing reportingMonth is unresolved and does not use today", () => {
  const original = Date.now;
  Date.now = () => new Date("2030-12-15T12:00:00Z").getTime();
  try {
    const calc = calculateTimeLine(timeLine(), { programme: TEST_SITE_1, reportingMonth: null });
    assert.equal(calc.state, "unresolved");
    assert.equal(calc.reason, PRELIMS_UNRESOLVED_REASONS.MISSING_REPORTING_MONTH);
    assert.equal(calc.elapsedMonths, null);
  } finally {
    Date.now = original;
  }
});

test("signed calendar-month offsets resolve Test Site 1 worked examples", () => {
  const programme = TEST_SITE_1;
  const cases = [
    [{ startOffsetMonths: 0, endOffsetMonths: 0 }, 38, "2026-09-01", "2029-10-01"],
    [{ startOffsetMonths: 3, endOffsetMonths: 0 }, 35, "2026-12-01", "2029-10-01"],
    [{ startOffsetMonths: 9, endOffsetMonths: -6 }, 23, "2027-06-01", "2029-04-01"],
    [{ startOffsetMonths: 4, endOffsetMonths: -8 }, 26, "2027-01-01", "2029-02-01"],
  ];
  for (const [offsets, months, start, end] of cases) {
    const span = resolveTimeSpan(timeLine(offsets), programme);
    assert.equal(span.state, "resolved");
    assert.equal(span.totalMonths, months);
    assert.equal(span.resolvedStart, start);
    assert.equal(span.resolvedEnd, end);
  }
  const money = calculateTimeLine(timeLine({ startOffsetMonths: 3, monthlyRate: 5500 }), {
    programme,
    reportingMonth: P04,
  });
  assert.equal(money.totalMonths, 35);
  assert.equal(money.totalForecast, 192500);
});

test("FIRST_COMPLETION offset stays unresolved and FIXED_DATE ignores offset", () => {
  const unresolved = resolveTimeSpan(
    timeLine({ startBasis: "FIRST_COMPLETION", startOffsetMonths: -2 }),
    TEST_SITE_1
  );
  assert.equal(unresolved.state, "unresolved");
  assert.equal(unresolved.reason, PRELIMS_UNRESOLVED_REASONS.MISSING_FIRST_COMPLETION);

  const fixed = resolveTimeSpan(
    timeLine({
      startBasis: "FIXED_DATE",
      startFixedDate: "2027-01-01",
      startOffsetMonths: 9,
      endBasis: "FIXED_DATE",
      endFixedDate: "2028-12-01",
      endOffsetMonths: -4,
    }),
    TEST_SITE_1
  );
  assert.equal(fixed.totalMonths, 24);
  assert.equal(fixed.resolvedStart, "2027-01-01");
  assert.equal(fixed.resolvedEnd, "2028-12-01");
});

test("outside programme is allowed and inverted span is invalid", () => {
  const early = resolveTimeSpan(timeLine({ startOffsetMonths: -2 }), TEST_SITE_1);
  assert.equal(early.state, "resolved");
  assert.equal(early.outsideProgramme, true);
  assert.equal(early.totalMonths, 40);

  const inverted = resolveTimeSpan(
    timeLine({ startOffsetMonths: 40, endOffsetMonths: 0 }),
    TEST_SITE_1
  );
  assert.equal(inverted.state, "invalid");
  assert.equal(inverted.reason, PRELIMS_UNRESOLVED_REASONS.INVALID_SPAN);
});

test("active LUMP_SUM assumption is authoritative and ignores spend fields", () => {
  const calc = calculateLumpSumLine({
    lumpSumAmount: 20000,
    status: "active",
    committed: 50000,
    actualCost: 12000,
    certified: 8000,
  });
  assert.equal(calc.assumptionAmount, 20000);
  assert.equal(calc.totalForecast, 20000);
  assert.equal(calc.remainingExposure, 20000);
  assert.equal(calc.includedInActiveProposal, true);
});

test("complete LUMP_SUM preserves assumption and zeros remaining exposure", () => {
  const calc = calculateLumpSumLine({ lumpSumAmount: 20000, status: "complete" });
  assert.equal(calc.assumptionAmount, 20000);
  assert.equal(calc.remainingExposure, 0);
  assert.equal(calc.includedInActiveProposal, false);
});

test("cancelled LUMP_SUM is excluded from the active proposal", () => {
  const calc = calculateLumpSumLine({ lumpSumAmount: 20000, status: "cancelled" });
  assert.equal(calc.assumptionAmount, 20000);
  assert.equal(calc.includedInActiveProposal, false);
  assert.equal(calc.remainingExposure, 0);
});

test("aggregation keeps unresolved distinct from resolved £0", () => {
  const unresolved = attachPrelimsCalculation(
    { costCodeKey: "5231", status: "active", forecastDriver: "TIME", ...timeLine({ startBasis: "FIRST_COMPLETION" }) },
    { programme: TEST_SITE_1, reportingMonth: P04 }
  );
  const zeroTime = attachPrelimsCalculation(
    { costCodeKey: "5200", status: "active", forecastDriver: "TIME", ...timeLine({ monthlyRate: 0 }) },
    { programme: TEST_SITE_1, reportingMonth: P04 }
  );
  const lump = attachPrelimsCalculation(
    {
      costCodeKey: "5231",
      status: "active",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 20000,
    },
    {}
  );
  const cancelled = attachPrelimsCalculation(
    {
      costCodeKey: "5999",
      status: "cancelled",
      forecastDriver: "LUMP_SUM",
      lumpSumAmount: 999,
    },
    {}
  );
  const summary = aggregatePrelimsLines([unresolved, zeroTime, lump, cancelled]);
  const code5231 = summary.byCostCode.find((row) => row.costCodeKey === "5231");
  const code5200 = summary.byCostCode.find((row) => row.costCodeKey === "5200");
  assert.equal(code5231.hasUnresolved, true);
  assert.equal(code5231.activeProposal, 20000);
  assert.equal(code5200.activeProposal, 0);
  assert.equal(code5200.hasUnresolved, false);
  assert.equal(summary.development.activeProposal, 20000);
  assert.equal(summary.development.hasUnresolved, true);
});

test("classification STANDARD_CVR is not a Prelims driver suggestion", () => {
  assert.equal(suggestedPrelimsDriver("TIME"), "TIME");
  assert.equal(suggestedPrelimsDriver("LUMP_SUM"), "LUMP_SUM");
  assert.equal(suggestedPrelimsDriver("STANDARD_CVR"), null);
  assert.equal(calculatePrelimsLine({ forecastDriver: "STANDARD_CVR", lumpSumAmount: 1 }).includedInActiveProposal, false);
});
