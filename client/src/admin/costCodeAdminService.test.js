import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const putClassification = vi.hoisted(() => vi.fn());

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

vi.mock('../api/costCodeClassifications', () => ({
  CostCodeClassificationApiError: class CostCodeClassificationApiError extends Error {},
  listCostCodeClassifications: async () => ({ classifications: [] }),
  putCostCodeClassification: (...args) => putClassification(...args),
}));

import { COST_CODE_MASTER_KEY, listActiveCostCodesForSelect } from './costCodeMasterStore';
import {
  getCostCodesCallCounts,
  resetCostCodesApiStore,
  seedMockCostCodes,
  setCostCodesGetReject,
} from '../test/mockCostCodesApi';
import { __resetCostCodeServerCacheForTests, getCachedCostCodes } from './costCodeServerCache';
import {
  ensureAdminCostCodesReady,
  listAdminCostCodeRecords,
  looksLikeDisplayLabel,
  saveAdminCostCode,
  searchAdminCostCodeRecords,
} from './costCodeAdminService';
import { getCommercialStructure } from './commercialStructureStore';

const CLEANING_FORM = {
  code: '5231',
  description: 'Cleaning',
  commercialHead: 'Preliminaries',
  commercialFamily: '',
  trade: 'Cleaning',
  reportingGroup: 'Cleaning',
  defaultVatTreatment: 'Standard',
  defaultOrderType: 'S',
  active: true,
  notes: '',
};

