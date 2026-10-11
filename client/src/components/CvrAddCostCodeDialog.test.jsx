/** @vitest-environment jsdom */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listActiveCostCodesForSelect = vi.hoisted(() => vi.fn());
vi.mock('../admin/costCodeMasterStore', () => ({ listActiveCostCodesForSelect }));
import CvrAddCostCodeDialog from './CvrAddCostCodeDialog';

const MASTER = [
  { code: '1110', description: 'Stamp Duty', commercialHead: 'Land', active: true },
  { code: '5400', description: 'Selling Costs General Allowance', commercialHead: 'Sales & Marketing', commercialFamily: 'Selling', active: true },
  { code: '5231', description: 'Cleaning', commercialHead: 'Preliminaries', active: true },
  { code: '9999', description: 'Archived', commercialHead: 'Build', active: false },
];

describe('CvrAddCostCodeDialog completeness review', () => {
  let container;
  let root;
  beforeEach(() => { listActiveCostCodesForSelect.mockResolvedValue(MASTER); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

  async function renderDialog(props = {}) {
    const onSave = props.onSave || vi.fn(async () => ({ ok: true }));
    await act(async () => root.render(<CvrAddCostCodeDialog open periodKey="SITE_START" memberKeys={props.memberKeys || ['1110']} masterCodes={props.masterCodes || MASTER} canAdd={props.canAdd !== false} onCancel={vi.fn()} onSave={onSave} />));
    return { onSave };
  }

  async function setValue(selector, value) {
    const input = container.querySelector(selector);
    const prototype = input.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('change', { bubbles: true })); });
  }

  it('lists only active unrepresented codes with hierarchy and authority guidance', async () => {
    await renderDialog();
    expect(container.textContent).toContain('2 active Company Cost Codes are not represented');
    expect(container.querySelector('[data-cost-code="1110"]')).toBeNull();
    expect(container.querySelector('[data-cost-code="9999"]')).toBeNull();
    expect(container.querySelector('[data-cost-code="5400"]').textContent).toContain('Sales & Marketing · Selling');
    expect(container.textContent).toContain('zero authoritative baseline');
  });

  it('searches and filters the unrepresented population', async () => {
    await renderDialog();
    await setValue('[aria-label="Search unrepresented Cost Codes"]', 'clean');
    expect(container.querySelector('[data-cost-code="5231"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="5400"]')).toBeNull();
    await setValue('[aria-label="Search unrepresented Cost Codes"]', '');
    await setValue('[aria-label="Filter by Commercial Head"]', 'Sales & Marketing');
    expect(container.querySelector('[data-cost-code="5400"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="5231"]')).toBeNull();
  });

  it('uses the existing single-code command and shows server failures', async () => {
    const onSave = vi.fn(async () => ({ ok: false, errors: ['A cost-code input already exists for this period.'] }));
    await renderDialog({ onSave });
    await act(async () => { container.querySelector('[data-cost-code="5400"] button').click(); await Promise.resolve(); });
    expect(onSave).toHaveBeenCalledWith({ costCodeKey: '5400' });
    expect(container.textContent).toContain('already exists');
  });

  it('is review-only when the period is immutable', async () => {
    await renderDialog({ canAdd: false });
    expect(container.querySelectorAll('[data-cost-code] button')).toHaveLength(0);
  });
});
