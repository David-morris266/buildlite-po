/**
 * BL-019C — Revenue strategy persistence and bulk actions.
 */

import { getPlots, bulkUpdatePlots } from '../developments/plotMaster';
import { roundPlotMoney } from '../developments/plotCommercial';
import {
  applyStrategyToPlots,
  buildHouseTypePricingMap,
  buildStrategySummaryMetrics,
  enrichPlotsWithPricing,
  recalculateHouseTypePricing,
  resolvePlotForecastPrice,
} from './revenueStrategyCalculations';
import {
  isMisclassifiedManualPlot,
  migrateSinglePlotPricing,
} from './revenueSourceMigration';
import {
  AFFORDABLE_HOUSING_TYPES,
  DEFAULT_AFFORDABLE_PERCENTAGES,
  DEFAULT_GARAGE_PREMIUMS,
  DEFAULT_REVENUE_SOURCE,
} from './revenueTypes';
import { getRevenueRecord, saveRevenueRecord } from './revenueStore';

const PROTECTED_REVENUE_SOURCES = new Set(['Manual Value', 'Plot Override']);

function isProtectedPlot(plot = {}) {
  return PROTECTED_REVENUE_SOURCES.has(plot.revenueSource);
}

function isAutoPricedPlot(plot = {}) {
  return !isProtectedPlot(plot);
}

export function emptyRevenueStrategy() {
  return {
    openMarket: {
      ratePerFt2: 350,
      effectiveDate: '',
    },
    affordableHousing: { ...DEFAULT_AFFORDABLE_PERCENTAGES },
    garagePremiums: { ...DEFAULT_GARAGE_PREMIUMS },
    updatedAt: new Date().toISOString(),
  };
}

function normalizePercent(value, fallback) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.max(0, Math.min(100, Math.round(amount * 100) / 100));
}

function normalizeGaragePremiums(input = {}) {
  return {
    none: roundPlotMoney(input.none ?? DEFAULT_GARAGE_PREMIUMS.none),
    single: roundPlotMoney(input.single ?? DEFAULT_GARAGE_PREMIUMS.single),
    double: roundPlotMoney(input.double ?? DEFAULT_GARAGE_PREMIUMS.double),
  };
}

export function normalizeRevenueStrategy(strategy = {}) {
  const defaults = emptyRevenueStrategy();
  const affordableHousing = {};
  for (const item of AFFORDABLE_HOUSING_TYPES) {
    affordableHousing[item.key] = normalizePercent(
      strategy.affordableHousing?.[item.key],
      defaults.affordableHousing[item.key]
    );
  }

  return {
    openMarket: {
      ratePerFt2: roundPlotMoney(strategy.openMarket?.ratePerFt2 ?? defaults.openMarket.ratePerFt2),
      effectiveDate: String(strategy.openMarket?.effectiveDate || '').trim(),
    },
    affordableHousing,
    garagePremiums: normalizeGaragePremiums(strategy.garagePremiums),
    updatedAt: strategy.updatedAt || new Date().toISOString(),
  };
}

export function normalizeHouseTypePricingRecord(record = {}) {
  return {
    garage: ['None', 'Single', 'Double'].includes(record.garage) ? record.garage : 'None',
    sellingBasis: record.sellingBasis === 'Manual' ? 'Manual' : 'Auto',
    manualForecastValue: roundPlotMoney(record.manualForecastValue || 0),
    representativeNiaFt2:
      record.representativeNiaFt2 == null || record.representativeNiaFt2 === ''
        ? null
        : roundPlotMoney(record.representativeNiaFt2),
  };
}

export function normalizeHouseTypePricingMap(input = {}) {
  const next = {};
  for (const [houseType, record] of Object.entries(input || {})) {
    const key = String(houseType || '').trim();
    if (!key) continue;
    next[key] = normalizeHouseTypePricingRecord(record);
  }
  return next;
}

export function getRevenueStrategy(developmentId) {
  const record = getRevenueRecord(developmentId);
  return normalizeRevenueStrategy(record.revenueStrategy || emptyRevenueStrategy());
}

