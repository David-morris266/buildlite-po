/**
 * BL-009A.02 / BL-027A.2 — Plot Master persistence inside server-backed Development records.
 */

import {
  getDevelopment,
  updateDevelopment,
  VERSION_CONFLICT_MESSAGE,
} from './developmentStore';
import { normalizePlotCommercialFields } from './plotCommercial';

export const PLOT_DEFAULT_STATUS = 'Active';

export const PLOT_CONFIGURATION_SUGGESTIONS = [
  'Detached',
  'Semi Detached',
  'Mid Terrace',
  'End Terrace',
  'Apartment',
  'Maisonette',
  'Bungalow',
  'Three Storey',
  'FOG',
];

export function normalizePlotMaster(development) {
  if (!development) return null;
  if (development.plotMaster?.plots) return development;

  return {
    ...development,
    plotMaster: {
      plots: [],
      updatedAt: development.updatedAt || new Date().toISOString(),
    },
  };
}

export function getPlots(developmentId) {
  const development = normalizePlotMaster(getDevelopment(developmentId));
  return development?.plotMaster?.plots || [];
}

export function getPlotCount(development) {
  const normalized = normalizePlotMaster(development);
  return normalized?.plotMaster?.plots?.length ?? 0;
}

function newPlotId() {
  return `plot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePlotInput(input, existing = null) {
  const plotNumber = String(input.plotNumber || '').trim();
  const houseType = String(input.houseType || '').trim();
  const bedroomsRaw = input.bedrooms;
  const giaRaw = input.gia;
  const commercial = normalizePlotCommercialFields(input, existing);

  return {
    id: existing?.id || newPlotId(),
    plotNumber,
    houseType,
    configuration: String(input.configuration || '').trim(),
    bedrooms:
      bedroomsRaw === '' || bedroomsRaw == null
        ? null
        : Number.parseInt(String(bedroomsRaw), 10),
    gia:
      giaRaw === '' || giaRaw == null
        ? null
        : Number.parseFloat(String(giaRaw)),
    niaFt2: commercial.niaFt2,
    niaM2: commercial.niaM2,
    phase: String(input.phase || '').trim(),
    tenure: String(input.tenure || '').trim(),
    status: String(input.status || existing?.status || PLOT_DEFAULT_STATUS).trim(),
    sellingPrice: commercial.sellingPrice,
    forecastSellingPrice: commercial.forecastSellingPrice,
    revenueCategory: commercial.revenueCategory,
    revenueStatus: commercial.revenueStatus,
    revenueSource: commercial.revenueSource,
    garage: commercial.garage,
    garageOverride: commercial.garageOverride,
    plotPremium: commercial.plotPremium,
    plotPremiumReason: commercial.plotPremiumReason,
    manualForecastValue: commercial.manualForecastValue,
    plotOverrideValue: commercial.plotOverrideValue,
    manualOverrideExplicit: commercial.manualOverrideExplicit,
    pricingMigrated: commercial.pricingMigrated,
    reservedAt: commercial.reservedAt,
    exchangedAt: commercial.exchangedAt,
    completedAt: commercial.completedAt,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function validatePlot(plot, plots, excludeId = null) {
  const errors = [];

  if (!plot.plotNumber) {
    errors.push('Plot Number is required.');
  }
  if (!plot.houseType) {
    errors.push('House Type is required.');
  }

  const duplicate = plots.find(
    (row) =>
      row.id !== excludeId &&
      String(row.plotNumber).toLowerCase() === plot.plotNumber.toLowerCase()
  );
  if (duplicate) {
    errors.push(`Plot Number "${plot.plotNumber}" already exists.`);
  }

  if (plot.bedrooms != null && Number.isNaN(plot.bedrooms)) {
    errors.push('Bedrooms must be a whole number.');
  }
  if (plot.gia != null && Number.isNaN(plot.gia)) {
    errors.push('Gross Internal Area must be a number.');
  }
  if (plot.sellingPrice != null && Number.isNaN(Number(plot.sellingPrice))) {
    errors.push('Selling Price must be a number.');
  }
  if (plot.forecastSellingPrice != null && Number.isNaN(Number(plot.forecastSellingPrice))) {
    errors.push('Forecast Selling Price must be a number.');
  }
  if (
    (plot.revenueStatus === 'Exchanged' || plot.revenueStatus === 'Completed') &&
    !(Number(plot.sellingPrice) > 0)
  ) {
    errors.push('Exchanged and Completed plots require a selling price greater than 0.');
  }

  return errors;
}

async function persistPlots(developmentId, plots) {
  const now = new Date().toISOString();
  const existing = getDevelopment(developmentId);
  if (!existing) {
    return { ok: false, errors: ['Development not found.'] };
  }

  try {
    const saved = await updateDevelopment(developmentId, {
      plotMaster: {
        plots,
        updatedAt: now,
      },
      plotCount: plots.length,
      version: existing.version,
    });
    return { ok: true, development: saved };
  } catch (error) {
    if (error.code === 'VERSION_CONFLICT') {
      return {
        ok: false,
        errors: [VERSION_CONFLICT_MESSAGE],
        code: 'VERSION_CONFLICT',
      };
    }
    return {
      ok: false,
      errors: [error.message || 'Could not save plot changes.'],
    };
  }
}

export async function addPlot(developmentId, input) {
  const development = normalizePlotMaster(getDevelopment(developmentId));
  if (!development) return { ok: false, errors: ['Development not found.'] };

  const plots = [...(development.plotMaster?.plots || [])];
  const plot = normalizePlotInput(input);
  const errors = validatePlot(plot, plots);
  if (errors.length) return { ok: false, errors };

  plots.push(plot);
  const saved = await persistPlots(developmentId, plots);
  return saved.ok ? { ok: true, plot, development: saved.development } : saved;
}

export async function updatePlot(developmentId, plotId, input) {
  const development = normalizePlotMaster(getDevelopment(developmentId));
  if (!development) return { ok: false, errors: ['Development not found.'] };

  const plots = [...(development.plotMaster?.plots || [])];
  const index = plots.findIndex((row) => row.id === plotId);
  if (index < 0) return { ok: false, errors: ['Plot not found.'] };

  const plot = normalizePlotInput(input, plots[index]);
  const errors = validatePlot(plot, plots, plotId);
  if (errors.length) return { ok: false, errors };

  plots[index] = plot;
  const saved = await persistPlots(developmentId, plots);
  return saved.ok ? { ok: true, plot, development: saved.development } : saved;
}

export async function deletePlot(developmentId, plotId) {
  const development = normalizePlotMaster(getDevelopment(developmentId));
  if (!development) return { ok: false, errors: ['Development not found.'] };

  const plots = (development.plotMaster?.plots || []).filter(
    (row) => row.id !== plotId
  );
  return persistPlots(developmentId, plots);
}

export async function replacePlotMaster(developmentId, plots) {
  const normalized = plots.map((plot) =>
    normalizePlotInput({
      ...plot,
      plotNumber: plot.plotNumber,
      houseType: plot.houseType,
      configuration: plot.configuration,
      bedrooms: plot.bedrooms,
      gia: plot.gia,
      niaFt2: plot.niaFt2,
      niaM2: plot.niaM2,
      phase: plot.phase,
      tenure: plot.tenure,
      status: plot.status,
      sellingPrice: plot.sellingPrice,
      forecastSellingPrice: plot.forecastSellingPrice,
      revenueCategory: plot.revenueCategory,
      revenueStatus: plot.revenueStatus,
      revenueSource: plot.revenueSource,
      garage: plot.garage,
      garageOverride: plot.garageOverride,
      plotPremium: plot.plotPremium,
      plotPremiumReason: plot.plotPremiumReason,
      manualForecastValue: plot.manualForecastValue,
      plotOverrideValue: plot.plotOverrideValue,
      manualOverrideExplicit: plot.manualOverrideExplicit,
      pricingMigrated: plot.pricingMigrated,
      reservedAt: plot.reservedAt,
      exchangedAt: plot.exchangedAt,
      completedAt: plot.completedAt,
    })
  );

  const saved = await persistPlots(developmentId, normalized);
  return saved.ok
    ? { ok: true, development: saved.development, plots: normalized }
    : saved;
}

export async function bulkUpdatePlots(developmentId, plotUpdates = []) {
  const development = normalizePlotMaster(getDevelopment(developmentId));
  if (!development) return { ok: false, errors: ['Development not found.'] };

  const plots = [...(development.plotMaster?.plots || [])];
  const byId = new Map(plots.map((plot) => [plot.id, plot]));

  for (const patch of plotUpdates) {
    const existing = byId.get(patch.id);
    if (!existing) continue;
    const next = normalizePlotInput({ ...existing, ...patch }, existing);
    byId.set(patch.id, next);
  }

  const saved = await persistPlots(developmentId, [...byId.values()]);
  return saved.ok
    ? { ok: true, development: saved.development, plots: [...byId.values()] }
    : saved;
}

export function formatPlotGia(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function formatPlotBedrooms(value) {
  if (value == null || value === '') return '—';
  return String(value);
}
