import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/developments', () => import('../test/mockDevelopmentApi'));

import { resetDevelopmentApiStore } from '../test/mockDevelopmentApi';
import {
  __resetDevelopmentsStoreForTests,
  createDevelopment,
  getDevelopment,
  updateDevelopment,
} from './developmentStore';
import { bulkUpdatePlots, replacePlotMaster, updatePlot } from './plotMaster';
import { buildExistingPlotUpdatePreview, validateAndBuildPlotImport } from './plotScheduleImport';

function commercialPlot() {
  return {
    id: 'stable-plot-1',
    plotNumber: '1',
    houseType: 'Wrong Type',
    gia: 999,
    tenure: 'Open Market',
    tenureCode: 'OPEN_MARKET',
    sellingPrice: 325000,
    forecastSellingPrice: 300000,
    revenueStatus: 'Exchanged',
    revenueSource: 'Manual Value',
    manualForecastValue: 300000,
    plotOverrideValue: 123,
    plotPremium: 5000,
    plotPremiumReason: 'Corner plot',
    reservedAt: '2026-01-01',
    exchangedAt: '2026-02-01',
    status: 'Active',
  };
}

describe('Plot Master governed update persistence', () => {
  beforeEach(() => {
    storage.clear();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
  });

  it('atomically updates structural fields while preserving identity, Revenue and lifecycle evidence', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-1',
      developmentName: 'Safe Update',
      plotMaster: { plots: [commercialPlot()], updatedAt: '2026-01-01T00:00:00.000Z' },
    });
    const result = await bulkUpdatePlots(development.id, [{
      id: 'stable-plot-1', houseType: 'Correct Type', gia: 1172,
    }], { expectedVersion: development.version });
    expect(result.ok).toBe(true);
    expect(getDevelopment(development.id).plotMaster.plots[0]).toMatchObject({
      id: 'stable-plot-1', houseType: 'Correct Type', gia: 1172,
      sellingPrice: 325000, forecastSellingPrice: 300000,
      revenueStatus: 'Exchanged', revenueSource: 'Manual Value',
      manualForecastValue: 300000, plotOverrideValue: 123,
      plotPremium: 5000, reservedAt: '2026-01-01', exchangedAt: '2026-02-01',
      tenureCode: 'OPEN_MARKET',
    });
    expect(getDevelopment(development.id).plotMaster.plots[0]).not.toHaveProperty('niaFt2');
    expect(getDevelopment(development.id).plotMaster.plots[0]).not.toHaveProperty('niaM2');
  });

  it('prevents full replacement of a populated Plot Master', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-2', developmentName: 'No Replacement',
      plotMaster: { plots: [commercialPlot()] },
    });
    const before = getDevelopment(development.id);
    const result = await replacePlotMaster(development.id, [{ plotNumber: '1', houseType: 'Replacement' }]);
    expect(result).toMatchObject({ ok: false, code: 'PLOT_MASTER_NOT_EMPTY' });
    expect(getDevelopment(development.id)).toEqual(before);
  });

  it('rejects an unknown reviewed identity before persisting any plot update', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-2B', developmentName: 'Atomic Guard',
      plotMaster: { plots: [commercialPlot()] },
    });
    const result = await bulkUpdatePlots(development.id, [
      { id: 'stable-plot-1', gia: 1172 },
      { id: 'missing-plot', gia: 900 },
    ], { expectedVersion: development.version });
    expect(result.ok).toBe(false);
    expect(getDevelopment(development.id).plotMaster.plots[0].gia).toBe(999);
  });

  it('retains initial import and individual edit behaviour', async () => {
    const development = await createDevelopment({ jobNumber: 'SAFE-3', developmentName: 'Initial Import' });
    expect((await replacePlotMaster(development.id, [{ plotNumber: '1', houseType: 'Ash', gia: 850 }])).ok).toBe(true);
    const plot = getDevelopment(development.id).plotMaster.plots[0];
    expect((await updatePlot(development.id, plot.id, { ...plot, houseType: 'Oak' })).ok).toBe(true);
    expect(getDevelopment(development.id).plotMaster.plots[0]).toMatchObject({ id: plot.id, houseType: 'Oak' });
  });

  it('fails a stale whole-document update without partial plot changes', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-4', developmentName: 'Version Guard',
      plotMaster: { plots: [commercialPlot()] },
    });
    await updateDevelopment(development.id, { location: 'Concurrent change', version: development.version });
    // Simulate a stale caller by restoring the old cached version while the server remains newer.
    __resetDevelopmentsStoreForTests();
    const stale = { ...development, plotMaster: { plots: [commercialPlot()] } };
    const { __setDevelopmentsCacheForTests } = await import('./developmentStore');
    __setDevelopmentsCacheForTests([stale]);
    const result = await bulkUpdatePlots(
      development.id,
      [{ id: 'stable-plot-1', gia: 1172 }],
      { expectedVersion: development.version }
    );
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
  });

  it('uses the version captured at preview rather than a refreshed client cache', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-5', developmentName: 'Reviewed Version',
      plotMaster: { plots: [commercialPlot()] },
    });
    await updateDevelopment(development.id, { location: 'Concurrent change', version: development.version });
    const result = await bulkUpdatePlots(
      development.id,
      [{ id: 'stable-plot-1', gia: 1172 }],
      { expectedVersion: development.version }
    );
    expect(result).toMatchObject({ ok: false, code: 'VERSION_CONFLICT' });
    expect(getDevelopment(development.id).plotMaster.plots[0].gia).toBe(999);
  });

  it('fails closed when a reviewed bulk update has no Development version', async () => {
    const development = await createDevelopment({
      jobNumber: 'SAFE-NO-VERSION', developmentName: 'Missing Preview Version',
      plotMaster: { plots: [commercialPlot()] },
    });
    const result = await bulkUpdatePlots(
      development.id,
      [{ id: 'stable-plot-1', gia: 1172 }],
      { requireExpectedVersion: true }
    );
    expect(result).toMatchObject({ ok: false, code: 'MISSING_PREVIEW_VERSION' });
    expect(getDevelopment(development.id).plotMaster.plots[0].gia).toBe(999);
  });

  it('runs a realistic 75-plot preview through atomic persistence with stable identities', async () => {
    const existingPlots = Array.from({ length: 75 }, (_, index) => ({
      ...commercialPlot(),
      id: `stable-plot-${index + 1}`,
      plotNumber: String(index + 1),
      houseType: `Type ${index % 5}`,
      gia: 850 + index,
      niaFt2: index === 0 ? 800 : null,
    }));
    const development = await createDevelopment({
      jobNumber: 'SAFE-75', developmentName: 'Wizard Pipeline',
      plotMaster: { plots: existingPlots },
    });
    const rows = [
      ['Plot', 'House Type', 'Ft2'],
      ...existingPlots.map((plot, index) => [
        plot.plotNumber,
        index === 0 ? 'Correct Type' : plot.houseType,
        index === 0 ? 1172 : plot.gia,
      ]),
    ];
    const parsed = validateAndBuildPlotImport(rows, 0, ['plotNumber', 'houseType', 'gia']);
    const preview = buildExistingPlotUpdatePreview({
      existingPlots,
      importedPlots: parsed.plots,
      mappedFields: ['plotNumber', 'houseType', 'gia'],
      rowErrors: parsed.rowErrors,
    });
    expect(preview).toMatchObject({
      ready: true, existingCount: 75, importedCount: 75, matchedCount: 75, changedCount: 1,
    });
    expect(preview.updates[0]).toEqual({
      id: 'stable-plot-1', houseType: 'Correct Type', gia: 1172,
    });

    const saved = await bulkUpdatePlots(development.id, preview.updates, {
      expectedVersion: development.version,
    });
    expect(saved.ok).toBe(true);
    const persisted = getDevelopment(development.id).plotMaster.plots;
    expect(persisted).toHaveLength(75);
    expect(persisted[0]).toMatchObject({
      id: 'stable-plot-1', houseType: 'Correct Type', gia: 1172, niaFt2: 800,
      sellingPrice: 325000, manualForecastValue: 300000, revenueStatus: 'Exchanged',
    });
    expect(persisted.map(({ id }) => id)).toEqual(existingPlots.map(({ id }) => id));
  });
});
