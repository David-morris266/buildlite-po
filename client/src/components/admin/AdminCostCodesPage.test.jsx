/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const putClassification = vi.hoisted(() => vi.fn());
const listClassifications = vi.hoisted(() => vi.fn());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../../admin/costCodeAuthority', () => ({
  isCostCodeServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../../api/costCodes', () => import('../../test/mockCostCodesApi'));

vi.mock('../../api/costCodeClassifications', () => ({
  CostCodeClassificationApiError: class CostCodeClassificationApiError extends Error {
    constructor(message, { status = 0 } = {}) {
      super(message);
      this.status = status;
    }
  },
  listCostCodeClassifications: (...args) => listClassifications(...args),
  putCostCodeClassification: (...args) => putClassification(...args),
}));

import AdminCostCodesPage from './AdminCostCodesPage';
import { COST_CODE_MASTER_KEY, addCostCodeMasterRecord } from '../../admin/costCodeMasterStore';
import { getCommercialStructure } from '../../admin/commercialStructureStore';
import { __resetCostCodeServerCacheForTests } from '../../admin/costCodeServerCache';
import {
  getCostCodesCallCounts,
  resetCostCodesApiStore,
  seedMockCostCodes,
  setCostCodesGetReject,
} from '../../test/mockCostCodesApi';

describe('AdminCostCodesPage (BL-033D.x.2A.2)', () => {
  let container;
  let root;
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCostCodeServerCacheForTests();
    resetCostCodesApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
    getCommercialStructure();
    vi.stubGlobal('alert', vi.fn());
    listClassifications.mockResolvedValue({ classifications: [] });
    putClassification.mockResolvedValue({
      id: 'cls-1',
      costCodeKey: '5231',
      exists: true,
      semanticGroup: 'PRELIMS',
      forecastDriver: 'STANDARD_CVR',
      version: 1,
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function renderPage() {
    await act(async () => {
      root.render(<AdminCostCodesPage onBack={() => {}} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('OFF shows localStorage records and does not call /api/cost-codes', async () => {
    addCostCodeMasterRecord({
      code: '5231',
      description: 'Cleaning',
      commercialHead: 'Preliminaries',
      trade: 'Cleaning',
    });
    await renderPage();
    expect(container.textContent).toContain('5231');
    expect(container.textContent).toContain('Cleaning');
    expect(getCostCodesCallCounts().total).toBe(0);
  });

  it('ON failed GET shows error, not an empty master', async () => {
    authorityEnabled.value = true;
    setCostCodesGetReject();
    await renderPage();
    expect(container.textContent).toMatch(/Could not load cost codes/i);
    expect(container.textContent).not.toMatch(/genuine empty master/i);
    expect(container.textContent).toContain('Retry');
    expect(container.querySelector('.admin-kpi-grid')).toBeNull();
  });

  it('ON successful empty GET shows a genuine empty master', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([]);
    await renderPage();
    expect(container.textContent).toContain('No cost codes');
    expect(container.textContent).toMatch(/genuine empty master/i);
    expect(container.textContent).not.toMatch(/Could not load cost codes/i);
  });

  it('ON lists server codes, keeps code locked, and saves classification separately', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([{ id: 'cc-5231', code: '5231', description: 'Cleaning', version: 1 }]);
    await renderPage();
    expect(container.textContent).toContain('5231');
    expect(JSON.parse(localStorage.getItem(COST_CODE_MASTER_KEY) || 'null')).toBeNull();

    const item = [...container.querySelectorAll('button')].find((el) => el.textContent.includes('5231'));
    await act(async () => {
      item.click();
      await Promise.resolve();
    });
    const codeInput = [...container.querySelectorAll('input')].find((el) => el.value === '5231');
    expect(codeInput.readOnly).toBe(true);
    expect(codeInput.disabled).toBe(true);

    const description = [...container.querySelectorAll('input')].find((el) => el.value === 'Cleaning');
    await act(async () => {
      description.value = 'Site cleaning';
      description.dispatchEvent(new Event('input', { bubbles: true }));
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(putClassification).toHaveBeenCalled();
    expect(putClassification.mock.calls[0][0]).toBe('5231');
    expect(localStorage.getItem(COST_CODE_MASTER_KEY)).toBeNull();
  });
});
