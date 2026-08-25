/**
 * BL-034B — Pure Selling Costs proposal calculation tests (no DB).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateForecastSellingCosts,
} = require("../services/sellingCostsProposal");
const { parseAssumptionPercent } = require("../services/sellingCostsValidation");
const {
  DEFAULT_ASSUMPTION_PERCENT,
  FORBIDDEN_SIMPLE_DESTINATION_CODES,
  RECOMMENDED_SIMPLE_DESTINATION_CODE,
} = require("../services/sellingCostsConstants");
const { isForbiddenDestination } = require("../services/sellingCostsDestination");

test("BL-034B known-answer: £10,444,608 × 2.00% = £208,892.16", () => {
  assert.equal(calculateForecastSellingCosts(10444608, 2), 208892.16);
  assert.equal(DEFAULT_ASSUMPTION_PERCENT, 2);
});

test("BL-034B dynamic recalculation when Forecast Revenue changes", () => {
  assert.equal(calculateForecastSellingCosts(10000000, 2), 200000);
  assert.equal(calculateForecastSellingCosts(10500000, 2), 210000);
  assert.equal(calculateForecastSellingCosts(10444608, 1.75), 182780.64);
});

test("BL-034B rejects negative and malformed percentages", () => {
  assert.equal(parseAssumptionPercent(-1).ok, false);
  assert.equal(parseAssumptionPercent("abc").ok, false);
  assert.equal(parseAssumptionPercent("").ok, false);
  assert.equal(parseAssumptionPercent("1.75").ok, true);
  assert.equal(parseAssumptionPercent("1.75").value, 1.75);
});

test("BL-034B recommended destination is a hint; 5405 is forbidden", () => {
  assert.equal(RECOMMENDED_SIMPLE_DESTINATION_CODE, "5400");
  assert.ok(FORBIDDEN_SIMPLE_DESTINATION_CODES.includes("5405"));
  assert.equal(isForbiddenDestination("5405"), true);
  assert.equal(isForbiddenDestination("5400"), false);
  assert.equal(isForbiddenDestination("6120"), false);
});
