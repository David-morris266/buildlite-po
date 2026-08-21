/**
 * BL-033C — Inclusive calendar-month helpers (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inclusiveCalendarMonthCount,
  monthNumberFromSiteStart,
  suggestNextReportingMonth,
  toYearMonth,
} = require("../services/programmeCalendar");

test("Test Site 1 seed span is 38 inclusive calendar months", () => {
  assert.equal(inclusiveCalendarMonthCount("2026-09-01", "2029-10-01"), 38);
});

test("mid-month dates still occupy whole calendar months", () => {
  assert.equal(inclusiveCalendarMonthCount("2026-09-15", "2029-10-20"), 38);
  assert.equal(inclusiveCalendarMonthCount("2026-09-30", "2029-10-01"), 38);
});

test("same calendar month is duration 1 and is month 1 from site start", () => {
  assert.equal(inclusiveCalendarMonthCount("2026-09-01", "2026-09-30"), 1);
  assert.equal(monthNumberFromSiteStart("2026-09-01", "2026-09-15"), 1);
  assert.equal(monthNumberFromSiteStart("2026-09-01", "2026-10-01"), 2);
});

test("does not prorate and rejects inverted spans", () => {
  assert.equal(inclusiveCalendarMonthCount("2029-10-01", "2026-09-01"), null);
  assert.equal(toYearMonth("2026-09-15"), "2026-09");
});

test("next reporting month is previous + 1 and never today", () => {
  assert.equal(suggestNextReportingMonth("2026-01-01"), "2026-02");
  assert.equal(suggestNextReportingMonth("2026-12"), "2027-01");
  assert.equal(suggestNextReportingMonth(null), null);
  assert.equal(suggestNextReportingMonth(""), null);
});
