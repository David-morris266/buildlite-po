/**
 * BL-033D.x.1 — company template body validation (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCreateTemplateBody,
  validateTemplateLineBody,
} = require("../services/prelimsTemplateValidation");

test("create origin must be buildlite_standard or blank", () => {
  assert.equal(validateCreateTemplateBody({ origin: "imported" }).ok, false);
  assert.equal(validateCreateTemplateBody({ origin: "buildlite_standard" }).ok, true);
  const blank = validateCreateTemplateBody({ origin: "blank", name: "Small Sites" });
  assert.equal(blank.ok, true);
  assert.equal(blank.value.name, "Small Sites");
});

test("company lines reject FIXED_DATE, STANDARD_CVR, and development dates", () => {
  const fixed = validateTemplateLineBody({
    templateKey: "custom.a",
    name: "Bad",
    forecastDriver: "TIME",
    startBasis: "FIXED_DATE",
    endBasis: "SITE_START",
  });
  assert.equal(fixed.ok, false);

  const standard = validateTemplateLineBody({
    templateKey: "custom.b",
    name: "Bad",
    forecastDriver: "STANDARD_CVR",
  });
  assert.equal(standard.ok, false);

  const dates = validateTemplateLineBody({
    templateKey: "custom.c",
    name: "Bad",
    forecastDriver: "LUMP_SUM",
    siteStart: "2026-09-01",
  });
  assert.equal(dates.ok, false);
});

test("unmapped cost_code_key and nullable rates are valid; customer key identity is preserved", () => {
  const line = validateTemplateLineBody({
    version: 0,
    templateKey: "custom.cleaning",
    name: "Cleaning",
    forecastDriver: "TIME",
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    monthlyRate: 1000,
    costCodeKey: " 5231 ",
  });
  assert.equal(line.ok, true);
  assert.equal(line.value.costCodeKey, "5231");
  assert.equal(line.value.monthlyRate, 1000);

  const unmapped = validateTemplateLineBody({
    templateKey: "custom.unmapped",
    name: "Unmapped",
    forecastDriver: "LUMP_SUM",
  });
  assert.equal(unmapped.ok, true);
  assert.equal(unmapped.value.costCodeKey, null);
  assert.equal(unmapped.value.lumpSumAmount, null);
});
