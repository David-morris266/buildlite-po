/**
 * BL-032D — Pure server Revenue close formulas.
 * Mirrors banked BL-032B client pricing / lifecycle rules.
 * No stores, no Plot Master writes, no Express.
 */

const {
  DEFAULT_AFFORDABLE_PERCENTAGES,
  DEFAULT_GARAGE_PREMIUMS,
} = require("./revenueSettingsConstants");

const DEFAULT_REVENUE_SOURCE = "House Type";
const GARAGE_TYPES = ["None", "Single", "Double"];
const SECURED_REVENUE_STATUSES = ["Exchanged", "Completed"];

function roundPlotMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function normalizePlotRevenueStatus(status) {
  const value = String(status || "Available").trim();
  return value || "Available";
}

function isCancelledRevenueStatus(status) {
  return normalizePlotRevenueStatus(status) === "Cancelled";
}

function isSecuredRevenueStatus(status) {
  return SECURED_REVENUE_STATUSES.includes(normalizePlotRevenueStatus(status));
}

function getPlotNiaFt2(plot = {}) {
  const explicit = Number(plot.niaFt2);
  if (Number.isFinite(explicit) && explicit > 0) return roundPlotMoney(explicit);
  const gia = Number(plot.gia);
  if (Number.isFinite(gia) && gia > 0) return roundPlotMoney(gia);
  return 0;
}

function getPlotPricingTenure(plot = {}) {
  const tenure = String(plot.tenure || "").trim();
  if (tenure) return tenure;
  return String(plot.revenueCategory || "").trim();
}

function getAffordablePercentKey(tenureOrCategory = "") {
  const value = String(tenureOrCategory || "").trim().toLowerCase();
  if (!value || value === "open market" || value === "private" || value === "market") {
    return null;
  }
  if (value.includes("shared ownership") || value === "social shared") return "sharedOwnership";
  if (value.includes("first homes")) return "firstHomes";
  if (value.includes("additionality")) return "additionality";
  if (value.includes("discount market") || value === "dms") return "discountMarketSale";
  if (value.includes("affordable rent") || value.includes("social rent")) return "affordableRent";
  if (value.includes("affordable housing")) return "affordableRent";
  if (value === "other") return "other";
  if (value.includes("affordable")) return "affordableRent";
  return null;
}

function garageTypeToKey(garage = "None") {
  const value = String(garage || "None").trim().toLowerCase();
  if (value === "single") return "single";
  if (value === "double") return "double";
  return "none";
}

function normalizePlotGarageValue(garage) {
  const value = String(garage || "None").trim();
  return GARAGE_TYPES.includes(value) ? value : "None";
}

function getGaragePremium(garage = "None", strategy = {}) {
  const key = garageTypeToKey(garage);
  return roundPlotMoney(strategy.garagePremiums?.[key] || 0);
}

function resolveEffectivePlotGarage(plot = {}, houseTypePricing = {}) {
  if (plot.garageOverride) {
    return normalizePlotGarageValue(plot.garage);
  }
  const houseType = String(plot.houseType || "").trim();
  const record = houseTypePricing[houseType];
  if (record?.garage) return normalizePlotGarageValue(record.garage);
  return normalizePlotGarageValue(plot.garage);
}

function applyAffordableDiscount(omvPrice, tenureOrCategory, strategy = {}) {
  const openMarketValue = roundPlotMoney(omvPrice);
  if (!openMarketValue) return 0;
  const key = getAffordablePercentKey(tenureOrCategory);
  if (!key) return openMarketValue;
  const percent = Number(strategy.affordableHousing?.[key]);
  if (!Number.isFinite(percent) || percent <= 0) return openMarketValue;
  return roundPlotMoney(openMarketValue * (percent / 100));
}

function calculateOpenMarketBase({ niaFt2 = 0, garage = "None", strategy = {} } = {}) {
  const area = roundPlotMoney(niaFt2);
  const rate = roundPlotMoney(strategy.openMarket?.ratePerFt2 || 0);
  if (!area || !rate) return 0;
  return roundPlotMoney(area * rate + getGaragePremium(garage, strategy));
}

function normalizeHouseTypePricingRecord(record = {}) {
  return {
    garage: GARAGE_TYPES.includes(record.garage) ? record.garage : "None",
    sellingBasis: record.sellingBasis === "Manual" ? "Manual" : "Auto",
    manualForecastValue: roundPlotMoney(record.manualForecastValue || 0),
    representativeNiaFt2:
      record.representativeNiaFt2 == null || record.representativeNiaFt2 === ""
        ? null
        : roundPlotMoney(record.representativeNiaFt2),
  };
}

function getRepresentativeNiaForHouseType(houseType, plots = [], override = null) {
  if (override != null && Number(override) > 0) return roundPlotMoney(override);
  const matches = plots.filter(
    (plot) =>
      String(plot.houseType || "").trim().toLowerCase() ===
      String(houseType || "").trim().toLowerCase()
  );
  if (!matches.length) return 0;
  const values = matches.map((plot) => getPlotNiaFt2(plot)).filter((value) => value > 0);
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return roundPlotMoney(total / values.length);
}

function calculateHouseTypeForecast(houseType, houseTypeRecord = {}, strategy = {}, plots = []) {
  const record = normalizeHouseTypePricingRecord(houseTypeRecord);
  if (record.sellingBasis === "Manual") {
    return roundPlotMoney(record.manualForecastValue);
  }
  const niaFt2 = getRepresentativeNiaForHouseType(
    houseType,
    plots,
    record.representativeNiaFt2
  );
  return calculateOpenMarketBase({
    niaFt2,
    garage: record.garage,
    strategy,
  });
}

