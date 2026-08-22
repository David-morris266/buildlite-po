import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('./costCodeAuthority', () => ({
  isCostCodeServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/costCodes', () => import('../test/mockCostCodesApi'));

import {
  getCostCodesCallCounts,
  resetCostCodesApiStore,
  seedMockCostCodes,
  setCostCodesGetDelay,
  setCostCodesGetReject,
} from '../test/mockCostCodesApi';
import {
  __resetCostCodeServerCacheForTests,
  ensureCostCodesReady,
  getCachedCostCodes,
  getCostCodeLoadState,
  getCostCodeReadiness,
  requireCachedCostCodes,
} from './costCodeServerCache';

describe('costCodeServerCache (BL-033D.x.2A.1)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    __resetCostCodeServerCacheForTests();
    resetCostCodesApiStore();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('loads from idle/loading into loaded, including a genuine empty master', async () => {
    setCostCodesGetDelay(15);
    seedMockCostCodes([]);
    expect(getCostCodeLoadState()).toBe('idle');
    const pending = ensureCostCodesReady();
    expect(getCostCodeLoadState()).toBe('loading');
    const rows = await pending;
    expect(getCostCodeLoadState()).toBe('loaded');
    expect(rows).toEqual([]);
    expect(getCachedCostCodes()).toEqual([]);
    expect(getCostCodeReadiness().ready).toBe(true);
  });

  it('deduplicates in-flight loads', async () => {
    setCostCodesGetDelay(20);
    seedMockCostCodes([{ code: '5231', description: 'Cleaning' }]);
    await Promise.all([ensureCostCodesReady(), ensureCostCodesReady()]);
    expect(getCostCodesCallCounts().get).toBe(1);
    expect(getCachedCostCodes()[0].code).toBe('5231');
    expect(getCachedCostCodes()[0].label).toBe('5231 — Cleaning');
  });

  it('failed GET is error/unresolved and is not an empty master', async () => {
    setCostCodesGetReject();
    await expect(ensureCostCodesReady()).rejects.toThrow(/Unable to load cost codes/);
    expect(getCostCodeLoadState()).toBe('error');
    expect(getCachedCostCodes()).toBeNull();
    expect(getCostCodeReadiness().ready).toBe(false);
    expect(() => requireCachedCostCodes()).toThrow();
  });

  it('unresolved idle is not ready and is not an empty master', () => {
    expect(getCostCodeReadiness().ready).toBe(false);
    expect(getCachedCostCodes()).toBeNull();
    expect(() => requireCachedCostCodes()).toThrow(/not loaded yet/);
  });

  it('authority OFF does not fetch', async () => {
    authorityEnabled.value = false;
    await expect(ensureCostCodesReady()).rejects.toThrow(/authority is off/);
    expect(getCostCodesCallCounts().get).toBe(0);
    expect(getCachedCostCodes()).toBeNull();
  });
});
