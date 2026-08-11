/**
 * BL-027B.1 — Package orderKey helper tests (parity with client).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normaliseCostCode,
  buildSubcontractOrderKey,
  parseSubcontractOrderKey,
} = require("../services/packageKey");

test("normaliseCostCode trims, lowercases, and defaults to general", () => {
  assert.equal(normaliseCostCode("5218"), "5218");
  assert.equal(normaliseCostCode(" 5218 "), "5218");
  assert.equal(normaliseCostCode("0120"), "0120");
  assert.equal(normaliseCostCode(""), "general");
  assert.equal(normaliseCostCode(null), "general");
});

test("buildSubcontractOrderKey matches client format", () => {
  assert.equal(
    buildSubcontractOrderKey("dev-abc", "sup-123", "5218"),
    "dev-abc::sup-123::5218"
  );
  assert.equal(
    buildSubcontractOrderKey("dev-abc", "sup-123", " 5218 "),
    "dev-abc::sup-123::5218"
  );
  assert.equal(
    buildSubcontractOrderKey("dev-1785599776666-zck5pl", "sup-spark", "0120"),
    "dev-1785599776666-zck5pl::sup-spark::0120"
  );
});

test("parseSubcontractOrderKey handles legacy 2-part keys", () => {
  const parsed = parseSubcontractOrderKey("dev-x::sup-y");
  assert.equal(parsed.legacy, true);
  assert.equal(parsed.costCode, null);
});

test("parseSubcontractOrderKey preserves cost codes containing ::", () => {
  const parsed = parseSubcontractOrderKey("dev-x::sup-y::cost::with::colons");
  assert.equal(parsed.costCode, "cost::with::colons");
  assert.equal(parsed.legacy, false);
});