export function getHouseTypePricing(developmentId) {
  const record = getRevenueRecord(developmentId);
  return normalizeHouseTypePricingMap(record.houseTypePricing || {});
}

export function saveRevenueStrategy(developmentId, strategy, houseTypePricing = null) {
  const record = getRevenueRecord(developmentId);
  const next = {
    ...record,
    revenueStrategy: normalizeRevenueStrategy(strategy),
    metadata: {
      ...record.metadata,
      version: 3,
    },
  };
  if (houseTypePricing != null) {
    next.houseTypePricing = normalizeHouseTypePricingMap(houseTypePricing);
  }
  return saveRevenueRecord(developmentId, next);
}

export function saveHouseTypePricing(developmentId, houseTypePricing) {
  const record = getRevenueRecord(developmentId);
  return saveRevenueRecord(developmentId, {
    ...record,
    houseTypePricing: normalizeHouseTypePricingMap(houseTypePricing),
    metadata: {
      ...record.metadata,
      version: 3,
    },
  });
}

export function ensureHouseTypePricingFromPlots(developmentId) {
  const plots = getPlots(developmentId);
  const existing = getHouseTypePricing(developmentId);
  const merged = buildHouseTypePricingMap(plots, existing);
  saveHouseTypePricing(developmentId, merged);
  return merged;
}

export function migratePlotPricingFromLegacy(plots = []) {
  return plots.map((plot) => migrateSinglePlotPricing(plot));
}

export async function syncPlotForecastPrices(developmentId, { onlyAuto = true } = {}) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = ensureHouseTypePricingFromPlots(developmentId);
  const plotUpdates = [];

  for (const plot of plots) {
    if (onlyAuto && isProtectedPlot(plot)) continue;
    const forecast = resolvePlotForecastPrice(plot, strategy, houseTypePricing, plots);
    if (roundPlotMoney(plot.forecastSellingPrice) === forecast) continue;
    plotUpdates.push({
      id: plot.id,
      ...plot,
      forecastSellingPrice: forecast,
      pricingMigrated: true,
    });
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return { ok: true, updatedCount: plotUpdates.length };
}

export async function bulkApplyDevelopmentStrategy(developmentId) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = ensureHouseTypePricingFromPlots(developmentId);
  const nextPlots = applyStrategyToPlots(plots, strategy, houseTypePricing, {
    revenueSource: 'Development Strategy',
    skipManual: true,
  });

  const eligible = plots.filter(isAutoPricedPlot);
  const skippedCount = plots.length - eligible.length;

  const plotUpdates = [];
  for (const plot of nextPlots) {
    const existing = plots.find((row) => row.id === plot.id);
    if (!existing || isProtectedPlot(existing)) continue;
    plotUpdates.push(plot);
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return {
    ok: true,
    updatedCount: plotUpdates.length,
    eligibleCount: eligible.length,
    skippedCount,
    skipReason:
      plotUpdates.length === 0 && eligible.length === 0
        ? 'All plots are manual overrides or plot overrides — nothing to update.'
        : plotUpdates.length === 0 && eligible.length > 0
          ? 'All eligible plots already use Development Strategy pricing.'
          : null,
  };
}

export async function bulkRecalculateHouseTypeValues(developmentId) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = recalculateHouseTypePricing(
    getHouseTypePricing(developmentId),
    plots,
    strategy
  );
  saveHouseTypePricing(developmentId, houseTypePricing);

  const eligible = plots.filter(isAutoPricedPlot);
  const skippedCount = plots.length - eligible.length;

  const plotUpdates = [];
  for (const plot of plots) {
    if (isProtectedPlot(plot)) continue;
    const forecast = resolvePlotForecastPrice(plot, strategy, houseTypePricing, plots);
    if (roundPlotMoney(plot.forecastSellingPrice) !== forecast) {
      plotUpdates.push({
        id: plot.id,
        ...plot,
        forecastSellingPrice: forecast,
        pricingMigrated: true,
      });
    }
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return {
    ok: true,
    updatedCount: plotUpdates.length,
    eligibleCount: eligible.length,
    skippedCount,
    skipReason:
      plotUpdates.length === 0 && eligible.length === 0
        ? 'All plots are manual overrides or plot overrides — nothing to recalculate.'
        : plotUpdates.length === 0 && eligible.length > 0
          ? 'All eligible plot forecasts are already up to date.'
          : null,
  };
}

