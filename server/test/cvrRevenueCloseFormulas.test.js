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
  resolveEffectiveRevenueNia,
  getPlotRevenueTenureAuthority,
} = require("../services/cvrRevenueCloseFormulas");
const { DEFAULT_AFFORDABLE_PERCENTAGES, DEFAULT_GARAGE_PREMIUMS } = require(
  "../services/revenueSettingsConstants"
);

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-site-1-revenue-close.json");

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
  return reviewedOpenMarket({
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
  });
}

test("server tenure authority matches every supported reviewed code and fails unknown codes closed", () => {
  const supported = {
    OPEN_MARKET: "Open Market",
    AFFORDABLE_RENT: "Affordable Rent",
    SHARED_OWNERSHIP: "Shared Ownership",
    FIRST_HOMES: "First Homes",
    ADDITIONALITY: "Additionality",
    DISCOUNT_MARKET_SALE: "Discount Market Sale",
    OTHER: "Other",
  };
  for (const [tenureCode, tenure] of Object.entries(supported)) {
    assert.deepEqual(
      getPlotRevenueTenureAuthority({ tenureCode, tenure: "Imported source" }),
      {
        resolved: true,
        tenure,
        tenureCode,
        normalizedTenureCode: tenureCode,
        sourceTenure: "Imported source",
        authoritySource: "reviewed_tenure_code",
      }
    );
  }
  for (const plot of [{}, { tenure: "Open Market" }, { tenureCode: "UNREVIEWED" }, { tenureCode: "malformed" }]) {
    assert.equal(getPlotRevenueTenureAuthority(plot).resolved, false);
  }
});

test("Available and Reserved keep derived forecast with Secured 0", () => {
  for (const status of ["Available", "Reserved"]) {
    const priced = enrichPlotWithPricing(manualPlot({ revenueStatus: status }), strategy(), {});
    assert.equal(priced.forecastRevenue, 255100);
    assert.equal(priced.securedRevenue, 0);
  }
});

test("Reserved positive sellingPrice drives Forecast but remains unsecured", () => {
  const priced = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Reserved", revenueSource: "House Type", houseType: "Unknown", niaFt2: 0, sellingPrice: 330000 }),
    strategy(),
    {}
  );
  assert.equal(priced.derivedForecast, 0);
  assert.equal(priced.forecastRevenue, 330000);
  assert.equal(priced.securedRevenue, 0);
  assert.equal(priced.remainingForecastRevenue, 330000);
  assert.equal(priced.reservedSellingPriceAuthority, true);
});

test("Available retained sellingPrice does not override configured source", () => {
  const priced = enrichPlotWithPricing(
    manualPlot({ revenueStatus: "Available", sellingPrice: 330000 }), strategy(), {}
  );
  assert.equal(priced.forecastRevenue, 255100);
  assert.equal(priced.securedRevenue, 0);
  assert.equal(priced.sellingPrice, 330000);
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
    reviewedOpenMarket({
      id: "ht",
      plotNumber: "1",
      houseType: "Type A",
      niaFt2: 1000,
      revenueSource: "House Type",
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      plotPremium: 1000,
    }),
  ];
  const houseTypes = {
    "Type A": { garage: "Single", sellingBasis: "Auto", representativeNiaFt2: 1000 },
  };
  const houseTypePriced = enrichPlotWithPricing(plots[0], strat, houseTypes, plots);
  assert.equal(houseTypePriced.forecastRevenue, 350 * 1000 + 12500 + 1000);

  const override = enrichPlotWithPricing(
    reviewedOpenMarket({
      id: "ov",
      plotNumber: "2",
      revenueSource: "Plot Override",
      plotOverrideValue: 400000,
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      plotPremium: 5000,
    }),
    strat,
    {}
  );
  assert.equal(override.forecastRevenue, 405000);

  const development = enrichPlotWithPricing(
    reviewedOpenMarket({
      id: "ds",
      plotNumber: "3",
      niaFt2: 800,
      revenueSource: "Development Strategy",
      revenueCategory: "Open Market",
      revenueStatus: "Available",
      garage: "None",
    }),
    strat,
    {}
  );
  assert.equal(development.forecastRevenue, 800 * 350);

  const ah = enrichPlotWithPricing(
    reviewedOpenMarket({
      id: "ah",
      plotNumber: "4",
      niaFt2: 1000,
      revenueSource: "Development Strategy",
      tenure: "Open Market",
      tenureCode: "SHARED_OWNERSHIP",
      revenueStatus: "Available",
      garage: "None",
    }),
    strat,
    {}
  );
  assert.equal(ah.forecastRevenue, roundPlotMoney(350000 * 0.72));
});

