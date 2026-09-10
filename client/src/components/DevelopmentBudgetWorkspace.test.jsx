/** @vitest-environment jsdom */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), codes: vi.fn(), permission: true, parse: vi.fn() }));
vi.mock('../api/developmentBudget', () => ({ getDevelopmentBudget: mocks.get, postDevelopmentBudgetEvent: mocks.post }));
vi.mock('../api/costCodes', () => ({ listServerCostCodes: mocks.codes }));
vi.mock('../auth/BuildLiteAuthProvider', () => ({ useBuildLitePermission: () => mocks.permission }));
vi.mock('../developmentBudget/developmentBudgetImport', async importOriginal => ({ ...(await importOriginal()), parseDevelopmentBudgetFile: mocks.parse }));
import DevelopmentBudgetWorkspace from './DevelopmentBudgetWorkspace';

const codes = [{ id: 'cc-a', code: 'A', description: 'Code A', active: true }, { id: 'cc-b', code: 'B', description: 'Code B', active: true }];
const empty = { exists: false, totalOriginalBudget: 0, totalCurrentBudget: 0, perCostCode: [], events: [] };
const established = { exists: true, totalOriginalBudget: 100, totalCurrentBudget: 110, perCostCode: [{ costCodeId: 'cc-a', costCode: 'A', description: 'Code A', originalBudget: 100, currentBudget: 110 }], events: [{ id: 'e1', reference: 'OPEN', eventType: 'opening_budget', effectiveDate: '2026-09-09', reason: 'Approved' }] };
const historyAuthority = { ...established, events: [
  { id: 'open', reference: 'OPEN', eventType: 'opening_budget', effectiveDate: '2026-09-09', reason: 'Approved baseline', lines: [{ costCode: 'A', description: 'Code A', signedAmount: 100 }] },
  { id: 'add', reference: 'ADD-1', eventType: 'addition', effectiveDate: '2026-09-09', reason: 'Allowance', lines: [{ costCode: 'A', description: 'Code A', signedAmount: 10 }] },
  { id: 'omit', reference: 'OMIT-1', eventType: 'omission', effectiveDate: '2026-09-09', reason: 'Saving', lines: [{ costCode: 'B', description: 'Code B', signedAmount: -5 }] },
  { id: 'transfer', reference: 'TR-1', eventType: 'transfer', effectiveDate: '2026-09-09', reason: 'Reallocate', lines: [{ costCode: 'A', description: 'Code A', signedAmount: -2 }, { costCode: 'B', description: 'Code B', signedAmount: 2 }] },
] };

