import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const storage = vi.hoisted(() => new Map());
const revenueAuthority = vi.hoisted(() => ({ value: false }));
const settingsReadiness = vi.hoisted(() => ({ override: null }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../revenue/revenueAuthority', () => ({
  isRevenueServerAuthorityEnabled: () => revenueAuthority.value,
}));

vi.mock('../revenue/revenueSettingsServerCache', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRevenueSettingsReadiness: (developmentId) =>
      settingsReadiness.override || actual.getRevenueSettingsReadiness(developmentId),
  };
});

import {
  __resetDevelopmentsStoreForTests,
  __setDevelopmentsCacheForTests,
} from '../developments/developmentStore';
import { buildServerRevenueSettingsFixture } from '../test/mockRevenueSettingsApi';
import {
  __resetRevenueSettingsServerCacheForTests,
  replaceCachedRevenueSettings,
} from '../revenue/revenueSettingsServerCache';
import { CVR_HISTORIC_REVENUE_UNAVAILABLE } from './cvrHistoricConstants';
import {
  buildCvrCommercialPosition,
  calculateCvrGrossMarginPercent,
  calculateCvrGrossProfit,
  formatCvrGrossMarginPercent,
  previousRevenueForMovement,
} from './cvrCommercialPosition';

const DEV_ID = 'dev-cvr-032c';

function manualPlot(overrides = {}) {
  return {
    id: overrides.id || 'plot-1',
    plotNumber: overrides.plotNumber || '1',
    houseType: 'Arundel',
    niaFt2: 686,
    revenueCategory: 'Open Market',
    revenueSource: 'Manual Value',
    manualForecastValue: overrides.manualForecastValue ?? 1000000,
    forecastSellingPrice: overrides.forecastSellingPrice ?? 1000000,
    sellingPrice: overrides.sellingPrice ?? 0,
    revenueStatus: overrides.revenueStatus || 'Available',
    plotPremium: 0,
    ...overrides,
  };
}

function seedDevelopment(plots) {
  __setDevelopmentsCacheForTests([
    {
      id: DEV_ID,
      developmentName: 'Composer Fixture',
      jobNumber: 'CF-01',
      plotMaster: { plots },
    },
  ]);
}

describe('BL-032C commercial composer formulas', () => {
  it('calculates Gross Profit from Forecast Revenue minus CVR finalForecast', () => {
    expect(calculateCvrGrossProfit(1000000, 600000)).toBe(400000);
    expect(calculateCvrGrossProfit(100000, 150000)).toBe(-50000);
    expect(calculateCvrGrossProfit(null, 600000)).toBeNull();
    expect(calculateCvrGrossProfit(1000000, null)).toBeNull();
  });

  it('calculates Gross Margin to 1dp and withholds margin when revenue is 0', () => {
    expect(calculateCvrGrossMarginPercent(400000, 1000000)).toBe(40);
    expect(calculateCvrGrossMarginPercent(-50000, 100000)).toBe(-50);
    expect(calculateCvrGrossMarginPercent(-600000, 0)).toBeNull();
    expect(formatCvrGrossMarginPercent(40)).toBe('40.0%');
    expect(formatCvrGrossMarginPercent(-17.601)).toBe('-17.6%');
    expect(formatCvrGrossMarginPercent(null)).toBe('—');
  });

  it('never treats a v1 previous period as £0 revenue for movement', () => {
    expect(previousRevenueForMovement(null, 'forecastRevenue')).toBeNull();
    expect(
      previousRevenueForMovement(
        {
          revenueAvailable: false,
          forecastRevenue: null,
          hint: CVR_HISTORIC_REVENUE_UNAVAILABLE,
        },
        'forecastRevenue'
      )
    ).toBeNull();
    expect(
      previousRevenueForMovement(
        { revenueAvailable: false, forecastRevenue: 0 },
        'forecastRevenue'
      )
    ).toBeNull();
  });
});

