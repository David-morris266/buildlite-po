/**
 * BL-032D — Server Revenue close candidate (no live clone, no Plot Master writes).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildCvrRevenueCloseCandidate, invalidSecuredPlots } = require(
  "../services/cvrRevenueClose"
);

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-site-1-revenue-close.json");

function settingsRow(overrides = {}) {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  return {
    id: fixture.settings.id,
    development_id: "dev-close",
    recognition_policy: fixture.settings.recognitionPolicy,
    strategy: fixture.settings.revenueStrategy,
    house_type_pricing: fixture.settings.houseTypePricing || {},
    revenue_adjustments: fixture.settings.revenueAdjustments || [],
    recognition_settings: fixture.settings.recognitionSettings || {},
    version: fixture.settings.version,
    ...overrides,
  };
}

test("missing Plot Master or settings fail closed", async () => {
  const missingPlots = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close" }),
    loadSettingsRow: async () => settingsRow(),
  });
  assert.equal(missingPlots.canLock, false);
  assert.ok(missingPlots.blockers.some((item) => item.reason === "plot-master-unavailable"));

  const missingSettings = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close", plotMaster: { plots: [] } }),
    loadSettingsRow: async () => null,
  });
  assert.equal(missingSettings.canLock, false);
  assert.ok(
    missingSettings.blockers.some((item) => item.reason === "revenue-settings-missing")
  );
});

test("invalid secured sellingPrice lists plot numbers and does not freeze £0", async () => {
  const plots = [
    {
      id: "plot-x",
      plotNumber: "31",
      revenueStatus: "Exchanged",
      sellingPrice: 0,
      revenueSource: "Manual Value",
      manualForecastValue: 255100,
    },
  ];
  assert.equal(invalidSecuredPlots(plots).length, 1);
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close", plotMaster: { plots } }),
    loadSettingsRow: async () => settingsRow(),
  });
  assert.equal(candidate.canLock, false);
  const blocker = candidate.blockers.find(
    (item) => item.reason === "invalid-secured-selling-price"
  );
  assert.ok(blocker);
  assert.deepEqual(blocker.plotNumbers, ["31"]);
  assert.equal(candidate.summary, null);
});

test("zero plot Revenue is a genuine £0 lock candidate with settings evidence", async () => {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close", plotMaster: { plots: [] } }),
    loadSettingsRow: async () => settingsRow({ version: 2 }),
  });
  assert.equal(candidate.canLock, true);
  assert.equal(candidate.summary.forecastRevenue, 0);
  assert.equal(candidate.summary.securedRevenue, 0);
  assert.equal(candidate.settingsVersion, 2);
  assert.equal(candidate.assumptions.settingsVersion, 2);
  assert.equal(candidate.assumptions.openMarket.ratePerFt2, 350);
  assert.ok(candidate.assumptions.houseTypePricing);
});

test("Test Site 1 fixture close matches characterisation", async () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: fixture.developmentId,
    loadDevelopment: async () => ({
      id: fixture.developmentId,
      plotMaster: fixture.plotMaster,
    }),
    loadSettingsRow: async () => settingsRow(),
  });
  assert.equal(candidate.canLock, true);
  assert.equal(candidate.summary.forecastRevenue, 10444608);
  assert.equal(candidate.summary.securedRevenue, 0);
  assert.equal(candidate.summary.remainingForecast, 10444608);
  assert.equal(candidate.summary.plotsSold, 0);
  assert.equal(candidate.plots.length, 31);
  assert.equal(candidate.assumptions.settingsId, fixture.settings.id);
  assert.equal(candidate.settingsVersion, Number(fixture.settings.version));
});
