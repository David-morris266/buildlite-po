/**
 * BL-031E.2 — Pure formula tests for the server CVR close engine.
 * No database access. Mirrors banked BL-031D client rules.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateCostToComplete,
  calculateFinalForecast,
  calculateIncurredCost,
  calculateOutstandingCertified,
  calculateSystemForecast,
  calculateVariance,
  getApprovedCertificateValue,
  enrichCvrForecastRow,
  reconstructGrossWorks,
} = require("../services/cvrCloseFormulas");

test("system forecast: commitment > 0 wins", () => {
  assert.equal(
    calculateSystemForecast({ committed: 50250, currentBudget: 10000, actualCost: 800 }),
    50250
  );
});

test("system forecast: non-zero current budget fallback", () => {
  assert.equal(
    calculateSystemForecast({ committed: 0, currentBudget: 10000, actualCost: 800 }),
    10000
  );
});

test("system forecast: zero budget is not a fallback", () => {
  assert.equal(
    calculateSystemForecast({ committed: 0, currentBudget: 0, actualCost: 800 }),
    800
  );
});

test("system forecast: actual > 0 fallback", () => {
  assert.equal(
    calculateSystemForecast({ committed: 0, currentBudget: null, actualCost: 125.5 }),
    125.5
  );
});

test("system forecast: zero fallback", () => {
  assert.equal(
    calculateSystemForecast({ committed: 0, currentBudget: 0, actualCost: 0 }),
    0
  );
  assert.equal(
    calculateSystemForecast({ committed: null, currentBudget: null, actualCost: null }),
    0
  );
});

test("final forecast = system forecast + commercial adjustment", () => {
  assert.equal(calculateFinalForecast(50250, 500), 50750);
  assert.equal(calculateFinalForecast(50250, -250), 50000);
});

test("current cost = actual + manual accrual", () => {
  assert.equal(calculateIncurredCost(0, 100), 100);
  assert.equal(calculateIncurredCost(1000, 400), 1400);
});

test("CTC = final forecast - current cost", () => {
  assert.equal(calculateCostToComplete(50750, 0, 100), 50650);
});

test("outstanding certified floors at zero", () => {
  assert.equal(calculateOutstandingCertified(2150, 0), 2150);
  assert.equal(calculateOutstandingCertified(2150, 2150), 0);
  assert.equal(calculateOutstandingCertified(2150, 3000), 0);
});

test("frozen outstanding certified equals Summary certified-not-in-ledger", () => {
  // BL-031D Summary "Certified Not in Ledger" is max(0, certified - actual),
  // the same formula as outstanding certified when both facts exist.
  assert.equal(calculateOutstandingCertified(180000, 150000), 30000);
  assert.equal(calculateOutstandingCertified(100000, 120000), 0);
  assert.equal(calculateOutstandingCertified(2150, 0), 2150);
});

test("variance = current budget - final forecast", () => {
  assert.equal(calculateVariance(0, 50750), -50750);
  assert.equal(calculateVariance(10000, 9000), 1000);
});

test("certified uses frozen gross works + signed recovery, not net", () => {
  assert.equal(
    getApprovedCertificateValue({
      status: "locked",
      grossValue: 2250,
      netValue: -100,
      recoverySigned: -100,
      vat: 40,
      retention: 50,
    }),
    2150
  );
});

test("draft certificates contribute 0 certified", () => {
  assert.equal(
    getApprovedCertificateValue({
      status: "draft",
      grossValue: 9999,
      recoverySigned: 0,
    }),
    0
  );
});

test("approved certificate with unresolved gross is incomplete, not £0", () => {
  const value = getApprovedCertificateValue({
    status: "locked",
    grossValue: null,
    netValue: 0,
    recoverySigned: 0,
    valuationSnapshot: { totals: {} },
  });
  assert.equal(value, null);
  assert.equal(reconstructGrossWorks({ status: "locked" }), null);
});

test("enrichCvrForecastRow matches Test Site 1 / 5231 commercial position", () => {
  const row = enrichCvrForecastRow({
    currentBudget: 0,
    committed: 50250,
    certified: 2150,
    actualCost: 0,
    manualAccrual: 100,
    commercialAdjustment: 500,
  });
  assert.equal(row.currentCost, 100);
  assert.equal(row.systemForecast, 50250);
  assert.equal(row.finalForecast, 50750);
  assert.equal(row.costToComplete, 50650);
  assert.equal(row.outstandingCertified, 2150);
  assert.equal(row.variance, -50750);
});
