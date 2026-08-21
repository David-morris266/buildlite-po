/**
 * BL-033D.x.1 — BuildLite Standard Prelims Template (no database).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BUILDLITE_STANDARD_PRELIMS_VERSION,
  getBuildLiteStandardPrelimsTemplate,
} = require("../services/buildliteStandardPrelimsTemplate");
const { PRELIMS_DRIVER_KEYS } = require("../services/prelimsConstants");

const ALLOWED_BASES = new Set(["SITE_START", "FIRST_COMPLETION", "FINAL_COMPLETION", null]);

test("BuildLite Standard is a versioned product definition with unique keys and no tenant facts", () => {
  const first = getBuildLiteStandardPrelimsTemplate();
  assert.equal(first.key, "BUILDLITE_STANDARD_PRELIMS_TEMPLATE");
  assert.equal(first.version, BUILDLITE_STANDARD_PRELIMS_VERSION);
  assert.equal(first.version, 1);
  assert.equal(first.lines.length, 25);
  assert.equal(first.lineCount, 25);

  const keys = first.lines.map((line) => line.templateKey);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.every((key) => key.startsWith("bl.prelims.v1.")));

  for (const line of first.lines) {
    assert.equal(line.costCodeKey, undefined);
    assert.equal(line.monthlyRate, undefined);
    assert.equal(line.lumpSumAmount, undefined);
    assert.equal(line.siteStart, undefined);
    assert.equal(line.reportingMonth, undefined);
    assert.ok(PRELIMS_DRIVER_KEYS.includes(line.suggestedDriver));
    assert.ok(ALLOWED_BASES.has(line.suggestedStartBasis));
    assert.ok(ALLOWED_BASES.has(line.suggestedEndBasis));
    if (line.suggestedDriver === "TIME") {
      assert.ok(line.suggestedStartBasis);
      assert.ok(line.suggestedEndBasis);
      assert.notEqual(line.suggestedStartBasis, "FIXED_DATE");
    } else {
      assert.equal(line.suggestedStartBasis, null);
      assert.equal(line.suggestedEndBasis, null);
    }
  }

  const serialized = JSON.stringify(first);
  assert.equal(/5231/.test(serialized), false);
  assert.equal(/Test Site 1/.test(serialized), false);
  assert.equal(/monthlyRate|lumpSumAmount|reportingMonth|siteStart/.test(serialized), false);

  first.lines[0].name = "MUTATED";
  first.version = 99;
  const second = getBuildLiteStandardPrelimsTemplate();
  assert.equal(second.version, 1);
  assert.equal(second.lines[0].name, "Site Manager");
});

test("BuildLite Standard includes core TIME and LUMP_SUM starter lines", () => {
  const { lines } = getBuildLiteStandardPrelimsTemplate();
  const byKey = Object.fromEntries(lines.map((line) => [line.templateKey, line]));
  assert.equal(byKey["bl.prelims.v1.site_manager"].suggestedDriver, "TIME");
  assert.equal(byKey["bl.prelims.v1.cleaning_ongoing"].suggestedDriver, "TIME");
  assert.equal(byKey["bl.prelims.v1.cleaning_final"].suggestedDriver, "LUMP_SUM");
  assert.equal(byKey["bl.prelims.v1.hoarding"].suggestedDriver, "LUMP_SUM");
  assert.equal(byKey["bl.prelims.v1.scaffold_inspections"].suggestedDriver, "TIME");
  assert.equal(byKey["bl.prelims.v1.demobilisation"].suggestedDriver, "LUMP_SUM");
});
