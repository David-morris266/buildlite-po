/**
 * BL-019B/C — Plot commercial field helpers. Plot Master is the source of truth.
 */

import { getDefaultRevenueCategory, normalizeRevenueCategory } from '../admin/revenueCategoryStore';
import {
  DEFAULT_REVENUE_SOURCE,
  GARAGE_TYPES,
  REVENUE_SOURCES,
} from '../revenue/revenueTypes';

export const REVENUE_STATUSES = [
  'Available',
  'Reserved',
  'Exchanged',
  'Completed',
  'Cancelled',
];

export const REVENUE_STATUS_TONES = {
  Available: 'muted',
  Reserved: 'warning',
  Exchanged: 'accent',
  Completed: 'success',
  Cancelled: 'alert',
};

const FT2_TO_M2 = 0.092903;

export function roundPlotMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100) / 100;
}

export function getPlotNiaFt2(plot = {}) {
  const explicit = Number(plot.niaFt2);
  if (Number.isFinite(explicit) && explicit > 0) return roundPlotMoney(explicit);
  const gia = Number(plot.gia);
  if (Number.isFinite(gia) && gia > 0) return roundPlotMoney(gia);
  return 0;
}

export function getPlotNiaM2(plot = {}) {
  const explicit = Number(plot.niaM2);
  if (Number.isFinite(explicit) && explicit > 0) return roundPlotMoney(explicit);
  const niaFt2 = getPlotNiaFt2(plot);
  return niaFt2 > 0 ? roundPlotMoney(niaFt2 * FT2_TO_M2) : 0;
}

export function getPlotEffectivePrice(plot = {}) {
  const forecast = roundPlotMoney(plot.forecastSellingPrice || 0);
  const selling = roundPlotMoney(plot.sellingPrice || 0);
  if (forecast > 0) return forecast;
  return selling;
}

export function getPlotPerFt2(plot = {}) {
  const price = getPlotEffectivePrice(plot);
  const niaFt2 = getPlotNiaFt2(plot);
  if (!price || !niaFt2) return 0;
  return roundPlotMoney(price / niaFt2);
}

export function getPlotPerM2(plot = {}) {
  const price = getPlotEffectivePrice(plot);
  const niaM2 = getPlotNiaM2(plot);
  if (!price || !niaM2) return 0;
  return roundPlotMoney(price / niaM2);
}

export function normalizePlotRevenueStatus(status) {
  const value = String(status || '').trim();
  return REVENUE_STATUSES.includes(value) ? value : 'Available';
}

export function normalizePlotRevenueSource(source) {
  const value = String(source || '').trim();
  return REVENUE_SOURCES.includes(value) ? value : DEFAULT_REVENUE_SOURCE;
}

export function normalizePlotGarage(garage) {
  const value = String(garage || '').trim();
  return GARAGE_TYPES.includes(value) ? value : 'None';
}

export function normalizePlotCommercialFields(plot = {}, existing = null) {
  const merged = { ...existing, ...plot };
  const niaFt2 = getPlotNiaFt2(merged);
  const niaM2 = getPlotNiaM2({ ...merged, niaFt2 });

  return {
    sellingPrice: roundPlotMoney(merged.sellingPrice || 0),
    forecastSellingPrice: roundPlotMoney(merged.forecastSellingPrice || 0),
    revenueCategory: normalizeRevenueCategory(
      merged.revenueCategory || existing?.revenueCategory || getDefaultRevenueCategory()
    ),
    revenueStatus: normalizePlotRevenueStatus(
      merged.revenueStatus || existing?.revenueStatus || 'Available'
    ),
    revenueSource: normalizePlotRevenueSource(
      merged.revenueSource || existing?.revenueSource || DEFAULT_REVENUE_SOURCE
    ),
    garage: normalizePlotGarage(merged.garage || existing?.garage),
    garageOverride: Boolean(merged.garageOverride ?? existing?.garageOverride ?? false),
    plotPremium: roundPlotMoney(merged.plotPremium || 0),
    plotPremiumReason: String(merged.plotPremiumReason || '').trim(),
    manualForecastValue: roundPlotMoney(merged.manualForecastValue || 0),
    plotOverrideValue: roundPlotMoney(merged.plotOverrideValue || 0),
    manualOverrideExplicit: Boolean(
      merged.manualOverrideExplicit ?? existing?.manualOverrideExplicit ?? false
    ),
    pricingMigrated:
      merged.pricingMigrated != null
        ? Boolean(merged.pricingMigrated)
        : existing
          ? Boolean(existing.pricingMigrated)
          : true,
    niaFt2,
    niaM2,
  };
}

export function plotsToCommercialModels(plots = []) {
  return plots.map((plot) => ({
    ...plot,
    ...normalizePlotCommercialFields(plot),
    effectivePrice: getPlotEffectivePrice(plot),
    perFt2: getPlotPerFt2(plot),
    perM2: getPlotPerM2(plot),
  }));
}

export function classifyRevenueBucket(category = '') {
  const value = String(category || '').trim().toLowerCase();
  if (value === 'open market') return 'openMarket';
  if (
    value.includes('affordable') ||
    value.includes('shared ownership') ||
    value.includes('first homes') ||
    value.includes('social rent')
  ) {
    return 'affordable';
  }
  return 'other';
}
