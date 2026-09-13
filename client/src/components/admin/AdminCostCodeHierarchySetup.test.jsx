/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCostCodeHierarchySetup from './AdminCostCodeHierarchySetup';
import { bulkUpdateCostCodeHierarchyOnServer } from '../../admin/costCodeServerMutations';

vi.mock('../../admin/costCodeServerMutations', () => ({ bulkUpdateCostCodeHierarchyOnServer: vi.fn() }));
const records = [
  { id: '11111111-1111-4111-8111-111111111111', version: 2, code: '1100', description: 'Land Cost', commercialHead: '', commercialFamily: '', canonicalReportingGroup: '', legacy: { subHeading: 'Land', trade: 'Land', element: 'Land purchase' } },
  { id: '22222222-2222-4222-8222-222222222222', version: 4, code: '4120', description: 'Brickwork', commercialHead: '', commercialFamily: '', canonicalReportingGroup: '', legacy: { subHeading: 'Super-Structure', trade: 'Sub-Con', element: 'Brickwork' } },
];
let container; let root;
const click = (node) => act(() => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
const button = (text) => [...container.querySelectorAll('button')].find((node) => node.textContent.includes(text));

describe('AdminCostCodeHierarchySetup', () => {
  beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
  it('keeps legacy evidence unallocated and applies only after explicit review', async () => {
    const onApplied = vi.fn(); bulkUpdateCostCodeHierarchyOnServer.mockResolvedValue({ ok: true, costCodes: [] });
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} onApplied={onApplied} />));
    expect(container.textContent).toContain('Super-Structure · Sub-Con · Brickwork');
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    expect(container.textContent).toContain('Suggested Commercial Head: Land');
    expect([...container.querySelectorAll('button')].filter((n) => n.textContent === 'Use suggestion')).toHaveLength(1);
    expect(bulkUpdateCostCodeHierarchyOnServer).not.toHaveBeenCalled();
    click(button('Use suggestion'));
    expect(container.textContent).toContain('Added to review');
    click(button('Review 1 changes')); click(button('Apply hierarchy changes'));
    await act(async () => Promise.resolve());
    expect(bulkUpdateCostCodeHierarchyOnServer).toHaveBeenCalledWith([{ id: records[0].id, version: 2, commercialHead: 'Land', commercialFamily: '', reportingGroup: 'Land Cost' }]);
    expect(onApplied).toHaveBeenCalled();
  });
  it('cancels without mutation and filters by search', async () => {
    const onCancel = vi.fn(); await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} onCancel={onCancel} />));
    const search = container.querySelector('[aria-label="Search cost codes"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(search, 'Brickwork');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(container.textContent).toContain('4120'); expect(container.textContent).not.toContain('1100');
    click(button('Cancel')); expect(onCancel).toHaveBeenCalled(); expect(bulkUpdateCostCodeHierarchyOnServer).not.toHaveBeenCalled();
  });
  it('distinguishes filtering from a neutral explicit bulk action', async () => {
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={records} />));
    const filter = container.querySelector('[aria-label="Show cost codes"]');
    const bulk = container.querySelector('[aria-label="Bulk Commercial Head"]');
    const apply = button('Apply bulk action');
    expect(filter.value).toBe('unallocated');
    expect(bulk.value).toBe('');
    expect(bulk.textContent).toContain('Choose bulk action');
    expect(bulk.textContent).toContain('Clear hierarchy to Unallocated');
    expect(apply.disabled).toBe(true);
    expect(container.textContent).toContain('Select cost codes first');
    click(container.querySelector('[aria-label="Select 1100"]'));
    expect(apply.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(bulk, 'House Build');
      bulk.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(apply.disabled).toBe(false);
    expect(container.textContent).toContain('1 selected');
  });
  it('suppresses an already-satisfied proposal with no working delta', async () => {
    const persisted = {
      ...records[0],
      commercialHead: 'Land',
      canonicalReportingGroup: 'Land Cost',
    };
    await act(async () => root.render(<AdminCostCodeHierarchySetup records={[persisted]} />));
    const filter = container.querySelector('[aria-label="Show cost codes"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(filter, 'allocated');
      filter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(container.textContent).toContain('Land · Land · Land purchase');
    expect(container.textContent).not.toContain('Suggested Commercial Head: Land');
    expect(container.textContent).not.toContain('Use suggestion');
    expect(container.textContent).not.toContain('Added to review');
    expect(button('Review 0 changes').disabled).toBe(true);
  });
});
