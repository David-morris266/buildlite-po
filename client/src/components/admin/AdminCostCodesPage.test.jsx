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
const structure = { heads:[{id:'head-land',name:'Land',active:true,displayOrder:0}],families:[],reportingGroups:[{id:'group-land',headId:'head-land',familyId:null,name:'Land Cost',active:true,displayOrder:0}],adoptionIssues:[] };

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
vi.mock('../../admin/commercialStructureService', async () => {
  const actual = await vi.importActual('../../admin/commercialStructureService');
  return { ...actual, loadCommercialStructure: vi.fn(async () => structure) };
});

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
  setCostCodesPutDelay,
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

  async function renderPage(props = {}) {
    await act(async () => {
      root.render(<AdminCostCodesPage onBack={() => {}} {...props} />);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('limits an affected-record review and restores the full master when cleared', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([
      { id: 'cc-a', code: 'A', description: 'Affected', version: 1 },
      { id: 'cc-b', code: 'B', description: 'Unaffected', version: 1 },
    ]);
    const clear = vi.fn();
    const issueFilter = { issueId: 'unresolved-hierarchy', label: 'Hierarchy requires review', records: [{ id: 'cc-a', code: 'A' }] };
    await renderPage({ issueFilter, onClearIssueFilter: clear });
    expect(container.querySelector('[aria-label="Active validation filter"]').textContent).toContain('Hierarchy requires review');
    expect(container.textContent).toContain('Affected');
    expect(container.textContent).not.toContain('Unaffected');
    expect(container.textContent).toContain('Filtered1');
    act(() => [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Show all Cost Codes')).click());
    expect(clear).toHaveBeenCalledOnce();
    await renderPage();
    expect(container.textContent).toContain('Affected');
    expect(container.textContent).toContain('Unaffected');
    expect(container.textContent).toContain('Filtered2');
  });

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

  it('shows truthful empty and persisted legacy metadata values', async () => {
    authorityEnabled.value = true;
    seedMockCostCodes([{
      id: 'cc-4120', code: '4120', description: 'Brickwork', version: 1,
      commercialHead: null, commercialFamily: null, reportingGroup: null,
      trade: 'Sub-Con', hierarchyMode: null,
    }]);
    await renderPage();
    const item = [...container.querySelectorAll('button')].find((el) => el.textContent.includes('4120'));
    await act(async () => { item.click(); await Promise.resolve(); });

    const labelledSelects = [...container.querySelectorAll('label')].reduce((map, label) => {
      const text = label.querySelector('.dev-form__label')?.textContent;
      if (text) map.set(text, label.querySelector('select'));
      return map;
    }, new Map());
    const head = labelledSelects.get('Commercial Head');
    const reporting = labelledSelects.get('Reporting Group');
    expect(head.value).toBe('');
    expect(head.selectedOptions[0].textContent).toMatch(/Not set/);
    expect(reporting.value).toBe('');
    expect(container.textContent).toContain('Unresolved legacy hierarchy');
    expect(container.textContent).toContain('Sub-Con');
    expect(container.textContent).toContain('UNCLASSIFIED');
  });

  it('disables duplicate submission while saving and confirms success', async () => {
    authorityEnabled.value = true;
    setCostCodesPutDelay(30);
    seedMockCostCodes([{ id: 'cc-5231', code: '5231', description: 'Cleaning', version: 1 }]);
    await renderPage();
    const item = [...container.querySelectorAll('button')].find((el) => el.textContent.includes('5231'));
    await act(async () => { item.click(); await Promise.resolve(); });
    const notes = container.querySelector('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(notes, 'Saved note');
      notes.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const form = container.querySelector('form');
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const savingButton = [...container.querySelectorAll('button')].find((el) => el.textContent.includes('Saving'));
    expect(savingButton.disabled).toBe(true);
    act(() => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    expect(container.textContent).toContain('Cost code saved.');
    expect(getCostCodesCallCounts().put).toBe(1);
    expect([...container.querySelectorAll('button')].find((el) => el.textContent.includes('Save Cost Code')).disabled).toBe(false);
  });
});
