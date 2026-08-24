/**
 * BL-033D.1 — Validate Prelims item bodies (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePrelimsItemBody, preserveCostCodeKey } = require(
  "../services/prelimsItemValidation"
);

test("preserves customer cost-code key identity without stripping internal digits", () => {
  assert.equal(preserveCostCodeKey(" 5231 "), "5231");
  assert.equal(preserveCostCodeKey("P100-SM"), "P100-SM");
});

test("rejects STANDARD_CVR, QUANTITY, and inverted fixed dates", () => {
  const standard = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Site management",
    forecastDriver: "STANDARD_CVR",
  });
  assert.equal(standard.ok, false);
  assert.match(standard.errors.join(" "), /STANDARD_CVR/);

  const quantity = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Qty",
    forecastDriver: "QUANTITY",
  });
  assert.equal(quantity.ok, false);

  const inverted = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Inverted",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "FIXED_DATE",
    startFixedDate: "2027-02-01",
    endBasis: "FIXED_DATE",
    endFixedDate: "2026-09-01",
  });
  assert.equal(inverted.ok, false);
});

test("accepts TIME offsets and rejects ±61 while forcing FIXED_DATE offsets to 0", () => {
  const ok = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Site management",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    startOffsetMonths: 3,
    endBasis: "FINAL_COMPLETION",
    endOffsetMonths: -6,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.startOffsetMonths, 3);
  assert.equal(ok.value.endOffsetMonths, -6);

  const tooLarge = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Too far",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    startOffsetMonths: 61,
    endBasis: "FINAL_COMPLETION",
  });
  assert.equal(tooLarge.ok, false);

  const fixed = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Fixed",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "FIXED_DATE",
    startFixedDate: "2027-01-01",
    startOffsetMonths: 4,
    endBasis: "FIXED_DATE",
    endFixedDate: "2028-12-01",
    endOffsetMonths: -2,
  });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.value.startOffsetMonths, 0);
  assert.equal(fixed.value.endOffsetMonths, 0);
});

test("accepts TIME mixed bases and LUMP_SUM with default offsets", () => {
  const time = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Site management",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
  });
  assert.equal(time.ok, true);
  assert.equal(time.value.startFixedDate, null);
  assert.equal(time.value.startOffsetMonths, 0);
  assert.equal(time.value.endOffsetMonths, 0);

  const lump = validatePrelimsItemBody({
    version: 0,
    costCodeKey: "5231",
    name: "Bond",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 20000,
    status: "active",
  });
  assert.equal(lump.ok, true);
  assert.equal(lump.value.lumpSumAmount, 20000);
  assert.equal(lump.value.startOffsetMonths, 0);
});
