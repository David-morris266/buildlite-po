/**
 * BL-032D — Server Revenue close candidate (no live clone, no Plot Master writes).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { buildCvrRevenueCloseCandidate, buildRevenueAuthorityFromDocuments, invalidSecuredPlots } = require(
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

test("Summary Revenue is exact, plot-independent and leaves secondary metrics unavailable", async () => {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-summary",
    loadDevelopment: async () => ({ id: "dev-summary" }),
    loadSettingsRow: async () => settingsRow({
      development_id: "dev-summary",
      revenue_mode: "summary",
      summary_revenue_lines: [
        { id: "private", description: "Private Sales", forecastRevenue: 100000.01 },
        { id: "affordable", description: "Affordable Housing", forecastRevenue: 50000.02 },
      ],
      updated_by: "Authenticated QS",
      updated_by_membership_id: "membership-1",
    }),
  });
  assert.equal(candidate.canLock, true);
  assert.equal(candidate.summary.forecastRevenue, 150000.03);
  assert.equal(candidate.summary.securedRevenue, null);
  assert.equal(candidate.summary.remainingForecast, null);
  assert.equal(candidate.summary.plotsSold, null);
  assert.deepEqual(candidate.plots, []);
  assert.equal(candidate.assumptions.revenueMode, "summary");
  assert.equal(candidate.assumptions.summaryRevenueLines.length, 2);
  assert.equal(candidate.assumptions.settingsUpdatedByMembershipId, "membership-1");
});

test("Sales Register mode switching uses the complete close-candidate readiness contract", () => {
  const duplicate = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [
      { id: "same", plotNumber: "1", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 10 },
      { id: "same", plotNumber: "2", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 20 },
    ] } },
    settingsDocument: { ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close"), exists: true },
  });
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.blockers.some((item) => item.reason === "duplicate-plot-id"));

  const invalidPricing = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [
      { id: "plot-1", plotNumber: "1", revenueStatus: "Available", revenueSource: "Development Strategy", niaFt2: Symbol("invalid") },
    ] } },
    settingsDocument: { ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close"), exists: true },
  });
  assert.equal(invalidPricing.ready, false);
  assert.ok(invalidPricing.blockers.some((item) => item.reason === "revenue-calculation-failed"));
});
