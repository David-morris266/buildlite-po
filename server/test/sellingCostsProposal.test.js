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
} = require("../services/sellingCostsConstants");

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

test("BuildLite owns no numeric Simple Selling Costs destination", () => {
  const constants = require("../services/sellingCostsConstants");
  assert.equal(constants.RECOMMENDED_SIMPLE_DESTINATION_CODE, undefined);
  assert.equal(constants.FORBIDDEN_SIMPLE_DESTINATION_CODES, undefined);
});
