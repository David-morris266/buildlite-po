/**
 * BL-032D — Server Revenue close candidate.
 * Loads Plot Master + revenue settings on the caller's dbClient.
 * Does not persist and does not mutate Plot Master.
 */

const { findDevelopmentById } = require("./developmentRepository");
const { settingsRowToDocument } = require("./revenueSettingsMapper");
const { findSettingsRow } = require("./revenueSettingsRepository");
const {
  enrichPlotsWithPricing,
  summarizePricedPlots,
  roundPlotMoney,
  isSecuredRevenueStatus,
  DEFAULT_REVENUE_SOURCE,
} = require("./cvrRevenueCloseFormulas");

function sourceFailure(reason, extra = {}) {
  return { loaded: false, ready: false, reason, ...extra };
}

function sourceOk(value, extra = {}) {
  return { loaded: true, ready: true, value, ...extra };
}

function plotsFromDevelopment(development) {
  if (!development || typeof development !== "object") return null;
  const plotMaster = development.plotMaster;
  if (!plotMaster || typeof plotMaster !== "object") return null;
  if (!Array.isArray(plotMaster.plots)) return null;
  return plotMaster.plots;
}

function plotIdentity(plot, index) {
  const id = String(plot?.id || "").trim();
  if (id) return id;
  const number = String(plot?.plotNumber || "").trim();
  if (number) return `plot-number:${number}`;
  return `plot-index:${index}`;
}

