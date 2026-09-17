const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePutSettingsBody } = require("../services/revenueSettingsValidation");

test("Summary Revenue validates stable unique lines and exact non-negative pence", () => {
  const valid = validatePutSettingsBody({ revenueMode:"summary", summaryRevenueLines:[{id:"line-1",description:"Total Forecast Revenue",forecastRevenue:123.45}] });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.value.summaryRevenueLines, [{id:"line-1",description:"Total Forecast Revenue",forecastRevenue:123.45}]);
  for (const summaryRevenueLines of [[], [{id:"x",description:"",forecastRevenue:1}], [{id:"x",description:"A",forecastRevenue:-1}], [{id:"x",description:"A",forecastRevenue:1.001}], [{id:"x",description:"A",forecastRevenue:1},{id:"x",description:"B",forecastRevenue:2}]]) {
    assert.equal(validatePutSettingsBody({revenueMode:"summary",summaryRevenueLines}).ok, false);
  }
});

test("Sales Register remains the backward-compatible default and preserves dormant lines", () => {
  const result = validatePutSettingsBody({ summaryRevenueLines:[{id:"line-1",description:"Dormant",forecastRevenue:10}] });
  assert.equal(result.ok, true);
  assert.equal(result.value.revenueMode, "sales_register");
  assert.equal(result.value.summaryRevenueLines.length, 1);
});
