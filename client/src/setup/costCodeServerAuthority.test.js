import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});
vi.mock('../admin/costCodeAuthority', () => ({ isCostCodeServerAuthorityEnabled: () => true }));
vi.mock('../api/costCodes', () => import('../test/mockCostCodesApi'));
vi.mock('../api/costCodeClassifications', () => ({
  listCostCodeClassifications: async () => ({ classifications: [] }),
  putCostCodeClassification: async () => ({ exists: true, version: 1 }),
  CostCodeClassificationApiError: class extends Error {},
}));

import { COST_CODE_MASTER_KEY } from '../admin/costCodeMasterStore';
import { __resetCostCodeServerCacheForTests, ensureCostCodesReady, getCachedCostCodes } from '../admin/costCodeServerCache';
import { getCostCodesCallCounts, resetCostCodesApiStore, seedMockCostCodes } from '../test/mockCostCodesApi';
import { executeAuthoritativeCostCodeImport } from './costCodeImportService';

describe('GP-5A.1 Setup uses the tenant server Cost Code Master', () => {
  let networkGuard;
  beforeEach(() => {
    networkGuard = installNetworkGuard();
    storage.clear();
    resetCostCodesApiStore();
    __resetCostCodeServerCacheForTests();
    localStorage.setItem(COST_CODE_MASTER_KEY, JSON.stringify({ costCodes: [{ id: 'local', code: '9999', description: 'Browser only' }], migrationVersion: 1 }));
    localStorage.setItem('userName', 'Test QS');
    localStorage.setItem(COST_CODE_MASTER_KEY, JSON.stringify({ costCodes: [{ code: '9999', description: 'Browser only' }] }));
  });
  afterEach(() => { networkGuard.assertNoLiveApiCalls(); networkGuard.restore(); });

  it('ignores local alternatives and both fresh client caches load the same tenant master', async () => {
    seedMockCostCodes([{ id: 'cc-5231', code: '5231', description: 'Cleaning', version: 1, active: true }]);
    await ensureCostCodesReady();
    expect(getCachedCostCodes().map((row) => row.code)).toEqual(['5231']);
    __resetCostCodeServerCacheForTests();
    await ensureCostCodesReady();
    expect(getCachedCostCodes().map((row) => row.code)).toEqual(['5231']);
    expect(getCostCodesCallCounts().get).toBe(2);
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('9999');
  });

  it('imports Setup rows through the server mutation workflow without dual-writing localStorage', async () => {
    seedMockCostCodes([]);
    const validation = {
      canImport: true,
      validRows: [{ code: '4330', description: 'Landscaping', commercialHead: 'Build Costs', commercialFamily: '', reportingGroup: 'External Works', trade: 'External Works', hierarchyMode: 'two-level', defaultOrderType: 'S', defaultVatTreatment: 'Standard', reportingOrder: 1, active: true, warnings: [] }],
      hierarchyDetection: { hasCommercialFamily: false },
      hierarchyMode: 'two-level',
      summary: { totalRows: 1 },
    };
    const result = await executeAuthoritativeCostCodeImport(validation);
    expect(result.ok).toBe(true);
    expect(result.imported).toBe(1);
    expect(getCachedCostCodes().map((row) => row.code)).toEqual(['4330']);
    expect(getCostCodesCallCounts().post).toBe(1);
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('9999');
  });
});