describe('BL-033D.x.2A.2 Admin cost-code authority', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCostCodeServerCacheForTests();
    resetCostCodesApiStore();
    storage.clear();
    putClassification.mockReset();
    putClassification.mockResolvedValue({
      id: 'cls-1',
      costCodeKey: '5231',
      exists: true,
      semanticGroup: 'PRELIMS',
      forecastDriver: 'STANDARD_CVR',
      version: 1,
    });
    localStorage.setItem('userName', 'Test QS');
    getCommercialStructure();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('OFF Admin uses localStorage store and does not call server master API', async () => {
    const created = await saveAdminCostCode({ isNew: true, form: CLEANING_FORM });
    expect(created.ok).toBe(true);
    expect(listAdminCostCodeRecords()).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('5231');
    expect(getCostCodesCallCounts().total).toBe(0);
    expect(getCachedCostCodes()).toBeNull();
  });

  it('ON loads server cache and does not read or write localStorage master', async () => {
    localStorage.setItem(
      COST_CODE_MASTER_KEY,
      JSON.stringify({
        costCodes: [{ id: 'local-1', code: '9999', description: 'Browser only', active: true }],
        seededFromServer: true,
      })
    );
    authorityEnabled.value = true;
    seedMockCostCodes([{ code: '5231', description: 'Cleaning' }]);
    await ensureAdminCostCodesReady();
    const rows = listAdminCostCodeRecords();
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('5231');
    expect(rows.map((row) => row.code)).not.toContain('9999');
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY)).costCodes[0].code).toBe('9999');
  });

  it('ON failed GET is unresolved, not a genuine empty master', async () => {
    authorityEnabled.value = true;
    setCostCodesGetReject();
    await expect(ensureAdminCostCodesReady()).rejects.toThrow();
    expect(listAdminCostCodeRecords()).toBeNull();
    expect(searchAdminCostCodeRecords('', listAdminCostCodeRecords())).toBeNull();
    expect(getCachedCostCodes()).toBeNull();
  });

  it('ON successful empty GET is a genuine empty master', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await ensureAdminCostCodesReady();
    expect(listAdminCostCodeRecords()).toEqual([]);
  });

  it('ON create POSTs canonical hyphenated code and does not write localStorage', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await ensureAdminCostCodesReady();
    const created = await saveAdminCostCode({
      isNew: true,
      form: { ...CLEANING_FORM, code: 'P100-SM', description: 'Site Manager', trade: 'Site Management' },
    });
    expect(created.ok).toBe(true);
    expect(created.record.code).toBe('P100-SM');
    expect(getCostCodesCallCounts().post).toBe(1);
    expect(getCostCodesCallCounts().lastWritePayload.code).toBe('P100-SM');
    expect(listAdminCostCodeRecords()[0].code).toBe('P100-SM');
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
  });

  it('ON rejects label-like codes and duplicate 409', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await ensureAdminCostCodesReady();
    expect(looksLikeDisplayLabel('5231 — Cleaning')).toBe(true);
    const labelled = await saveAdminCostCode({
      isNew: true,
      form: { ...CLEANING_FORM, code: '5231 — Cleaning' },
    });
    expect(labelled.ok).toBe(false);
    expect(labelled.status).toBe(400);
    expect(getCostCodesCallCounts().post).toBe(0);

    const first = await saveAdminCostCode({ isNew: true, form: CLEANING_FORM });
    expect(first.ok).toBe(true);
    const duplicate = await saveAdminCostCode({ isNew: true, form: CLEANING_FORM });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.status).toBe(409);
  });

  it('ON edit PUTs metadata, keeps code immutable, and stale 409 does not overwrite', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([{ id: 'cc-5231', code: '5231', description: 'Cleaning', version: 1 }]);
    await ensureAdminCostCodesReady();
    const previous = listAdminCostCodeRecords()[0];
    const renamed = await saveAdminCostCode({
      isNew: false,
      id: previous.id,
      previous,
      form: { ...previous, code: '9999', description: 'Night cleaning' },
    });
    expect(renamed.ok).toBe(false);
    expect(renamed.errors[0]).toMatch(/cannot be changed/);

    const updated = await saveAdminCostCode({
      isNew: false,
      id: previous.id,
      previous,
      form: { ...previous, description: 'Night cleaning', version: 1 },
    });
    expect(updated.ok).toBe(true);
    expect(updated.record.code).toBe('5231');
    expect(updated.record.description).toBe('Night cleaning');
    expect(getCostCodesCallCounts().put).toBe(1);

    const stale = await saveAdminCostCode({
      isNew: false,
      id: previous.id,
      previous: { ...updated.record, version: 1 },
      form: { ...updated.record, description: 'Stale write', version: 1 },
    });
    expect(stale.ok).toBe(false);
    expect(stale.conflict).toBe(true);
    expect(stale.status).toBe(409);
    expect(listAdminCostCodeRecords()[0].description).toBe('Night cleaning');
  });

  it('ON deactivate retains the row, hides it from the active selector, and allows reactivate', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([{ id: 'cc-5231', code: '5231', description: 'Cleaning', version: 1, active: true }]);
    await ensureAdminCostCodesReady();
    const previous = listAdminCostCodeRecords()[0];
    const deactivated = await saveAdminCostCode({
      isNew: false,
      id: previous.id,
      previous,
      form: { ...previous, active: false, version: 1 },
    });
    expect(deactivated.ok).toBe(true);
    expect(deactivated.record.active).toBe(false);
    expect(listAdminCostCodeRecords()).toHaveLength(1);
    const options = await listActiveCostCodesForSelect();
    expect(options.map((item) => item.code)).not.toContain('5231');

    const reactivated = await saveAdminCostCode({
      isNew: false,
      id: previous.id,
      previous: deactivated.record,
      form: { ...deactivated.record, active: true },
    });
    expect(reactivated.ok).toBe(true);
    expect(reactivated.record.active).toBe(true);
    const activeOptions = await listActiveCostCodesForSelect();
    expect(activeOptions[0].value).toBe('5231');
    expect(activeOptions[0].code).toBe('5231');
    expect(activeOptions[0].label).toContain('5231');
    expect(activeOptions[0].label).toContain('Cleaning');
  });

  it('ON selector uses canonical code identity for multiple consumers', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([
      { code: '5231', description: 'Cleaning' },
      { code: 'P100-SM', description: 'Site Manager', reportingGroup: 'Site Management' },
    ]);
    const a = await listActiveCostCodesForSelect();
    const b = await listActiveCostCodesForSelect();
    expect(a.map((item) => item.value)).toEqual(['5231', 'P100-SM']);
    expect(b.map((item) => item.value)).toEqual(a.map((item) => item.value));
    expect(a[0].value).toBe(a[0].code);
    expect(a[0].label).not.toBe(a[0].value);
  });

  it('does not migrate browser master or seed from the compatibility endpoint when ON', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await ensureAdminCostCodesReady();
    const { ensureCostCodeMasterSeeded } = await import('./costCodeMasterStore');
    await expect(ensureCostCodeMasterSeeded()).rejects.toThrow(/do not seed the browser master/);
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
    expect(getCostCodesCallCounts().get).toBe(1);
  });
});
