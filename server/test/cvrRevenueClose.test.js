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

function reviewedOpenMarket(plot = {}) {
  return { tenureCode: "OPEN_MARKET", ...plot };
}

function withGovernedFixtureTenure(plot) {
  const codesBySourceTenure = {
    Private: "OPEN_MARKET",
    "Social Rent": "AFFORDABLE_RENT",
    "Social Shared": "SHARED_OWNERSHIP",
  };
  const tenureCode = codesBySourceTenure[String(plot.tenure || "").trim()];
  assert.ok(tenureCode, `ambiguous Test Site 1 source tenure: ${plot.tenure}`);
  return { ...plot, tenureCode };
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

test("fully adopted independent plot forecasts do not require illustrative strategy defaults", async () => {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({
      id: "dev-close",
      plotMaster: {
        plots: [reviewedOpenMarket({
          id: "plot-independent",
          plotNumber: "1",
          revenueStatus: "Available",
          revenueSource: "Manual Value",
          manualOverrideExplicit: true,
          manualForecastValue: 293400,
        })],
      },
    }),
    loadSettingsRow: async () => null,
  });
  assert.equal(candidate.canLock, true);
  assert.equal(candidate.summary.forecastRevenue, 293400);
  assert.equal(candidate.assumptions.openMarket.ratePerFt2, null);
  assert.equal(candidate.settingsId, null);
});

test("new settings remain unestablished for dependent plots while exposing an independent partial subtotal", () => {
  const settingsDocument = {
    ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow({
      recognition_settings: { pricingAssumptionsAuthority: { schemaVersion:1, established:false } },
    }), "dev-close"),
    exists: true,
  };
  const candidate = buildRevenueAuthorityFromDocuments({
    clientId:"client-1", developmentId:"dev-close", settingsDocument,
    development:{ id:"dev-close", plotMaster:{ plots:[
      reviewedOpenMarket({ id:"imported", plotNumber:"1", revenueStatus:"Available", revenueSource:"Manual Value", manualOverrideExplicit:true, manualForecastValue:100000, forecastImportProvenance:{schemaVersion:"sales_register_forecast_v1"} }),
      reviewedOpenMarket({ id:"calculated", plotNumber:"2", houseType:"Ash", gia:1000, revenueStatus:"Available", revenueSource:"House Type" }),
    ] } },
  });
  assert.equal(candidate.ready, false);
  assert.equal(candidate.establishment.partialForecastRevenue, 100000);
  assert.equal(candidate.establishment.outstandingPlotCount, 1);
  assert.deepEqual(candidate.establishment.breakdown, { imported:1, manual:0, calculated:0, unresolved:1 });
  assert.ok(candidate.blockers.some((item) => item.reason === "pricing-assumptions-not-established"));
});

test("manual House Type values are independent for Open Market but still require affordable assumptions", () => {
  const settingsDocument = {
    ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow({
      recognition_settings: { pricingAssumptionsAuthority: { schemaVersion: 1, established: false } },
      house_type_pricing: { Ash: { sellingBasis: "Manual", manualForecastValue: 200000 } },
    }), "dev-close"),
    exists: true,
  };
  const candidate = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    settingsDocument,
    development: { id: "dev-close", plotMaster: { plots: [
      reviewedOpenMarket({ id: "om", plotNumber: "1", houseType: "Ash", revenueStatus: "Available", revenueSource: "House Type" }),
      { ...reviewedOpenMarket({ id: "ah", plotNumber: "2", houseType: "Ash", revenueStatus: "Available", revenueSource: "House Type" }), tenure: "Affordable Rent", tenureCode: "AFFORDABLE_RENT" },
    ] } },
  });
  assert.equal(candidate.ready, false);
  assert.equal(candidate.establishment.partialForecastRevenue, 200000);
  assert.deepEqual(candidate.establishment.dependentPlots.map((plot) => plot.reason), ["affordable-percentage"]);
});

test("legacy markerless settings remain established and explicit assumptions establish new settings", () => {
  const base = require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close");
  const development = { id:"dev-close", plotMaster:{ plots:[reviewedOpenMarket({ id:"calculated", plotNumber:"1", houseType:"Ash", gia:1000, revenueStatus:"Available", revenueSource:"Development Strategy" })] } };
  const legacy = buildRevenueAuthorityFromDocuments({clientId:"client-1",developmentId:"dev-close",development,settingsDocument:{...base,exists:true}});
  assert.equal(legacy.ready, true);
  assert.equal(legacy.establishment.strategyEstablishmentSource, "legacy-grandfathered");
  const explicit = buildRevenueAuthorityFromDocuments({clientId:"client-1",developmentId:"dev-close",development,settingsDocument:{...base,exists:true,recognitionSettings:{pricingAssumptionsAuthority:{schemaVersion:1,established:true,establishedAt:"2026-10-29T12:00:00.000Z"}}}});
  assert.equal(explicit.ready, true);
  assert.equal(explicit.establishment.strategyEstablishmentSource, "explicit");
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

test("Reserved Selling Price is frozen as unsecured Forecast Revenue", async () => {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close", plotMaster: { plots: [reviewedOpenMarket({
      id: "plot-7", plotNumber: "7", houseType: "Ash", niaFt2: 0,
      revenueStatus: "Reserved", revenueSource: "House Type", sellingPrice: 330000,
    })] } }),
    loadSettingsRow: async () => settingsRow({ house_type_pricing: {} }),
  });
  assert.equal(candidate.canLock, true);
  assert.deepEqual(candidate.summary, {
    forecastRevenue: 330000,
    securedRevenue: 0,
    remainingForecast: 330000,
    plotsSold: 0,
    plotsRemaining: 1,
  });
  assert.equal(candidate.plots[0].sellingPrice, 330000);
  assert.equal(candidate.plots[0].derivedForecast, 0);
  assert.equal(candidate.plots[0].forecastRevenue, 330000);
  assert.equal(candidate.plots[0].securedRevenue, 0);
});

