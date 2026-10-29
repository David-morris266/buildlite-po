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
  getPlotRevenueTenureAuthority,
  getAffordablePercentKey,
  resolveEffectivePlotGarage,
} = require("./cvrRevenueCloseFormulas");
const { buildCvrGiaSnapshotEvidence } = require("./cvrGiaSnapshotEvidence");

function sourceFailure(reason, extra = {}) {
  return { loaded: false, ready: false, reason, ...extra };
}

function sourceOk(value, extra = {}) {
  return { loaded: true, ready: true, value, ...extra };
}

function rethrowApprovalConcurrencyFailure(error) {
  if (["40001", "55P03", "40P01"].includes(error?.code)) throw error;
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
    return !(Number(plot.sellingPrice) > 0) || plot.sellingPriceRequiresConfirmation === true;
  });
}

function hasIndependentPlotForecast(plot = {}) {
  const status = String(plot.revenueStatus || 'Available');
  if (status === 'Cancelled' || status === 'Exchanged' || status === 'Completed') return true;
  if (status === 'Reserved' && Number(plot.sellingPrice) > 0 && plot.sellingPriceRequiresConfirmation !== true) return true;
  return plot.revenueSource === 'Manual Value' && plot.manualOverrideExplicit === true && Number.isFinite(Number(plot.manualForecastValue));
}

function pricingAssumptionsEstablishment(settingsDocument) {
  if (!settingsDocument || settingsDocument.exists === false) {
    return { established: false, source: "not-established", authority: null };
  }
  const authority = settingsDocument.recognitionSettings?.pricingAssumptionsAuthority;
  if (!authority || authority.schemaVersion !== 1) {
    return { established: true, source: "legacy-grandfathered", authority: null };
  }
  return {
    established: authority.established === true,
    source: authority.established === true ? "explicit" : "not-established",
    authority,
  };
}

function plotAssumptionDependency(plot = {}, strategy = {}, houseTypePricing = {}, pricingEstablished = false) {
  if (hasIndependentPlotForecast(plot)) return null;
  const source = plot.revenueSource || DEFAULT_REVENUE_SOURCE;
  // Persisted legacy strategies were already authoritative before explicit
  // per-plot override markers existed. Keep their finite Manual Values usable,
  // while an unestablished development still requires the explicit marker.
  if (
    pricingEstablished &&
    source === "Manual Value" &&
    Number.isFinite(Number(plot.manualForecastValue))
  ) {
    return null;
  }
  const houseTypeRecord = houseTypePricing[String(plot.houseType || "").trim()] || {};
  const calculatedFromRate = source === "Development Strategy" || (
    source === DEFAULT_REVENUE_SOURCE &&
    !(houseTypeRecord.sellingBasis === "Manual" && houseTypeRecord.manualForecastValue != null && Number(houseTypeRecord.manualForecastValue) >= 0)
  );
  const rate = strategy.openMarket?.ratePerFt2;
  if (pricingEstablished && calculatedFromRate && (rate == null || rate === "" || !Number.isFinite(Number(rate)))) {
    return "open-market-rate-missing";
  }
  const tenure = getPlotRevenueTenureAuthority(plot);
  if (!tenure.resolved) return "unreviewed-tenure";
  const affordable = !["OPEN_MARKET", "OTHER"].includes(tenure.normalizedTenureCode);
  const affordableKey = affordable ? getAffordablePercentKey(tenure.tenure) : null;
  const affordablePercent = affordableKey ? strategy.affordableHousing?.[affordableKey] : null;
  const hasAffordablePercent = !affordableKey || (
    affordablePercent != null && affordablePercent !== "" && Number.isFinite(Number(affordablePercent))
  );
  if (source === "Plot Override") {
    if (!pricingEstablished) return affordable ? "affordable-percentage" : null;
    return hasAffordablePercent ? null : "affordable-percentage-missing";
  }
  if (source === DEFAULT_REVENUE_SOURCE) {
    if (houseTypeRecord.sellingBasis === "Manual" && houseTypeRecord.manualForecastValue != null && Number(houseTypeRecord.manualForecastValue) >= 0) {
      if (!pricingEstablished) return affordable ? "affordable-percentage" : null;
      return hasAffordablePercent ? null : "affordable-percentage-missing";
    }
    if (!pricingEstablished) return "house-type-auto-pricing";
  } else if (source === "Development Strategy") {
    if (!pricingEstablished) return "development-strategy";
  } else {
    return pricingEstablished ? "pricing-assumptions-missing" : "pricing-assumptions";
  }
  const garage = resolveEffectivePlotGarage(plot, houseTypePricing);
  if (["Single", "Double"].includes(garage)) {
    const key = garage.toLowerCase();
    const premium = strategy.garagePremiums?.[key];
    if (premium == null || premium === "" || !Number.isFinite(Number(premium))) return `${key}-garage-premium-missing`;
  }
  return hasAffordablePercent ? null : "affordable-percentage-missing";
}