describe('BL-032C live Revenue compose', () => {
  beforeEach(() => {
    storage.clear();
    revenueAuthority.value = false;
    settingsReadiness.override = null;
    __resetDevelopmentsStoreForTests();
    __resetRevenueSettingsServerCacheForTests();
  });

  it('composes Forecast / Secured / Remaining from the existing Revenue engine', () => {
    seedDevelopment([
      manualPlot({ id: 'plot-1', plotNumber: '1', revenueStatus: 'Available' }),
      manualPlot({
        id: 'plot-2',
        plotNumber: '2',
        revenueStatus: 'Exchanged',
        sellingPrice: 250000,
        forecastSellingPrice: 255100,
        manualForecastValue: 255100,
      }),
    ]);

    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });

    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(1250000);
    expect(position.securedRevenue).toBe(250000);
    expect(position.remainingForecast).toBe(1000000);
    expect(position.forecastCost).toBe(600000);
    expect(position.grossProfit).toBe(650000);
    expect(position.grossMarginPercent).toBe(52);
    expect(position.plotsSold).toBe(1);
  });

  it('shows genuine Secured Revenue £0 when no plots are exchanged or completed', () => {
    seedDevelopment([manualPlot({ revenueStatus: 'Available' })]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });
    expect(position.revenueAvailable).toBe(true);
    expect(position.securedRevenue).toBe(0);
    expect(position.forecastRevenue).toBe(1000000);
    expect(position.plotsSold).toBe(0);
  });

  it('allows negative Gross Profit and Gross Margin', () => {
    seedDevelopment([manualPlot({ manualForecastValue: 100000, forecastSellingPrice: 100000 })]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 150000 },
    });
    expect(position.grossProfit).toBe(-50000);
    expect(position.grossMarginPercent).toBe(-50);
    expect(formatCvrGrossMarginPercent(position.grossMarginPercent)).toBe('-50.0%');
  });

  it('makes margin unavailable when Forecast Revenue is 0', () => {
    seedDevelopment([]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });
    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(0);
    expect(position.grossProfit).toBe(-600000);
    expect(position.grossMarginPercent).toBeNull();
    expect(position.grossMarginAvailable).toBe(false);
  });

  it('keeps cost ready while Revenue stays unavailable if Plot Master is not loaded', () => {
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });
    expect(position.costAvailable).toBe(true);
    expect(position.forecastCost).toBe(600000);
    expect(position.revenueAvailable).toBe(false);
    expect(position.forecastRevenue).toBeNull();
    expect(position.securedRevenue).toBeNull();
    expect(position.grossProfit).toBeNull();
    expect(position.grossMarginPercent).toBeNull();
    expect(position.hint).toBe('Loading revenue…');
  });

  it('does not invent £0 Revenue when authority ON settings are unresolved', () => {
    revenueAuthority.value = true;
    seedDevelopment([manualPlot()]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });
    expect(position.revenueAvailable).toBe(false);
    expect(position.forecastRevenue).toBeNull();
    expect(position.securedRevenue).toBeNull();
    expect(position.grossProfit).toBeNull();
    expect(position.hint).toBe('Loading revenue…');
  });

  it('does not invent £0 Revenue when authority ON settings are in error', () => {
    revenueAuthority.value = true;
    seedDevelopment([manualPlot()]);
    settingsReadiness.override = {
      ready: false,
      loadState: 'error',
      reason: 'error',
      error: new Error('Unable to load revenue settings'),
    };
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 600000 },
    });
    expect(position.revenueAvailable).toBe(false);
    expect(position.forecastRevenue).toBeNull();
    expect(position.securedRevenue).toBeNull();
    expect(position.grossProfit).toBeNull();
    expect(position.hint).toBe('Revenue unavailable');
  });

  it('uses server settings when authority ON cache is ready', () => {
    revenueAuthority.value = true;
    seedDevelopment([manualPlot()]);
    replaceCachedRevenueSettings(
      DEV_ID,
      buildServerRevenueSettingsFixture({
        id: 'settings-1',
        developmentId: DEV_ID,
        exists: true,
        version: 2,
      })
    );
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 400000 },
    });
    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(1000000);
    expect(position.grossProfit).toBe(600000);
  });

  it('uses local Revenue infrastructure when authority is OFF', () => {
    revenueAuthority.value = false;
    seedDevelopment([manualPlot()]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      costSummary: { finalForecast: 250000 },
    });
    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(1000000);
    expect(position.grossProfit).toBe(750000);
  });

  it('never consumes live Revenue for locked v1 historic periods', () => {
    seedDevelopment([manualPlot({ manualForecastValue: 999999, forecastSellingPrice: 999999 })]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      historic: true,
      costSummary: { finalForecast: 2365423 },
    });
    expect(position.historicRevenueUnavailable).toBe(true);
    expect(position.revenueAvailable).toBe(false);
    expect(position.forecastRevenue).toBeNull();
    expect(position.grossProfit).toBeNull();
    expect(position.hint).toBe(CVR_HISTORIC_REVENUE_UNAVAILABLE);
    expect(position.forecastCost).toBe(2365423);
  });

  it('uses frozen schema-v2 snapshot Revenue and does not consume live Plot Master', () => {
    seedDevelopment([manualPlot({ manualForecastValue: 999999, forecastSellingPrice: 999999 })]);
    const snapshot = {
      schemaVersion: 2,
      totals: {
        forecastRevenue: 10444608,
        securedRevenue: 0,
        remainingForecast: 10444608,
        plotsSold: 0,
        plotsRemaining: 31,
        grossProfit: 8079185,
        grossMarginPercent: 77.3512,
      },
    };
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      historic: true,
      costSummary: { finalForecast: 2365423 },
      snapshot,
    });
    expect(position.historicRevenueUnavailable).toBe(false);
    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(10444608);
    expect(position.securedRevenue).toBe(0);
    expect(position.remainingForecast).toBe(10444608);
    expect(position.grossProfit).toBe(8079185);
    expect(position.grossMarginPercent).toBe(77.3512);
    expect(position.forecastCost).toBe(2365423);
  });

  it('keeps frozen v2 Revenue when live Plot Master later changes', () => {
    seedDevelopment([manualPlot({ manualForecastValue: 255100, forecastSellingPrice: 255100 })]);
    const snapshot = {
      schemaVersion: 2,
      totals: {
        forecastRevenue: 10444608,
        securedRevenue: 0,
        remainingForecastRevenue: 10444608,
        plotsSold: 0,
        plotsRemaining: 31,
        grossProfit: 8079185,
        grossMarginPercent: 77.3512,
      },
    };
    seedDevelopment([manualPlot({ manualForecastValue: 1, forecastSellingPrice: 1 })]);
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      historic: true,
      costSummary: { finalForecast: 2365423 },
      snapshot,
    });
    expect(position.forecastRevenue).toBe(10444608);
    expect(position.grossProfit).toBe(8079185);
  });

  it('stores genuine v2 Forecast Revenue £0 and withholds Gross Margin', () => {
    const snapshot = {
      schemaVersion: 2,
      totals: {
        forecastRevenue: 0,
        securedRevenue: 0,
        remainingForecast: 0,
        plotsSold: 0,
        plotsRemaining: 0,
        grossProfit: -2365423,
        grossMarginPercent: null,
      },
    };
    const position = buildCvrCommercialPosition({
      developmentId: DEV_ID,
      historic: true,
      costSummary: { finalForecast: 2365423 },
      snapshot,
    });
    expect(position.revenueAvailable).toBe(true);
    expect(position.forecastRevenue).toBe(0);
    expect(position.grossProfit).toBe(-2365423);
    expect(position.grossMarginPercent).toBeNull();
    expect(position.grossMarginAvailable).toBe(false);
  });

  it('supports later v2 previous Revenue movement without treating v1 as £0', () => {
    expect(
      previousRevenueForMovement(
        {
          revenueAvailable: true,
          forecastRevenue: 10444608,
        },
        'forecastRevenue'
      )
    ).toBe(10444608);
    expect(
      previousRevenueForMovement(
        {
          revenueAvailable: false,
          forecastRevenue: null,
          hint: CVR_HISTORIC_REVENUE_UNAVAILABLE,
        },
        'forecastRevenue'
      )
    ).toBeNull();
  });
});

describe('BL-032C cost engine and snapshot isolation', () => {
  it('does not duplicate Revenue formulas into the cost engine or snapshot mapper', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const engine = readFileSync(join(dir, 'cvrEngine.js'), 'utf8');
    const mapper = readFileSync(join(dir, 'cvrSnapshotMapper.js'), 'utf8');
    const closeConstants = readFileSync(
      join(dir, '../../../server/services/cvrCloseConstants.js'),
      'utf8'
    );
    expect(engine).not.toMatch(/buildRevenueSummary|getPricedPlots|getRevenuePricingContext/);
    expect(mapper).not.toMatch(/getPricedPlots|getRevenuePricingContext|getPlots\(/);
    expect(closeConstants).toContain('CVR_SNAPSHOT_SCHEMA_VERSION = 1');
    expect(closeConstants).toContain('CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION = 2');
    expect(closeConstants).not.toMatch(/CLOSE_SOURCE_KEYS[\s\S]*['"]revenue['"]/);
  });
});