export async function bulkClearManualOverrides(developmentId) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = getHouseTypePricing(developmentId);
  const eligible = plots.filter((plot) => plot.revenueSource === 'Manual Value');
  const plotUpdates = [];

  for (const plot of eligible) {
    const forecast = resolvePlotForecastPrice(
      { ...plot, revenueSource: DEFAULT_REVENUE_SOURCE, manualForecastValue: 0 },
      strategy,
      houseTypePricing,
      plots
    );
    plotUpdates.push({
      id: plot.id,
      ...plot,
      revenueSource: DEFAULT_REVENUE_SOURCE,
      manualForecastValue: 0,
      manualOverrideExplicit: false,
      forecastSellingPrice: forecast,
      pricingMigrated: true,
    });
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return {
    ok: true,
    updatedCount: plotUpdates.length,
    eligibleCount: eligible.length,
    skippedCount: plots.length - eligible.length,
    skipReason: plotUpdates.length === 0 ? 'No manual overrides to remove.' : null,
  };
}

export async function bulkResetPlotPremiums(developmentId) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = getHouseTypePricing(developmentId);
  const eligible = plots.filter((plot) => plot.plotPremium || plot.plotPremiumReason);
  const plotUpdates = [];

  for (const plot of eligible) {
    const cleared = { ...plot, plotPremium: 0, plotPremiumReason: '' };
    const forecast = resolvePlotForecastPrice(cleared, strategy, houseTypePricing, plots);
    plotUpdates.push({
      id: cleared.id,
      ...cleared,
      forecastSellingPrice: forecast,
      pricingMigrated: true,
    });
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return {
    ok: true,
    updatedCount: plotUpdates.length,
    eligibleCount: eligible.length,
    skippedCount: plots.length - eligible.length,
    skipReason: plotUpdates.length === 0 ? 'No plot premiums to clear.' : null,
  };
}

export function getPricedPlots(developmentId) {
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = getHouseTypePricing(developmentId);
  const mergedHouseTypes = buildHouseTypePricingMap(plots, houseTypePricing);
  return enrichPlotsWithPricing(plots, strategy, mergedHouseTypes);
}

export async function migrateLegacyPlotsIfNeeded(developmentId) {
  const plots = getPlots(developmentId);
  const pending = plots.filter(
    (plot) => !plot.pricingMigrated || isMisclassifiedManualPlot(plot)
  );
  if (!pending.length) return { migrated: 0 };

  const plotUpdates = [];
  for (const plot of pending) {
    const next = migrateSinglePlotPricing(plot);
    const changed =
      next.revenueSource !== plot.revenueSource ||
      next.pricingMigrated !== plot.pricingMigrated ||
      roundPlotMoney(next.manualForecastValue) !== roundPlotMoney(plot.manualForecastValue) ||
      Boolean(next.manualOverrideExplicit) !== Boolean(plot.manualOverrideExplicit);

    if (changed) {
      plotUpdates.push({ id: plot.id, ...next });
    }
  }

  if (plotUpdates.length) {
    await bulkUpdatePlots(developmentId, plotUpdates);
  }

  return { migrated: plotUpdates.length };
}

export async function getRevenuePricingContext(developmentId) {
  await migrateLegacyPlotsIfNeeded(developmentId);
  const plots = getPlots(developmentId);
  const strategy = getRevenueStrategy(developmentId);
  const houseTypePricing = getHouseTypePricing(developmentId);
  const mergedHouseTypes = buildHouseTypePricingMap(plots, houseTypePricing);
  const pricedPlots = enrichPlotsWithPricing(plots, strategy, mergedHouseTypes);

  return {
    plots,
    pricedPlots,
    strategy,
    houseTypePricing: mergedHouseTypes,
    strategyMetrics: buildStrategySummaryMetrics(pricedPlots, strategy, mergedHouseTypes),
  };
}