function establishmentEvidence(plots = [], settingsDocument = null) {
  const pricing = pricingAssumptionsEstablishment(settingsDocument);
  const houseTypes = settingsDocument?.houseTypePricing || {};
  const sources = { imported: 0, manual: 0, calculated: 0, unresolved: 0 };
  const dependentPlots = [];
  const independentPlots = [];
  for (const plot of plots) {
    const provenance = plot.forecastImportProvenance;
    if (plot.revenueSource === "Manual Value" && provenance && !provenance.supersededAt) sources.imported += 1;
    else if (plot.revenueSource === "Manual Value") sources.manual += 1;
    const dependency = plotAssumptionDependency(
      plot,
      settingsDocument?.revenueStrategy || {},
      houseTypes,
      pricing.established
    );
    if (dependency) {
      sources.unresolved += 1;
      dependentPlots.push({ plotId: plotIdentity(plot, dependentPlots.length), plotNumber: String(plot.plotNumber || ""), reason: dependency });
    } else {
      if (plot.revenueSource !== "Manual Value") sources.calculated += 1;
      independentPlots.push(plot);
    }
  }
  let partialForecastRevenue = 0;
  if (!pricing.established && independentPlots.length) {
    const priced = enrichPlotsWithPricing(
      independentPlots,
      settingsDocument?.revenueStrategy || {},
      houseTypes
    );
    partialForecastRevenue = summarizePricedPlots(priced).forecastRevenue;
  }
  return {
    strategyEstablished: pricing.established,
    strategyEstablishmentSource: pricing.source,
    strategyAuthority: pricing.authority,
    established: dependentPlots.length === 0 && plots.length > 0,
    breakdown: sources,
    dependentPlots,
    partialForecastRevenue,
    outstandingPlotCount: dependentPlots.length,
  };
}

function duplicatePlotIdentity(plots = []) {
  const seen = new Set();
  for (const [index, plot] of plots.entries()) {
    const identity = plotIdentity(plot, index);
    if (seen.has(identity)) return identity;
    seen.add(identity);
  }
  return null;
}

function snapshotPlotFromEnriched(plot, index) {
  return {
    plotId: plotIdentity(plot, index),
    plotNumber: String(plot.plotNumber || "").trim(),
    houseType: String(plot.houseType || "").trim(),
    tenure: String(plot.revenueTenure || "").trim(),
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
    displayMetadata: {
      effectiveRevenueNiaSource: plot.effectiveRevenueNiaSource || "unresolved",
    },
  };
}

function freezeAssumptions(settingsDocument) {
  const strategy = settingsDocument.revenueStrategy || {};
  return {
    revenueMode: settingsDocument.revenueMode || "sales_register",
    summaryRevenueLines: JSON.parse(JSON.stringify(settingsDocument.summaryRevenueLines || [])),
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
    settingsUpdatedAt: settingsDocument.updatedAt || null,
    settingsUpdatedBy: settingsDocument.updatedBy || null,
    settingsUpdatedByUserId: settingsDocument.updatedByUserId || null,
    settingsUpdatedByMembershipId: settingsDocument.updatedByMembershipId || null,
  };
}