function dateOrNull(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function invalidSecuredPlots(plots = []) {
  return plots.filter((plot) => {
    if (!isSecuredRevenueStatus(plot.revenueStatus)) return false;
    return !(Number(plot.sellingPrice) > 0);
  });
}

function snapshotPlotFromEnriched(plot, index) {
  return {
    plotId: plotIdentity(plot, index),
    plotNumber: String(plot.plotNumber || "").trim(),
    houseType: String(plot.houseType || "").trim(),
    tenure: String(plot.tenure || "").trim(),
    revenueCategory: String(plot.revenueCategory || "").trim(),
    revenueStatus: String(plot.revenueStatus || "Available"),
    revenueSource: plot.revenueSource || DEFAULT_REVENUE_SOURCE,
    forecastRevenue: roundPlotMoney(plot.forecastRevenue),
    securedRevenue: roundPlotMoney(plot.securedRevenue),
    remainingForecastRevenue: roundPlotMoney(plot.remainingForecastRevenue),
    sellingPrice: isSecuredRevenueStatus(plot.revenueStatus)
      ? roundPlotMoney(plot.sellingPrice)
      : roundPlotMoney(plot.sellingPrice || 0) || null,
    derivedForecast: roundPlotMoney(plot.derivedForecast),
    plotPremium: roundPlotMoney(plot.plotPremium || 0),
    niaFt2: roundPlotMoney(plot.niaFt2),
    effectiveGarage: plot.effectiveGarage || "None",
    reservedAt: dateOrNull(plot.reservedAt),
    exchangedAt: dateOrNull(plot.exchangedAt),
    completedAt: dateOrNull(plot.completedAt),
    displayMetadata: {},
  };
}

function freezeAssumptions(settingsDocument) {
  const strategy = settingsDocument.revenueStrategy || {};
  return {
    recognitionPolicy: settingsDocument.recognitionPolicy || "completion",
    openMarket: {
      ratePerFt2: strategy.openMarket?.ratePerFt2 ?? null,
      effectiveDate: strategy.openMarket?.effectiveDate || "",
    },
    affordableHousing: { ...(strategy.affordableHousing || {}) },
    garagePremiums: { ...(strategy.garagePremiums || {}) },
    houseTypePricing: JSON.parse(JSON.stringify(settingsDocument.houseTypePricing || {})),
    revenueAdjustments: Array.isArray(settingsDocument.revenueAdjustments)
      ? JSON.parse(JSON.stringify(settingsDocument.revenueAdjustments))
      : [],
    recognitionSettings:
      settingsDocument.recognitionSettings && typeof settingsDocument.recognitionSettings === "object"
        ? JSON.parse(JSON.stringify(settingsDocument.recognitionSettings))
        : {},
    settingsId: settingsDocument.id || null,
    settingsVersion: Number(settingsDocument.version) || null,
  };
}

function notReady({ clientId, developmentId, blockers, sources }) {
  return {
    ready: false,
    complete: false,
    canLock: false,
    clientId,
    developmentId,
    blockers,
    sourceReadiness: sources,
    summary: null,
    plots: [],
    assumptions: null,
  };
}

async function lockDevelopmentForShare(clientId, developmentId, dbClient) {
  if (!dbClient) {
    return findDevelopmentById(clientId, developmentId);
  }
  const { rows } = await dbClient.query(
    `
      SELECT *
      FROM developments
      WHERE id = $1 AND client_id = $2
      LIMIT 1
      FOR SHARE
    `,
    [developmentId, clientId]
  );
  if (!rows[0]) return null;
  return findDevelopmentById(clientId, developmentId, dbClient);
}

async function buildCvrRevenueCloseCandidate({
  clientId,
  developmentId,
  dbClient = null,
  loadDevelopment = null,
  loadSettingsRow = null,
} = {}) {
  const sources = {
    plotMaster: sourceFailure("not-loaded"),
    revenueSettings: sourceFailure("not-loaded"),
  };
  const blockers = [];

  let development = null;
  try {
    development = loadDevelopment
      ? await loadDevelopment()
      : await lockDevelopmentForShare(clientId, developmentId, dbClient);
    const plots = plotsFromDevelopment(development);
    if (!development) {
      sources.plotMaster = sourceFailure("development-not-found");
      blockers.push({ source: "plotMaster", reason: "development-not-found" });
    } else if (plots == null) {
      sources.plotMaster = sourceFailure("plot-master-unavailable");
      blockers.push({ source: "plotMaster", reason: "plot-master-unavailable" });
    } else {
      sources.plotMaster = sourceOk(plots);
    }
  } catch (err) {
    sources.plotMaster = sourceFailure("plot-master-query-failed", { error: err.message });
    blockers.push({ source: "plotMaster", reason: "plot-master-query-failed" });
  }

  let settingsDocument = null;
  try {
    const row = loadSettingsRow
      ? await loadSettingsRow()
      : await findSettingsRow(clientId, developmentId, dbClient, { forShare: Boolean(dbClient) });
    settingsDocument = settingsRowToDocument(row, developmentId);
    if (!row || settingsDocument.exists === false) {
      sources.revenueSettings = sourceFailure("revenue-settings-missing");
      blockers.push({ source: "revenueSettings", reason: "revenue-settings-missing" });
      settingsDocument = null;
    } else {
      sources.revenueSettings = sourceOk(settingsDocument);
    }
  } catch (err) {
    sources.revenueSettings = sourceFailure("revenue-settings-query-failed", {
      error: err.message,
    });
    blockers.push({ source: "revenueSettings", reason: "revenue-settings-query-failed" });
  }

  if (blockers.length) {
    return notReady({ clientId, developmentId, blockers, sources });
  }

  const plots = sources.plotMaster.value;
  const invalid = invalidSecuredPlots(plots);
  if (invalid.length) {
    const plotNumbers = invalid.map((plot) => String(plot.plotNumber || plot.id || "?"));
    blockers.push({
      source: "plotMaster",
      reason: "invalid-secured-selling-price",
      plotNumbers,
      message: `Exchanged/Completed plots require sellingPrice > 0: ${plotNumbers.join(", ")}.`,
    });
    return notReady({ clientId, developmentId, blockers, sources });
  }

  let priced;
  try {
    priced = enrichPlotsWithPricing(
      plots,
      settingsDocument.revenueStrategy || {},
      settingsDocument.houseTypePricing || {}
    );
  } catch (err) {
    blockers.push({ source: "revenue", reason: "revenue-calculation-failed", error: err.message });
    return notReady({ clientId, developmentId, blockers, sources });
  }

  const summary = summarizePricedPlots(priced);
  const snapshotPlots = priced.map((plot, index) => snapshotPlotFromEnriched(plot, index));
  const seen = new Set();
  for (const row of snapshotPlots) {
    if (seen.has(row.plotId)) {
      blockers.push({
        source: "plotMaster",
        reason: "duplicate-plot-id",
        message: `Duplicate plot identity in Plot Master: ${row.plotId}.`,
      });
      return notReady({ clientId, developmentId, blockers, sources });
    }
    seen.add(row.plotId);
  }

  return {
    ready: true,
    complete: true,
    canLock: true,
    clientId,
    developmentId,
    blockers: [],
    sourceReadiness: sources,
    summary,
    plots: snapshotPlots,
    assumptions: freezeAssumptions(settingsDocument),
    settingsId: settingsDocument.id,
    settingsVersion: Number(settingsDocument.version) || null,
  };
}

module.exports = {
  buildCvrRevenueCloseCandidate,
  plotsFromDevelopment,
  invalidSecuredPlots,
  freezeAssumptions,
};
