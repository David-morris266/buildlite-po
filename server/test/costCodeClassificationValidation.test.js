/**
 * BL-033B — Classification validation unit tests (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeCostCodeKey,
  validatePutClassificationBody,
} = require("../services/costCodeClassificationValidation");
const {
  DEFAULT_FORECAST_DRIVER,
  DEFAULT_SEMANTIC_GROUP,
  SEMANTIC_GROUPS,
} = require("../services/costCodeClassificationConstants");

test("unmapped defaults are UNCLASSIFIED + STANDARD_CVR, not OTHER", () => {
  assert.equal(DEFAULT_SEMANTIC_GROUP, SEMANTIC_GROUPS.UNCLASSIFIED);
  assert.equal(DEFAULT_FORECAST_DRIVER, "STANDARD_CVR");
  assert.notEqual(DEFAULT_SEMANTIC_GROUP, SEMANTIC_GROUPS.OTHER);
});

test("cost-code keys preserve hyphenated identities and strip descriptions", () => {
  assert.equal(normalizeCostCodeKey("P100-SM"), "P100-SM");
  assert.equal(normalizeCostCodeKey("P100-SM — Site Manager"), "P100-SM");
  assert.equal(normalizeCostCodeKey("5231 — Cleaning"), "5231");
  assert.equal(normalizeCostCodeKey("05.210"), "05.210");
  assert.equal(normalizeCostCodeKey("  2100  "), "2100");
});

test("PRELIMS + STANDARD_CVR and PRELIMS + TIME are valid metadata", () => {
  const standard = validatePutClassificationBody(
    { version: 0, semanticGroup: "PRELIMS", forecastDriver: "STANDARD_CVR" },
    "5231"
  );
  assert.equal(standard.ok, true);
  assert.equal(standard.value.clear, false);
  const timed = validatePutClassificationBody(
    { version: 0, semanticGroup: "prelims", forecastDriver: "time" },
    "5231"
  );
  assert.equal(timed.ok, true);
  assert.equal(timed.value.forecastDriver, "TIME");
});

test("UNCLASSIFIED cannot be stored with a non-standard driver", () => {
  const result = validatePutClassificationBody(
    { version: 0, semanticGroup: "UNCLASSIFIED", forecastDriver: "TIME" },
    "5231"
  );
  assert.equal(result.ok, false);
});

test("Commercial Head labels are not semantic groups", () => {
  const result = validatePutClassificationBody(
    { version: 0, semanticGroup: "Preliminaries", forecastDriver: "STANDARD_CVR" },
    "1300"
  );
  assert.equal(result.ok, false);
});