describe('DevelopmentBudgetWorkspace', () => {
  let host, root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); mocks.permission = true; mocks.get.mockResolvedValue(empty); mocks.codes.mockResolvedValue({ costCodes: codes }); mocks.post.mockResolvedValue({ ok: true }); mocks.parse.mockResolvedValue({ fileName: 'budget.csv', rows: [['Cost Code', 'Budget'], ['A', '100.01']], headerRowIndex: 0, headers: ['Cost Code', 'Budget'], fieldByColumn: ['costCode', 'amount'] }); });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks(); });
  async function render() { await act(async () => { root.render(<DevelopmentBudgetWorkspace developmentId="dev-1" />); await Promise.resolve(); }); }
  const button = label => [...host.querySelectorAll('button')].find(item => item.textContent.includes(label));
  function setValue(input, value) { const setter = Object.getOwnPropertyDescriptor(input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new Event('change', { bubbles: true })); input.dispatchEvent(new Event('input', { bubbles: true })); }

  it('shows an honest no-budget state and respects read-only permission', async () => {
    mocks.permission = false; await render();
    expect(host.textContent).toContain('No Development Budget established');
    expect(host.textContent).toContain('read-only access');
    expect(button('Set up Development Budget')).toBeUndefined();
  });

  it('shows an authoritative server load failure instead of a misleading empty budget', async () => {
    mocks.get.mockRejectedValue(new Error('Budget authority unavailable')); await render();
    expect(host.textContent).toContain('Development Budget unavailable');
    expect(host.textContent).toContain('Budget authority unavailable');
    expect(button('Try again')).toBeTruthy();
  });

  it('previews and commits one opening event with feedback', async () => {
    mocks.get.mockResolvedValueOnce(empty).mockResolvedValue(established); await render();
    act(() => button('Set up Development Budget').click());
    const fileInput = host.querySelector('input[type="file"]');
    await act(async () => { Object.defineProperty(fileInput, 'files', { value: [{ name: 'budget.csv' }] }); fileInput.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); await Promise.resolve(); });
    const inputs = [...host.querySelectorAll('input:not([type="file"])')];
    await act(async () => { for (const [input, value] of [[inputs[0], '2026-09-09'], [inputs[1], 'OPEN-1'], [inputs[2], 'Approved baseline']]) setValue(input, value); });
    await act(async () => { button('Establish Opening Budget').click(); await Promise.resolve(); });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post.mock.calls[0][1]).toMatchObject({ eventType: 'opening_budget', reference: 'OPEN-1', reason: 'Approved baseline', lines: [{ costCodeId: 'cc-a', amount: '100.01' }] });
    expect(host.textContent).toContain('Development Budget established');
  });

  it('shows Original, Movements and Current and automatically balances a transfer', async () => {
    mocks.get.mockResolvedValue(established); await render();
    expect(host.textContent).toMatch(/£100\.00/); expect(host.textContent).toMatch(/£10\.00/); expect(host.textContent).toMatch(/£110\.00/);
    act(() => button('Add Budget Movement').click());
    const selects = host.querySelectorAll('select');
    await act(async () => { setValue(selects[0], 'transfer'); });
    const nextSelects = host.querySelectorAll('select');
    await act(async () => { setValue(nextSelects[1], 'cc-a'); setValue(nextSelects[2], 'cc-b'); });
    const inputs = [...host.querySelectorAll('input')];
    const amount = inputs.find(input => !input.type || input.type === 'text');
    const textInputs = inputs.filter(input => input.type === 'text');
    await act(async () => { for (const [input, value] of [[textInputs[0], '25.01'], [textInputs[1], 'TR-1'], [textInputs[2], 'Move budget']]) setValue(input, value); });
    await act(async () => { button('Post Budget Movement').click(); await Promise.resolve(); });
    expect(amount).toBeTruthy();
    expect(mocks.post.mock.calls[0][1].lines).toEqual([{ costCodeId: 'cc-a', amount: '-25.01' }, { costCodeId: 'cc-b', amount: '25.01' }]);
    act(() => button('Add Budget Movement').click());
    expect(host.querySelector('select').value).toBe('addition');
    expect([...host.querySelectorAll('select')].slice(1).every(select => select.value === '')).toBe(true);
    expect([...host.querySelectorAll('input[type="text"]')].every(input => input.value === '')).toBe(true);
  });

  it('cancel and reopen clears transfer-specific and entered movement state', async () => {
    mocks.get.mockResolvedValue(established); await render(); act(() => button('Add Budget Movement').click());
    let selects = host.querySelectorAll('select'); act(() => setValue(selects[0], 'transfer')); selects = host.querySelectorAll('select');
    act(() => { setValue(selects[1], 'cc-a'); setValue(selects[2], 'cc-b'); setValue([...host.querySelectorAll('input')].find(input => input.type === 'text'), '99'); });
    act(() => button('Cancel').click()); act(() => button('Add Budget Movement').click());
    expect(host.querySelector('select').value).toBe('addition');
    expect([...host.querySelectorAll('select')].slice(1).every(select => select.value === '')).toBe(true);
    expect([...host.querySelectorAll('input[type="text"]')].every(input => input.value === '')).toBe(true);
  });

  it('renders separated commercial history with signed effects, baseline and transfer direction', async () => {
    mocks.get.mockResolvedValue(historyAuthority); await render();
    const text = host.textContent;
    expect(text).toContain('£100.00 baseline');
    expect(text).toContain('+£10.00');
    expect(text).toContain('−£5.00');
    expect(text).toContain('A — Code A → B — Code B · Reallocate');
    expect(text).toContain('£2.00 transferred');
    expect(host.querySelectorAll('.development-budget-history th')).toHaveLength(5);
  });

  it('renders the remaining movement history when an unexpected legacy date is malformed', async () => {
    mocks.get.mockResolvedValue({ ...historyAuthority, events: [{ ...historyAuthority.events[1], effectiveDate: 'Wed Sep 09' }] });
    await render();
    expect(host.textContent).toContain('ADD-1');
    expect(host.textContent).toContain('Allowance');
    expect(host.textContent).toContain('+£10.00');
    expect(host.textContent).toContain('—');
  });
});
