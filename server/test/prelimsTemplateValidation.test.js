/**
 * BL-033D.x.2 — company template body validation (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateCompanyTemplateKey,
  isProductStandardTemplateKey,
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

test("unmapped cost_code_key is valid; rates stay null; customer key identity is preserved", () => {
  const line = validateTemplateLineBody({
    version: 0,
    templateKey: "custom.cleaning",
    name: "Cleaning",
    forecastDriver: "TIME",
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    costCodeKey: " 5231 ",
  });
  assert.equal(line.ok, true);
  assert.equal(line.value.costCodeKey, "5231");
  assert.equal(line.value.monthlyRate, null);
  assert.equal(line.value.lumpSumAmount, null);

  const unmapped = validateTemplateLineBody({
    templateKey: "custom.unmapped",
    name: "Unmapped",
    forecastDriver: "LUMP_SUM",
  });
  assert.equal(unmapped.ok, true);
  assert.equal(unmapped.value.costCodeKey, null);
  assert.equal(unmapped.value.lumpSumAmount, null);
});

test("D.x.2 rejects monetary defaults and display-label cost codes; preserves hyphenated keys", () => {
  const money = validateTemplateLineBody({
    templateKey: "custom.money",
    name: "Cleaning",
    forecastDriver: "TIME",
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    monthlyRate: 1000,
  });
  assert.equal(money.ok, false);
  assert.ok(money.errors.some((error) => /monetary defaults/.test(error)));

  const lump = validateTemplateLineBody({
    templateKey: "custom.lump",
    name: "Final Clean",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 20000,
  });
  assert.equal(lump.ok, false);

  const label = validateTemplateLineBody({
    templateKey: "custom.label",
    name: "Cleaning",
    forecastDriver: "LUMP_SUM",
    costCodeKey: "5231 — Cleaning",
  });
  assert.equal(label.ok, false);

  const hyphen = validateTemplateLineBody({
    templateKey: "custom.hyphen",
    name: "Site manager",
    forecastDriver: "TIME",
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    costCodeKey: "P100-SM",
  });
  assert.equal(hyphen.ok, true);
  assert.equal(hyphen.value.costCodeKey, "P100-SM");
});

test("custom keys generate co.prelims.* and cannot collide with bl.prelims.*", () => {
  const missing = validateTemplateLineBody(
    { name: "Custom welfare", forecastDriver: "LUMP_SUM" },
    { allowMissingKey: true }
  );
  assert.equal(missing.ok, true);
  assert.equal(missing.value.templateKey, "");

  const required = validateTemplateLineBody({
    name: "Custom welfare",
    forecastDriver: "LUMP_SUM",
  });
  assert.equal(required.ok, false);

  const one = generateCompanyTemplateKey();
  const two = generateCompanyTemplateKey();
  assert.match(one, /^co\.prelims\./);
  assert.match(two, /^co\.prelims\./);
  assert.notEqual(one, two);
  assert.equal(isProductStandardTemplateKey(one), false);
  assert.equal(isProductStandardTemplateKey("bl.prelims.v1.site_manager"), true);
  assert.equal(isProductStandardTemplateKey("BL.PRELIMS.forged"), true);
});
