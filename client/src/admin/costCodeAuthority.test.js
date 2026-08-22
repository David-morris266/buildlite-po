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

vi.mock('./costCodeAuthority', () => ({
  isCostCodeServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/costCodes', () => import('../test/mockCostCodesApi'));

import { COST_CODE_MASTER_KEY, addCostCodeMasterRecord, listCostCodeMasterRecords } from './costCodeMasterStore';
import {
  getCostCodesCallCounts,
  resetCostCodesApiStore,
  seedMockCostCodes,
  setCostCodesGetReject,
} from '../test/mockCostCodesApi';
import {
  __resetCostCodeServerCacheForTests,
  ensureCostCodesReady,
  getCachedCostCodes,
} from './costCodeServerCache';
import { createCostCodeOnServer, updateCostCodeOnServer } from './costCodeServerMutations';

describe('BL-033D.x.2A.1 cost code authority', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCostCodeServerCacheForTests();
    resetCostCodesApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('AUTHORITY OFF keeps browser master behaviour and does not fetch', () => {
    const result = addCostCodeMasterRecord({
      code: '5231',
      description: 'Cleaning',
      commercialHead: 'Preliminaries',
      trade: 'Cleaning',
    });
    expect(result.ok).toBe(true);
    expect(listCostCodeMasterRecords()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('5231');
    expect(getCostCodesCallCounts().total).toBe(0);
    expect(getCachedCostCodes()).toBeNull();
  });

  it('AUTHORITY ON does not fall back to localStorage on failed GET', async () => {
    localStorage.setItem(
      COST_CODE_MASTER_KEY,
      JSON.stringify({
        costCodes: [{ id: 'local-1', code: '9999', description: 'Browser only' }],
        seededFromServer: true,
        updatedAt: '2026-08-01T00:00:00.000Z',
        migrationVersion: 1,
      })
    );
    authorityEnabled.value = true;
    setCostCodesGetReject();
    await expect(ensureCostCodesReady()).rejects.toThrow();
    expect(getCachedCostCodes()).toBeNull();
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('9999');
  });

  it('AUTHORITY ON loads server codes and does not write localStorage', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([{ code: '5231', description: 'Cleaning' }]);
    await ensureCostCodesReady();
    expect(getCachedCostCodes()[0].code).toBe('5231');
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
  });

  it('AUTHORITY ON create/update does not dual-write the browser master', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await ensureCostCodesReady();
    const created = await createCostCodeOnServer({
      code: 'P100-SM',
      description: 'Site Manager',
      commercialHead: 'Preliminaries',
      reportingGroup: 'Site Management',
    });
    expect(created.ok).toBe(true);
    expect(created.costCode.code).toBe('P100-SM');
    expect(getCostCodesCallCounts().post).toBe(1);

    const updated = await updateCostCodeOnServer(created.costCode.id, {
      version: 1,
      description: 'Site management',
      commercialHead: 'Preliminaries',
      reportingGroup: 'Site Management',
    });
    expect(updated.ok).toBe(true);
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
  });
});
