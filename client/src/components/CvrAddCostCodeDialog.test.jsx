/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listActiveCostCodesForSelect = vi.hoisted(() => vi.fn());

vi.mock('../admin/costCodeMasterStore', () => ({
  listActiveCostCodesForSelect,
}));

import CvrAddCostCodeDialog from './CvrAddCostCodeDialog';

const MASTER = [
  {
    code: '1110',
    description: 'Stamp Duty',
    reportingGroup: 'Land',
    label: '1110 — Stamp Duty',
  },
  {
    code: '5400',
    description: 'Selling Costs — General Allowance',
    reportingGroup: 'Selling',
    label: '5400 — Selling Costs — General Allowance',
  },
  {
    code: '5231',
    description: 'Cleaning',
    reportingGroup: 'Prelims',
    label: '5231 — Cleaning',
  },
];

describe('CvrAddCostCodeDialog', () => {
  let container;
  let root;

  beforeEach(() => {
    listActiveCostCodesForSelect.mockResolvedValue(MASTER);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function setSearch(value) {
    const search = container.querySelector('input[aria-label="CVR add cost code search"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(search, value);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    search.dispatchEvent(new Event('focus', { bubbles: true }));
    return search;
  }

  async function renderDialog(props = {}) {
    const onSave = props.onSave || vi.fn(async () => ({ ok: true, input: { costCodeKey: '5400' } }));
    await act(async () => {
      root.render(
        <CvrAddCostCodeDialog
          open
          periodKey="P04"
          memberKeys={props.memberKeys || ['1110']}
          onCancel={props.onCancel || vi.fn()}
          onSave={onSave}
        />
      );
    });
    await flush();
    return { onSave };
  }

  it('loads active Master codes and excludes existing CVR members', async () => {
    await renderDialog();
    expect(listActiveCostCodesForSelect).toHaveBeenCalled();
    expect(container.textContent).toContain('Add Cost Code');
    expect(container.querySelector('input[placeholder="e.g. BRK01 — Brickwork"]')).toBeNull();
    await act(async () => {
      container.querySelector('input[aria-label="CVR add cost code search"]').focus();
    });
    await flush();
    expect(container.querySelector('[data-cost-code="5400"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="5231"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="1110"]')).toBeNull();
  });

  it('searches by code then posts only the selected key', async () => {
    const { onSave } = await renderDialog();
    await act(async () => {
      setSearch('5400');
    });
    await flush();
    expect(container.querySelector('[data-cost-code="5400"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="5231"]')).toBeNull();
    await act(async () => {
      container
        .querySelector('[data-cost-code="5400"]')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flush();
    const add = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Add Cost Code')
    );
    await act(async () => {
      add.click();
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith({ costCodeKey: '5400' });
    expect(onSave.mock.calls[0][0].originalBudget).toBeUndefined();
  });

  it('searches by description', async () => {
    await renderDialog();
    await act(async () => {
      setSearch('Selling Costs');
    });
    await flush();
    expect(container.querySelector('[data-cost-code="5400"]')).toBeTruthy();
    expect(container.querySelector('[data-cost-code="5231"]')).toBeNull();
  });

  it('shows a 409 duplicate error from the server', async () => {
    await renderDialog({
      memberKeys: [],
      onSave: vi.fn(async () => ({
        ok: false,
        errors: ['A cost-code input already exists for this period.'],
      })),
    });
    await act(async () => {
      setSearch('5400');
    });
    await flush();
    await act(async () => {
      container
        .querySelector('[data-cost-code="5400"]')
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    await flush();
    const add = [...container.querySelectorAll('button')].find((btn) =>
      btn.textContent.includes('Add Cost Code')
    );
    await act(async () => {
      add.click();
      await Promise.resolve();
    });
    await flush();
    expect(container.textContent).toMatch(/already exists/);
  });
});
