import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./revenueAuthority', () => ({
  isRevenueServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/revenueSettings', () => import('../test/mockRevenueSettingsApi'));
vi.mock('../api/developments', () => import('../test/mockDevelopmentApi'));

import {
  buildServerRevenueSettingsFixture,
  getRevenueSettingsCallCounts,
  resetRevenueSettingsApiStore,
  seedMockRevenueSettings,
  setRevenueSettingsGetReject,
  setRevenueSettingsPutReject,
} from '../test/mockRevenueSettingsApi';
import { createDevelopment, __resetDevelopmentsStoreForTests } from '../developments/developmentStore';
import { addPlot } from '../developments/plotMaster';
import { resetDevelopmentApiStore } from '../test/mockDevelopmentApi';
import { calculateRecognisedRevenue } from './revenueCalculations';
import { __resetRevenueSettingsServerCacheForTests, ensureRevenueSettingsReady } from './revenueSettingsServerCache';
import {
  getRevenuePricingContext,
  getRevenueStrategy,
  saveRevenueStrategy,
} from './revenueStrategy';
import { getRevenueRecord, REVENUE_STORAGE_KEY, saveRevenueRecord } from './revenueStore';

const STORAGE_KEY = REVENUE_STORAGE_KEY;

describe('BL-032A revenue authority', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetRevenueSettingsServerCacheForTests();
    resetRevenueSettingsApiStore();
    resetDevelopmentApiStore();
    __resetDevelopmentsStoreForTests();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('AUTHORITY OFF keeps localStorage behaviour and does not fetch', () => {
    const result = saveRevenueRecord('dev-local', {
      revenueStrategy: { openMarket: { ratePerFt2: 360, effectiveDate: '2026-01-01' } },
    });
    expect(result.ok).toBe(true);
    expect(getRevenueStrategy('dev-local').openMarket.ratePerFt2).toBe(360);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))['dev-local']).toBeTruthy();
    expect(getRevenueSettingsCallCounts().total).toBe(0);
  });

  it('AUTHORITY ON unresolved is not empty/default settings', () => {
    authorityEnabled.value = true;
    expect(() => getRevenueRecord('dev-unresolved')).toThrow(/have not loaded yet/);
    expect(() => getRevenueStrategy('dev-unresolved')).toThrow(/have not loaded yet/);
    expect(getRevenueSettingsCallCounts().get).toBe(0);
  });

  it('AUTHORITY ON loads and maps server settings faithfully', async () => {
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      'dev-on',
      buildServerRevenueSettingsFixture({
        id: 'set-on',
        developmentId: 'dev-on',
        exists: true,
        version: 1,
        recognitionPolicy: 'completion',
        revenueStrategy: {
          openMarket: { ratePerFt2: 375, effectiveDate: '2026-04-01' },
          affordableHousing: {
            affordableRent: 60,
            sharedOwnership: 72,
            firstHomes: 70,
            additionality: 65,
            discountMarketSale: 70,
            other: 100,
          },
          garagePremiums: { none: 0, single: 13000, double: 22000 },
        },
        houseTypePricing: {
          Ash: { garage: 'Single', sellingBasis: 'Auto', manualForecastValue: 0, representativeNiaFt2: 950 },
        },
      })
    );

    await ensureRevenueSettingsReady('dev-on');
    const record = getRevenueRecord('dev-on');
    expect(record.revenueStrategy.openMarket.ratePerFt2).toBe(375);
    expect(record.revenueStrategy.garagePremiums.single).toBe(13000);
    expect(record.houseTypePricing.Ash.representativeNiaFt2).toBe(950);
    expect(record.recognitionPolicy).toBe('completion');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('AUTHORITY ON saves through the server and hard-rehydrates the cache', async () => {
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      'dev-save',
      buildServerRevenueSettingsFixture({
        id: 'set-save',
        developmentId: 'dev-save',
        exists: true,
        version: 1,
      })
    );
    await ensureRevenueSettingsReady('dev-save');

    const saved = await saveRevenueStrategy('dev-save', {
      openMarket: { ratePerFt2: 410, effectiveDate: '2026-08-01' },
    });
    expect(saved.ok).toBe(true);
    expect(saved.record.version).toBe(2);
    expect(getRevenueStrategy('dev-save').openMarket.ratePerFt2).toBe(410);
    expect(getRevenueSettingsCallCounts().put).toBe(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('AUTHORITY ON stale mutation is visible and does not write localStorage', async () => {
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      'dev-stale',
      buildServerRevenueSettingsFixture({
        id: 'set-stale',
        developmentId: 'dev-stale',
        exists: true,
        version: 2,
      })
    );
    await ensureRevenueSettingsReady('dev-stale');
    seedMockRevenueSettings(
      'dev-stale',
      buildServerRevenueSettingsFixture({
        id: 'set-stale',
        developmentId: 'dev-stale',
        exists: true,
        version: 3,
      })
    );

    const result = await saveRevenueStrategy('dev-stale', {
      openMarket: { ratePerFt2: 399, effectiveDate: '' },
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.errors[0]).toMatch(/changed elsewhere|version conflict/i);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('AUTHORITY ON failed load has no localStorage fallback', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        'dev-err': {
          revenueStrategy: { openMarket: { ratePerFt2: 999, effectiveDate: '' } },
        },
      })
    );
    authorityEnabled.value = true;
    setRevenueSettingsGetReject();

    await expect(ensureRevenueSettingsReady('dev-err')).rejects.toThrow();
    expect(() => getRevenueStrategy('dev-err')).toThrow();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))['dev-err'].revenueStrategy.openMarket.ratePerFt2).toBe(999);
  });

  it('AUTHORITY ON failed mutation does not fall back to localStorage', async () => {
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      'dev-put-err',
      buildServerRevenueSettingsFixture({
        id: 'set-put-err',
        developmentId: 'dev-put-err',
        exists: true,
        version: 1,
      })
    );
    await ensureRevenueSettingsReady('dev-put-err');
    setRevenueSettingsPutReject();

    const result = await saveRevenueStrategy('dev-put-err', {
      openMarket: { ratePerFt2: 401, effectiveDate: '' },
    });
    expect(result.ok).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('AUTHORITY ON isolates developments A and B', async () => {
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      'dev-a',
      buildServerRevenueSettingsFixture({
        id: 'a',
        developmentId: 'dev-a',
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 111, effectiveDate: '' } },
      })
    );
    seedMockRevenueSettings(
      'dev-b',
      buildServerRevenueSettingsFixture({
        id: 'b',
        developmentId: 'dev-b',
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 222, effectiveDate: '' } },
      })
    );
    await ensureRevenueSettingsReady('dev-a');
    await ensureRevenueSettingsReady('dev-b');
    expect(getRevenueStrategy('dev-a').openMarket.ratePerFt2).toBe(111);
    expect(getRevenueStrategy('dev-b').openMarket.ratePerFt2).toBe(222);
  });

  it('keeps existing plot pricing calculations under authority ON', async () => {
    const development = await createDevelopment({
      jobNumber: 'REV-CALC',
      developmentName: 'Revenue calc',
    });
    authorityEnabled.value = true;
    seedMockRevenueSettings(
      development.id,
      buildServerRevenueSettingsFixture({
        id: 'set-calc',
        developmentId: development.id,
        exists: true,
        version: 1,
        revenueStrategy: {
          openMarket: { ratePerFt2: 350, effectiveDate: '' },
          affordableHousing: {
            affordableRent: 58,
            sharedOwnership: 72,
            firstHomes: 70,
            additionality: 65,
            discountMarketSale: 70,
            other: 100,
          },
          garagePremiums: { none: 0, single: 12500, double: 22500 },
        },
      })
    );

    await addPlot(development.id, {
      plotNumber: '10',
      houseType: 'Ash',
      niaFt2: 950,
      revenueCategory: 'Open Market',
      revenueSource: 'House Type',
    });

    const context = await getRevenuePricingContext(development.id);
    expect(context.pricedPlots).toHaveLength(1);
    expect(context.pricedPlots[0].effectivePrice).toBe(332500);
  });

  it('recognised revenue remains completion-based (Completed plots only)', () => {
    const plots = [
      { revenueStatus: 'Exchanged', sellingPrice: 300000, effectivePrice: 300000 },
      { revenueStatus: 'Completed', sellingPrice: 250000, effectivePrice: 250000 },
      { revenueStatus: 'Reserved', sellingPrice: 100000, effectivePrice: 100000 },
    ];
    expect(calculateRecognisedRevenue(plots)).toBe(250000);
  });
});
