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

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrPeriodListReject,
  getCvrMutationCallCounts,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
} from './cvrPeriodServerCache';
import {
  createOrOpenDraftPeriod,
  getCvrPeriod,
  listCvrPeriods,
} from './cvrPeriodStore';
import { listCostCentres } from './costCentreStore';

const DEV_ID = 'dev-cvr-auth';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';
const STORAGE_KEY = 'buildlite_cvr_v1';

describe('CVR authority reads (BL-031B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF CVR reads localStorage', () => {
    const created = createOrOpenDraftPeriod(DEV_ID);
    expect(created.ok).toBe(true);
    expect(listCvrPeriods(DEV_ID)).toHaveLength(1);
    expect(listCvrPeriods(DEV_ID)[0].periodKey).toBe('P01');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_ID].periods.P01).toBeTruthy();
    expect(getCvrMutationCallCounts().total).toBe(0);
  });

  it('authority ON CVR reads cache once loaded', async () => {
    createOrOpenDraftPeriod(DEV_ID);
    authorityEnabled.value = true;
    seedMockCvrPeriod(
      DEV_ID,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV_ID,
        periodKey: 'P02',
      })
    );
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({ periodId: PERIOD_ID, costCodeKey: '5231' }),
    ]);

    await ensureCvrPeriodAndInputsReady(DEV_ID, 'P02');

    expect(listCvrPeriods(DEV_ID).map((item) => item.periodKey)).toEqual(['P02']);
    expect(listCostCentres(DEV_ID, 'P02')[0].manualAccrual).toBe(400);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_ID].periods.P01).toBeTruthy();
  });

  it('authority ON loading is not a genuine empty period list', () => {
    createOrOpenDraftPeriod(DEV_ID);
    authorityEnabled.value = true;

    expect(listCvrPeriods(DEV_ID)).toEqual([]);
    const period = getCvrPeriod(DEV_ID, 'P01');
    expect(period.unavailable).toBe(true);
    expect(period.loadState).toBe('idle');
    expect(createOrOpenDraftPeriod(DEV_ID).unavailable).toBe(true);
  });

  it('authority ON error has no localStorage fallback', async () => {
    createOrOpenDraftPeriod(DEV_ID);
    authorityEnabled.value = true;
    setCvrPeriodListReject();

    await expect(ensureCvrPeriodsReadyForDevelopment(DEV_ID)).rejects.toThrow();
    expect(listCvrPeriods(DEV_ID)).toEqual([]);
    expect(getCvrPeriod(DEV_ID, 'P01').unavailable).toBe(true);
    expect(getCvrPeriod(DEV_ID, 'P01').loadState).toBe('error');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_ID].periods.P01).toBeTruthy();
  });
});