test("House Type close freezes effective Revenue NIA and provenance", async () => {
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: "dev-close",
    loadDevelopment: async () => ({ id: "dev-close", plotMaster: { plots: [reviewedOpenMarket({
      id: "plot-effective-nia", plotNumber: "8", houseType: "Ashford", niaFt2: 0, gia: 0,
      revenueStatus: "Available", revenueSource: "House Type", sellingPrice: 0,
    })] } }),
    loadSettingsRow: async () => settingsRow({
      house_type_pricing: {
        Ashford: { garage: "None", sellingBasis: "Auto", representativeNiaFt2: 750 },
      },
    }),
  });

  assert.equal(candidate.canLock, true);
  assert.equal(candidate.plots[0].forecastRevenue, 262500);
  assert.equal(candidate.plots[0].niaFt2, 750);
  assert.deepEqual(candidate.plots[0].displayMetadata, {
    effectiveRevenueNiaSource: "explicit_house_type",
  });
});

test("Test Site 1 legacy fixture fails closed without governed tenureCode", async () => {
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
  assert.equal(candidate.canLock, false);
  assert.equal(candidate.summary, null);
  assert.equal(candidate.blockers[0].reason, "unreviewed-plot-tenure");
  assert.equal(candidate.blockers[0].plotNumbers.length, 31);
});

test("Test Site 1 governed tenure aliases retain the £10,444,608 known answer", async () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const plots = fixture.plotMaster.plots.map(withGovernedFixtureTenure);
  assert.equal(plots.length, 31);
  assert.deepEqual(
    plots.reduce((counts, plot) => ({
      ...counts,
      [plot.tenureCode]: (counts[plot.tenureCode] || 0) + 1,
    }), {}),
    { AFFORDABLE_RENT: 4, SHARED_OWNERSHIP: 7, OPEN_MARKET: 20 }
  );
  const candidate = await buildCvrRevenueCloseCandidate({
    clientId: "client-1",
    developmentId: fixture.developmentId,
    loadDevelopment: async () => ({
      id: fixture.developmentId,
      plotMaster: { ...fixture.plotMaster, plots },
    }),
    loadSettingsRow: async () => settingsRow(),
  });
  assert.equal(candidate.canLock, true);
  assert.equal(candidate.summary.forecastRevenue, 10444608);
  assert.equal(candidate.summary.securedRevenue, 0);
  assert.equal(candidate.summary.remainingForecast, 10444608);
  assert.equal(candidate.plots.length, 31);
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

test("Sales Register uses reviewed tenureCode and fails closed for unresolved tenure", () => {
  const settingsDocument = {
    ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close"),
    exists: true,
  };
  const reviewedSocialRent = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [{
      id: "social-1", plotNumber: "1", houseType: "Social", niaFt2: 1000,
      tenure: "Open Market", tenureCode: "AFFORDABLE_RENT",
      revenueStatus: "Available", revenueSource: "Development Strategy",
    }] } },
    settingsDocument,
  });
  assert.equal(reviewedSocialRent.ready, true);
  assert.equal(reviewedSocialRent.plots[0].tenure, "Affordable Rent");
  assert.equal(reviewedSocialRent.plots[0].forecastRevenue, 203000);

  const unresolved = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [{
      id: "unknown-1", plotNumber: "2", houseType: "Unknown", niaFt2: 1000,
      tenure: "Open Market", tenureCode: "UNREVIEWED",
      revenueStatus: "Available", revenueSource: "Development Strategy",
    }] } },
    settingsDocument,
  });
  assert.equal(unresolved.ready, false);
  assert.deepEqual(unresolved.blockers[0].plotNumbers, ["2"]);
  assert.equal(unresolved.blockers[0].reason, "unreviewed-plot-tenure");
});

test("Sales Register mode switching uses the complete close-candidate readiness contract", () => {
  const duplicate = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [
      reviewedOpenMarket({ id: "same", plotNumber: "1", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 10 }),
      reviewedOpenMarket({ id: "same", plotNumber: "2", revenueStatus: "Available", revenueSource: "Manual Value", manualForecastValue: 20 }),
    ] } },
    settingsDocument: { ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close"), exists: true },
  });
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.blockers.some((item) => item.reason === "duplicate-plot-id"));

  const invalidPricing = buildRevenueAuthorityFromDocuments({
    clientId: "client-1",
    developmentId: "dev-close",
    development: { id: "dev-close", plotMaster: { plots: [
      reviewedOpenMarket({ id: "plot-1", plotNumber: "1", revenueStatus: "Available", revenueSource: "Development Strategy", niaFt2: Symbol("invalid") }),
    ] } },
    settingsDocument: { ...require("../services/revenueSettingsMapper").settingsRowToDocument(settingsRow(), "dev-close"), exists: true },
  });
  assert.equal(invalidPricing.ready, false);
  assert.ok(invalidPricing.blockers.some((item) => item.reason === "revenue-calculation-failed"));
});
