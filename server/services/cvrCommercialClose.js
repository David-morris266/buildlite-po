/**
 * BL-032D — Whole-CVR close candidate.
 * Composes existing cost close + server Revenue close + GP/Margin.
 * Does not persist. Does not belong in cvrCloseEngine.
 */

const { buildCvrCloseCandidate } = require("./cvrCloseEngine");
const { CVR_SNAPSHOT_EXPECTED_LIABILITY_SCHEMA_VERSION } = require("./cvrCloseConstants");
const { roundMoney } = require("./cvrCloseFormulas");
const { buildCvrRevenueCloseCandidate } = require("./cvrRevenueClose");

function moneyValueExists(value) {
  if (value == null || value === "") return false;
  return roundMoney(value) != null;
}

function calculateCvrGrossProfit(forecastRevenue, forecastCost) {
  if (!moneyValueExists(forecastRevenue) || !moneyValueExists(forecastCost)) return null;
  return roundMoney(roundMoney(forecastRevenue) - roundMoney(forecastCost));
}

function calculateCvrGrossMarginPercent(grossProfit, forecastRevenue) {
  if (!moneyValueExists(grossProfit) || !moneyValueExists(forecastRevenue)) return null;
  const revenue = roundMoney(forecastRevenue);
  if (revenue == null || Math.abs(revenue) < 0.005) return null;
  const profit = roundMoney(grossProfit);
  if (profit == null) return null;
  return (profit / revenue) * 100;
}

function mergeSourceReadiness(cost, revenue) {
  return {
    ...(cost?.sourceReadiness || {}),
    plotMaster: revenue?.sourceReadiness?.plotMaster || { loaded: false, ready: false },
    revenueSettings: revenue?.sourceReadiness?.revenueSettings || {
      loaded: false,
      ready: false,
    },
  };
}

async function buildWholeCvrCloseCandidate(options = {}) {
  const cost = await buildCvrCloseCandidate(options);
  const revenue = await buildCvrRevenueCloseCandidate({
    clientId: options.clientId,
    developmentId: options.developmentId,
    dbClient: options.dbClient,
    loadDevelopment: options.loadDevelopment,
    loadSettingsRow: options.loadSettingsRow,
  });

  const blockers = [
    ...(cost.blockers || []),
    ...(revenue.blockers || []),
  ];
  const sourceReadiness = mergeSourceReadiness(cost, revenue);

  if (!cost.ready || !cost.complete || !cost.canLock || !cost.snapshot) {
    return {
      ready: false,
      complete: false,
      canLock: false,
      clientId: options.clientId,
      developmentId: options.developmentId,
      periodId: options.periodId,
      blockers: blockers.length ? blockers : [{ source: "cost", reason: "cost-close-not-ready" }],
      sourceReadiness,
      snapshot: null,
      cost,
      revenue,
    };
  }

  if (!revenue.ready || !revenue.canLock || !revenue.summary) {
    return {
      ready: false,
      complete: false,
      canLock: false,
      clientId: options.clientId,
      developmentId: options.developmentId,
      periodId: options.periodId,
      blockers: blockers.length
        ? blockers
        : [{ source: "revenue", reason: "revenue-close-not-ready" }],
      sourceReadiness,
      snapshot: null,
      cost,
      revenue,
    };
  }

  const forecastRevenue = roundMoney(revenue.summary.forecastRevenue) ?? 0;
  const forecastCost = roundMoney(cost.snapshot.finalForecast) ?? 0;
  const grossProfit = calculateCvrGrossProfit(forecastRevenue, forecastCost);
  const grossMarginPercent = calculateCvrGrossMarginPercent(grossProfit, forecastRevenue);

  return {
    ready: true,
    complete: true,
    canLock: true,
    clientId: options.clientId,
    developmentId: options.developmentId,
    periodId: options.periodId,
    blockers: [],
    sourceReadiness,
    cost,
    revenue,
    snapshot: {
      ...cost.snapshot,
      schemaVersion: CVR_SNAPSHOT_EXPECTED_LIABILITY_SCHEMA_VERSION,
      sourceReadiness,
      forecastRevenue,
      securedRevenue: roundMoney(revenue.summary.securedRevenue) ?? 0,
      remainingForecastRevenue: roundMoney(revenue.summary.remainingForecast) ?? 0,
      plotsSold: Number(revenue.summary.plotsSold) || 0,
      plotsRemaining: Number(revenue.summary.plotsRemaining) || 0,
      grossProfit: grossProfit ?? 0,
      grossMarginPercent,
      revenueAssumptions: revenue.assumptions,
      revenueSettingsId: revenue.settingsId,
      revenueSettingsVersion: revenue.settingsVersion,
      plots: revenue.plots,
    },
  };
}

module.exports = {
  buildWholeCvrCloseCandidate,
  calculateCvrGrossProfit,
  calculateCvrGrossMarginPercent,
};
