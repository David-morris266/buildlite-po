/**
 * BL-032D — Whole-CVR close candidate composition (no persist).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildWholeCvrCloseCandidate,
  calculateCvrGrossProfit,
  calculateCvrGrossMarginPercent,
} = require("../services/cvrCommercialClose");
const { CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION, CLOSE_SOURCE_KEYS } = require(
  "../services/cvrCloseConstants"
);

test("GP is Forecast Revenue minus finalForecast; margin null at £0 Revenue", () => {
  assert.equal(calculateCvrGrossProfit(10444608, 2365423), 8079185);
  assert.equal(calculateCvrGrossProfit(100000, 150000), -50000);
  const margin = calculateCvrGrossMarginPercent(8079185, 10444608);
  assert.ok(Math.abs(margin - (8079185 / 10444608) * 100) < 1e-10);
  assert.equal(calculateCvrGrossMarginPercent(-600000, 0), null);
  assert.ok(CLOSE_SOURCE_KEYS.every((key) => key !== "revenue"));
});

test("cost not ready or Revenue not ready blocks the whole-CVR candidate", async () => {
  const costBlocked = await buildWholeCvrCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-1",
    periodId: "00000000-0000-4000-8000-000000000001",
    loadSources: async () => ({
      ok: false,
      sources: {},
    }),
    loadDevelopment: async () => ({ id: "dev-1", plotMaster: { plots: [] } }),
    loadSettingsRow: async () => ({
      id: "settings-1",
      development_id: "dev-1",
      recognition_policy: "completion",
      strategy: { openMarket: { ratePerFt2: 350 } },
      house_type_pricing: {},
      revenue_adjustments: [],
      recognition_settings: {},
      version: 1,
    }),
  });
  assert.equal(costBlocked.canLock, false);
  assert.equal(costBlocked.snapshot, null);

  const revenueBlocked = await buildWholeCvrCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-1",
    periodId: "00000000-0000-4000-8000-000000000001",
    loadSources: async () => ({
      ok: false,
      sources: {},
    }),
    loadDevelopment: async () => ({ id: "dev-1" }),
    loadSettingsRow: async () => null,
  });
  assert.equal(revenueBlocked.canLock, false);
  assert.ok(
    revenueBlocked.blockers.some(
      (item) => item.source === "revenueSettings" || item.source === "plotMaster"
    )
  );
  assert.equal(CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION, 2);
});
