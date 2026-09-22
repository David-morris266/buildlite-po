/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SellingCostsCostCodePicker from './SellingCostsCostCodePicker';

const codes = [{ id: 'a', code: '100', description: 'Arbitrary', commercialHeadId: 'other', reportingGroupId: 'other-group' }, { id: 'b', code: 'X-2', description: 'Customer choice', commercialHeadId: 'selling', commercialFamilyId: 'family', reportingGroupId: 'group' }];
const structure = { heads: [{ id: 'selling', name: 'Sales & Marketing', buildliteCategory: 'SELLING_COSTS', active: true }, { id: 'other', name: 'Anything', active: true }], families: [{ id: 'family', name: 'F', headId: 'selling', active: true }], reportingGroups: [{ id: 'group', name: 'R', headId: 'selling', familyId: 'family', active: true }, { id: 'other-group', name: 'Agents', headId: 'other', active: true }] };

describe('Selling Costs Cost Code discovery', () => {
  let root; let host;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); });
  it('defaults closed to the live Selling Costs Head and widens or narrows scope deliberately', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); const onChange = vi.fn();
    await act(async () => root.render(<SellingCostsCostCodePicker codes={codes} structure={structure} valueId="" onChange={onChange} name="Company destination" contextKey="t1" />));
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(host.querySelector('input').placeholder).toBe('Select Cost Code...');
    await act(async () => host.querySelector('input').focus());
    expect(document.body.textContent).toContain('Sales & Marketing');
    expect(document.body.textContent).toContain('X-2 — Customer choice');
    expect(document.body.textContent).toContain('Sales & Marketing → F → R');
    expect(document.body.textContent).not.toContain('100 — Arbitrary');
    await act(async () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Show all Cost Codes').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(document.body.querySelector('[role="listbox"]')).toBeTruthy();
    expect(document.body.textContent).toContain('Searching all Cost Codes');
    expect(document.body.textContent).toContain('100 — Arbitrary');
    await act(async () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Back to Sales & Marketing').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.activeElement).toBe(host.querySelector('input'));
    expect(document.body.textContent).toContain('X-2 — Customer choice');
    expect(document.body.textContent).not.toContain('100 — Arbitrary');
    const suggestedInput = host.querySelector('input');
    await act(async () => suggestedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await act(async () => suggestedInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(onChange).toHaveBeenCalledWith('b');
  });
  it('explains missing category authority while preserving Search all', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<SellingCostsCostCodePicker codes={codes} structure={{ heads: [], families: [], reportingGroups: [] }} valueId="" onChange={vi.fn()} name="Company destination" />));
    expect(host.textContent).toContain('Commercial Head not configured');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await act(async () => host.querySelector('input').focus());
    expect(document.body.textContent).toContain('Show all Cost Codes');
  });
  it('retains an authoritative mapping outside the suggested Head', async () => {
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<SellingCostsCostCodePicker codes={codes} structure={structure} valueId="a" onChange={vi.fn()} name="Company destination" />));
    expect(host.querySelector('input').value).toBe('100 — Arbitrary');
    expect(host.textContent).toContain('Current mapping is outside Sales & Marketing');
  });

  it('makes the complete suggested and search-all populations reachable in the portalled listbox', async () => {
    const largeCodes = Array.from({ length: 210 }, (_, index) => ({
      id: `cc-${index + 1}`,
      code: String(index + 1).padStart(4, '0'),
      description: `Cost Code ${index + 1}`,
      commercialHeadId: index < 18 ? 'selling' : 'other',
      reportingGroupId: index < 18 ? 'group' : 'other-group',
    }));
    host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
    await act(async () => root.render(<SellingCostsCostCodePicker codes={largeCodes} structure={structure} valueId="" onChange={vi.fn()} name="Company destination" />));
    await act(async () => host.querySelector('input').focus());
    expect(document.body.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(18);
    await act(async () => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Show all Cost Codes').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(document.body.querySelectorAll('[role="listbox"] [role="option"]')).toHaveLength(210);
    expect(document.body.querySelector('[role="listbox"] [data-cost-code="0210"]')).toBeTruthy();
  });
});