function notReady({ clientId, developmentId, blockers, sources, establishment = null }) {
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
    establishment,
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

function buildRevenueAuthorityFromDocuments({ clientId, developmentId, development, settingsDocument } = {}) {
  const sources = {
    plotMaster: sourceFailure("not-loaded"),
    revenueSettings: sourceFailure("not-loaded"),
  };
  const blockers = [];
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

  const establishment = establishmentEvidence(Array.isArray(plots) ? plots : [], settingsDocument);
  const independentPlotForecasts = Array.isArray(plots) && plots.length > 0 && plots.every(hasIndependentPlotForecast);
  if ((!settingsDocument || settingsDocument.exists === false) && !independentPlotForecasts) {
    sources.revenueSettings = sourceFailure("revenue-settings-missing");
    blockers.push({ source: "revenueSettings", reason: "revenue-settings-missing" });
  } else if (!settingsDocument || settingsDocument.exists === false) {
    settingsDocument = { id:null, exists:false, version:0, revenueMode:'sales_register', summaryRevenueLines:[], recognitionPolicy:'completion', revenueStrategy:{}, houseTypePricing:{}, revenueAdjustments:[], recognitionSettings:{}, independentlyEstablishedPlotForecasts:true };
    sources.revenueSettings = sourceOk(settingsDocument, { reason:'independent-plot-forecasts' });
  } else {
    sources.revenueSettings = sourceOk(settingsDocument);
  }

  const summaryMode = settingsDocument?.revenueMode === "summary";
  if (summaryMode) {
    const settingsBlockers = blockers.filter((item) => item.source === "revenueSettings");
    if (settingsBlockers.length) return notReady({ clientId, developmentId, blockers: settingsBlockers, sources, establishment });
    const lines = settingsDocument.summaryRevenueLines || [];
    if (!lines.length) return notReady({ clientId, developmentId, blockers:[{source:"revenueSettings",reason:"summary-revenue-lines-missing"}], sources, establishment });
    const forecastRevenue = lines.reduce((total, line) => roundPlotMoney(total + Number(line.forecastRevenue || 0)), 0);
    return {
      ready:true, complete:true, canLock:true, clientId, developmentId, blockers:[], sourceReadiness:sources,
      summary:{ forecastRevenue, securedRevenue:null, remainingForecast:null, plotsSold:null, plotsRemaining:null },
      plots:[], assumptions:freezeAssumptions(settingsDocument), settingsId:settingsDocument.id,
      settingsVersion:Number(settingsDocument.version)||null,
      establishment: { ...establishment, established: true, authorityMode: "summary" },
    };
  }

  if (blockers.length) return notReady({ clientId, developmentId, blockers, sources, establishment });
  const duplicateIdentity = duplicatePlotIdentity(plots);
  if (duplicateIdentity) {
    blockers.push({
      source: "plotMaster",
      reason: "duplicate-plot-id",
      message: `Duplicate plot identity in Plot Master: ${duplicateIdentity}.`,
    });
    return notReady({ clientId, developmentId, blockers, sources, establishment });
  }
  const invalid = invalidSecuredPlots(plots);
  if (invalid.length) {
    const plotNumbers = invalid.map((plot) => String(plot.plotNumber || plot.id || "?"));
    blockers.push({
      source: "plotMaster",
      reason: "invalid-secured-selling-price",
      plotNumbers,
      message: `Reserved/Exchanged/Completed plots require deliberately confirmed contractual selling-price evidence: ${plotNumbers.join(", ")}.`,
    });
    return notReady({ clientId, developmentId, blockers, sources, establishment });
  }

  const unresolvedTenure = plots.filter((plot) => !getPlotRevenueTenureAuthority(plot).resolved);
  if (unresolvedTenure.length) {
    const plotNumbers = unresolvedTenure.map((plot) => String(plot.plotNumber || plot.id || "?"));
    blockers.push({
      source: "plotMaster",
      reason: "unreviewed-plot-tenure",
      plotNumbers,
      message: `Plot Master tenure review is required for: ${plotNumbers.join(", ")}.`,
    });
    return notReady({ clientId, developmentId, blockers, sources, establishment });
  }

  if (establishment.dependentPlots.length) {
    blockers.push({
      source: "revenueSettings",
      reason: "pricing-assumptions-not-established",
      plotNumbers: establishment.dependentPlots.map((plot) => plot.plotNumber),
      message: `${establishment.dependentPlots.length} plot forecast${establishment.dependentPlots.length === 1 ? "" : "s"} depend on pricing assumptions that have not been established.`,
    });
    return notReady({ clientId, developmentId, blockers, sources, establishment });
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
    return notReady({ clientId, developmentId, blockers, sources, establishment });
  }

  const summary = summarizePricedPlots(priced);
  const snapshotPlots = priced.map((plot, index) => snapshotPlotFromEnriched(plot, index));

  return {
    ready: true, complete: true, canLock: true, clientId, developmentId, blockers: [],
    sourceReadiness: sources, summary, plots: snapshotPlots,
    assumptions: freezeAssumptions(settingsDocument), settingsId: settingsDocument.id,
    settingsVersion: Number(settingsDocument.version) || null,
    establishment: { ...establishment, established: true, authorityMode: "sales_register" },
  };
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
    rethrowApprovalConcurrencyFailure(err);
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
    rethrowApprovalConcurrencyFailure(err);
    sources.revenueSettings = sourceFailure("revenue-settings-query-failed", {
      error: err.message,
    });
    blockers.push({ source: "revenueSettings", reason: "revenue-settings-query-failed" });
  }

  const giaEvidence = buildCvrGiaSnapshotEvidence(development);
  if (blockers.some((item) => item.reason.endsWith("query-failed"))) {
    return { ...notReady({ clientId, developmentId, blockers, sources }), giaEvidence };
  }
  return {
    ...buildRevenueAuthorityFromDocuments({ clientId, developmentId, development, settingsDocument }),
    giaEvidence,
  };
}

module.exports = {
  buildCvrRevenueCloseCandidate,
  buildRevenueAuthorityFromDocuments,
  plotsFromDevelopment,
  invalidSecuredPlots,
  freezeAssumptions,
};
