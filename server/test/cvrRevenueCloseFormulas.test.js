/**
 * BL-032D — Server Revenue close formula characterisation (no DB).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const {
  enrichPlotWithPricing,
  enrichPlotsWithPricing,
  summarizePricedPlots,
  defaultStrategy,
  roundPlotMoney,
} = require("../services/cvrRevenueCloseFormulas");
const { DEFAULT_AFFORDABLE_PERCENTAGES, DEFAULT_GARAGE_PREMIUMS } = require(
  "../services/revenueSettingsConstants"
);

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-site-1-revenue-close.json");

function strategy(overrides = {}) {
  return {
    ...defaultStrategy(),
    ...overrides,
    openMarket: { ...defaultStrategy().openMarket, ...(overrides.openMarket || {}) },
    affordableHousing: {
      ...DEFAULT_AFFORDABLE_PERCENTAGES,
      ...(overrides.affordableHousing || {}),
    },
    garagePremiums: { ...DEFAULT_GARAGE_PREMIUMS, ...(overrides.garagePremiums || {}) },
  };
}

function manualPlot(overrides = {}) {
  return {
    id: overrides.id || "plot-1",
    plotNumber: overrides.plotNumber || "1",
    houseType: "Arundel",
    niaFt2: 686,
    revenueCategory: "Open Market",
    revenueSource: "Manual Value",
    manualForecastValue: overrides.manualForecastValue ?? 255100,
    sellingPrice: overrides.sellingPrice ?? 0,
    revenueStatus: overrides.revenueStatus || "Available",
    plotPremium: 0,
    ...overrides,
  };
}

test("Available and Reserved keep derived forecast with Secured 0", () => {
  for (const status of ["Available", "Reserved"]) {
    const priced = enrichPlotWithPricing(manualPlot({ revenueStatus: status }), strategy(), {});
    assert.equal(priced.forecastRevenue, 255100);
    assert.equal(priced.securedRevenue, 0);
  }
});

test("Exchanged substitutes contractual sellingPrice for Forecast and Secured", () => {
  const priced = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Exchanged", sellingPrice: 250000, manualForecastValue: 255100 }),
    strategy(),
    {}
  );
  assert.equal(priced.forecastRevenue, 250000);
  assert.equal(priced.securedRevenue, 250000);
  assert.equal(priced.derivedForecast, 255100);
});

test("Completed is not a second money event", () => {
  const exchanged = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Exchanged", sellingPrice: 250000 }),
    strategy(),
    {}
  );
  const completed = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Completed", sellingPrice: 250000 }),
    strategy(),
    {}
  );
  assert.equal(completed.forecastRevenue, exchanged.forecastRevenue);
  assert.equal(completed.securedRevenue, exchanged.securedRevenue);
});

test("Cancelled zeros Forecast and Secured", () => {
  const priced = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Cancelled", sellingPrice: 250000 }),
    strategy(),
    {}
  );
  assert.equal(priced.forecastRevenue, 0);
  assert.equal(priced.securedRevenue, 0);
});

test("Plot Override, House Type, Development Strategy, AH, garage and premium", () => {
  const strat = strategy({
    openMarket: { ratePerFt2: 350 },
    affordableHousing: { ...DEFAULT_AFFORDABLE_PERCENTAGES, sharedOwnership: 72 },
    garagePremiums: { none: 0, single: 12500, double: 22500 },
  });
  const plots = [
    {
      id: "ht",
      plotNumber: "1",
      houseType: "Type A",
      niaFt2: 1000,
      revenueSource: "House Type",
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      plotPremium: 1000,
    },
  ];
  const houseTypes = {
    "Type A": { garage: "Single", sellingBasis: "Auto", representativeNiaFt2: 1000 },
  };
  const houseTypePriced = enrichPlotWithPricing(plots[0], strat, houseTypes, plots);
  assert.equal(houseTypePriced.forecastRevenue, 350 * 1000 + 12500 + 1000);

  const override = enrichPlotWithPricing(
    {
      id: "ov",
      plotNumber: "2",
      revenueSource: "Plot Override",
      plotOverrideValue: 400000,
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      plotPremium: 5000,
    },
    strat,
    {}
  );
  assert.equal(override.forecastRevenue, 405000);

  const development = enrichPlotWithPricing(
    {
      id: "ds",
      plotNumber: "3",
      niaFt2: 800,
      revenueSource: "Development Strategy",
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      garage: "None",
    },
    strat,
    {}
  );
  assert.equal(development.forecastRevenue, 800 * 350);

  const ah = enrichPlotWithPricing(
    {
      id: "ah",
      plotNumber: "4",
      niaFt2: 1000,
      revenueSource: "Development Strategy",
      tenure: "Shared Ownership",
      revenueStatus: "Available",
      garage: "None",
    },
    strat,
    {}
  );
  assert.equal(ah.forecastRevenue, roundPlotMoney(350000 * 0.72));
});

test("summarize remaining, plots sold, and no completion double-count", () => {
  const priced = enrichPlotsWithPricing(
    [
      manualPlot({ id: "a", plotNumber: "1", revenueStatus: "Available" }),
      manualPlot({
        id: "b",
        plotNumber: "2",
        revenueStatus: "Exchanged",
        sellingPrice: 250000,
      }),
      manualPlot({
        id: "c",
        plotNumber: "3",
        revenueStatus: "Completed",
        sellingPrice: 250000,
      }),
    ],
    strategy(),
    {}
  );
  const summary = summarizePricedPlots(priced);
  assert.equal(summary.forecastRevenue, 255100 + 250000 + 250000);
  assert.equal(summary.securedRevenue, 500000);
  assert.equal(summary.remainingForecast, 255100);
  assert.equal(summary.plotsSold, 2);
});

test("Test Site 1 characterisation Forecast £10,444,608 / Secured £0", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const plots = fixture.plotMaster.plots;
  const settings = fixture.settings;
  const priced = enrichPlotsWithPricing(
    plots,
    settings.revenueStrategy,
    settings.houseTypePricing || {}
  );
  const summary = summarizePricedPlots(priced);
  assert.equal(summary.forecastRevenue, 10444608);
  assert.equal(summary.securedRevenue, 0);
  assert.equal(summary.remainingForecast, 10444608);
  assert.equal(summary.plotsSold, 0);
});