function buildHouseTypePricingMap(plots = [], existing = {}) {
  const houseTypes = [
    ...new Set(plots.map((plot) => String(plot.houseType || "").trim()).filter(Boolean)),
  ];
  const next = { ...existing };
  for (const houseType of houseTypes) {
    next[houseType] = normalizeHouseTypePricingRecord(next[houseType] || {
      garage: "None",
      sellingBasis: "Auto",
    });
  }
  return next;
}

function resolvePlotOpenMarketBase(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;
  const garage = resolveEffectivePlotGarage(plot, houseTypePricing);

  if (source === "Manual Value") {
    return roundPlotMoney(plot.manualForecastValue || 0);
  }
  if (source === "Plot Override") {
    return roundPlotMoney(plot.plotOverrideValue || 0);
  }
  if (source === "Development Strategy") {
    return calculateOpenMarketBase({
      niaFt2: getPlotNiaFt2(plot),
      garage,
      strategy,
    });
  }

  const houseType = String(plot.houseType || "").trim();
  const record = houseTypePricing[houseType] || { garage: "None", sellingBasis: "Auto" };
  return calculateHouseTypeForecast(houseType, { ...record, garage }, strategy, plots);
}

function resolvePlotForecastPrice(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;
  if (source === "Manual Value") {
    return roundPlotMoney(plot.manualForecastValue || 0);
  }
  const openMarketBase = resolvePlotOpenMarketBase(plot, strategy, houseTypePricing, plots);
  const withPremium = roundPlotMoney(openMarketBase + roundPlotMoney(plot.plotPremium || 0));
  return applyAffordableDiscount(withPremium, getPlotPricingTenure(plot), strategy);
}

function enrichPlotWithPricing(plot = {}, strategy = {}, houseTypePricing = {}, plots = []) {
  const effectiveGarage = resolveEffectivePlotGarage(plot, houseTypePricing);
  const derivedForecast = resolvePlotForecastPrice(plot, strategy, houseTypePricing, plots);
  const cancelled = isCancelledRevenueStatus(plot.revenueStatus);
  const secured = isSecuredRevenueStatus(plot.revenueStatus);
  const contractPrice = roundPlotMoney(plot.sellingPrice || 0);

  let forecastRevenue = derivedForecast;
  let securedRevenue = 0;
  if (cancelled) {
    forecastRevenue = 0;
  } else if (secured) {
    forecastRevenue = contractPrice;
    securedRevenue = contractPrice;
  }

  return {
    ...plot,
    effectiveGarage,
    derivedForecast,
    forecastRevenue,
    securedRevenue,
    remainingForecastRevenue: roundPlotMoney(forecastRevenue - securedRevenue),
    sellingPrice: contractPrice,
    niaFt2: getPlotNiaFt2(plot),
    tenure: getPlotPricingTenure(plot),
    revenueStatus: normalizePlotRevenueStatus(plot.revenueStatus),
    revenueSource: plot.revenueSource || DEFAULT_REVENUE_SOURCE,
  };
}

function enrichPlotsWithPricing(plots = [], strategy = {}, houseTypePricing = {}) {
  const map = buildHouseTypePricingMap(plots, houseTypePricing);
  return plots.map((plot) => enrichPlotWithPricing(plot, strategy, map, plots));
}

function summarizePricedPlots(pricedPlots = []) {
  let forecastRevenue = 0;
  let securedRevenue = 0;
  let plotsSold = 0;
  let cancelled = 0;

  for (const plot of pricedPlots) {
    forecastRevenue += roundPlotMoney(plot.forecastRevenue);
    securedRevenue += roundPlotMoney(plot.securedRevenue);
    const status = normalizePlotRevenueStatus(plot.revenueStatus);
    if (status === "Exchanged" || status === "Completed") plotsSold += 1;
    if (status === "Cancelled") cancelled += 1;
  }

  forecastRevenue = roundPlotMoney(forecastRevenue);
  securedRevenue = roundPlotMoney(securedRevenue);
  const remainingForecast = roundPlotMoney(Math.max(0, forecastRevenue - securedRevenue));
  const plotsRemaining = Math.max(0, pricedPlots.length - plotsSold - cancelled);

  return {
    forecastRevenue,
    securedRevenue,
    remainingForecast,
    plotsSold,
    plotsRemaining,
  };
}

function defaultStrategy() {
  return {
    openMarket: { ratePerFt2: 350, effectiveDate: "" },
    affordableHousing: { ...DEFAULT_AFFORDABLE_PERCENTAGES },
    garagePremiums: { ...DEFAULT_GARAGE_PREMIUMS },
  };
}

module.exports = {
  DEFAULT_REVENUE_SOURCE,
  roundPlotMoney,
  normalizePlotRevenueStatus,
  isCancelledRevenueStatus,
  isSecuredRevenueStatus,
  getPlotNiaFt2,
  getPlotPricingTenure,
  getAffordablePercentKey,
  resolveEffectivePlotGarage,
  applyAffordableDiscount,
  calculateOpenMarketBase,
  normalizeHouseTypePricingRecord,
  buildHouseTypePricingMap,
  resolvePlotForecastPrice,
  enrichPlotWithPricing,
  enrichPlotsWithPricing,
  summarizePricedPlots,
  defaultStrategy,
};