test("reviewed Social Rent uses AFFORDABLE_RENT authority consistently and preserves source evidence", () => {
  const plot = {
    id: "social-rent", plotNumber: "1", niaFt2: 1000,
    tenure: "Social Rent", tenureCode: "AFFORDABLE_RENT",
    revenueSource: "Development Strategy", revenueStatus: "Available", garage: "None",
  };
  const priced = enrichPlotWithPricing(plot, strategy(), {}, [plot]);
  assert.equal(priced.tenure, "Social Rent");
  assert.equal(priced.tenureCode, "AFFORDABLE_RENT");
  assert.equal(priced.revenueTenure, "Affordable Rent");
  assert.equal(priced.forecastRevenue, 203000);
  assert.equal(plot.tenure, "Social Rent");
});

test("unreviewed tenure never falls back to Open Market pricing", () => {
  const plot = {
    id: "unreviewed", plotNumber: "2", niaFt2: 1000,
    tenure: "Open Market", tenureCode: "UNREVIEWED",
    revenueSource: "Development Strategy", revenueStatus: "Available", garage: "None",
  };
  const priced = enrichPlotWithPricing(plot, strategy(), {}, [plot]);
  assert.equal(priced.tenureResolved, false);
  assert.equal(priced.tenure, "Open Market");
  assert.equal(priced.tenureCode, "UNREVIEWED");
  assert.equal(priced.revenueTenure, "Unreviewed");
  assert.equal(priced.derivedForecast, null);
});

test("House Type Auto freezes explicit effective Revenue NIA without changing Plot area", () => {
  const plot = {
    id: "ht-no-plot-area",
    plotNumber: "1",
    houseType: "Ashford",
    niaFt2: 0,
    gia: 0,
    revenueSource: "House Type",
    revenueCategory: "Open Market",
    revenueStatus: "Available",
    tenureCode: "OPEN_MARKET",
  };
  const houseTypes = {
    Ashford: { garage: "None", sellingBasis: "Auto", representativeNiaFt2: 750 },
  };
  const priced = enrichPlotWithPricing(plot, strategy(), houseTypes, [plot]);

  assert.equal(priced.forecastRevenue, 262500);
  assert.equal(priced.niaFt2, 750);
  assert.equal(priced.effectiveRevenueNiaSource, "explicit_house_type");
  assert.equal(plot.niaFt2, 0);
  assert.equal(plot.gia, 0);
});

test("Development Strategy remains unresolved without Plot NIA despite House Type NIA", () => {
  const plot = {
    id: "ds-no-plot-area",
    plotNumber: "2",
    houseType: "Ashford",
    niaFt2: 0,
    gia: 0,
    revenueSource: "Development Strategy",
    revenueStatus: "Available",
    tenureCode: "OPEN_MARKET",
  };
  const houseTypes = {
    Ashford: { garage: "None", sellingBasis: "Auto", representativeNiaFt2: 750 },
  };
  const evidence = resolveEffectiveRevenueNia(plot, houseTypes, [plot]);
  const priced = enrichPlotWithPricing(plot, strategy(), houseTypes, [plot]);

  assert.deepEqual(evidence, {
    niaFt2: 0,
    source: "unresolved",
    areaRequired: true,
    resolved: false,
  });
  assert.equal(priced.forecastRevenue, 0);
  assert.equal(priced.niaFt2, 0);
});

test("summarize remaining, plots sold, and no completion double-count", () => {
  const priced = enrichPlotsWithPricing(
    [
      manualPlot({ id: "a", plotNumber: "1", revenueStatus: "Available" }),
      manualPlot({ id: "r", plotNumber: "R", revenueStatus: "Reserved", sellingPrice: 330000 }),
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
  assert.equal(summary.forecastRevenue, 255100 + 330000 + 250000 + 250000);
  assert.equal(summary.securedRevenue, 500000);
  assert.equal(summary.remainingForecast, 255100 + 330000);
  assert.equal(summary.plotsSold, 2);
});

test("Test Site 1 governed source-tenure aliases retain Forecast £10,444,608 / Secured £0", () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const plots = fixture.plotMaster.plots.map(withGovernedFixtureTenure);
  const settings = fixture.settings;
  const priced = enrichPlotsWithPricing(
    plots,
    settings.revenueStrategy,
    settings.houseTypePricing || {}
  );
  const summary = summarizePricedPlots(priced);
  assert.equal(plots.length, 31);
  assert.equal(priced.every((plot) => plot.tenureResolved === true), true);
  assert.equal(summary.forecastRevenue, 10444608);
  assert.equal(summary.securedRevenue, 0);
  assert.equal(summary.remainingForecast, 10444608);
  assert.equal(summary.plotsSold, 0);
});
