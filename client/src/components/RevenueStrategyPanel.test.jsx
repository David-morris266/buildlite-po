/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const strategy = vi.hoisted(() => ({
  value: {
    openMarket: { ratePerFt2: null, effectiveDate: '' },
    affordableHousing: {
      affordableRent: null, sharedOwnership: null, firstHomes: null,
      additionality: null, discountMarketSale: null, other: null,
    },
    garagePremiums: { none: null, single: null, double: null },
  },
}));

vi.mock('../revenue/revenueStrategy', () => ({
  getRevenueStrategy: () => strategy.value,
}));

vi.mock('../revenue/revenueBulkWorkflow', () => ({
  buildSaveStrategySummary: vi.fn(),
  runSaveStrategyApplyWorkflow: vi.fn(),
  saveRevenueStrategyOnly: vi.fn(),
}));

import RevenueStrategyPanel from './RevenueStrategyPanel';

describe('RevenueStrategyPanel new-development assumptions', () => {
  let container;
  let root;

  beforeEach(() => {
    strategy.value = {
      openMarket: { ratePerFt2: null, effectiveDate: '' },
      affordableHousing: {
        affordableRent: null, sharedOwnership: null, firstHomes: null,
        additionality: null, discountMarketSale: null, other: null,
      },
      garagePremiums: { none: null, single: null, double: null },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders every monetary and percentage assumption blank until the QS enters it', () => {
    act(() => root.render(<RevenueStrategyPanel developmentId="dev-new" />));
    const editableNumbers = [...container.querySelectorAll('input[type="number"]')];
    expect(editableNumbers).toHaveLength(10);
    expect(editableNumbers.every((input) => input.value === '')).toBe(true);
    expect(container.querySelector('input[readonly]').value).toBe('');
    expect(container.textContent).not.toContain('350');
    expect(container.textContent).not.toContain('12,500');
    expect(container.textContent).not.toContain('22,500');
  });

  it('displays an explicitly stored zero rate rather than treating it as blank', () => {
    strategy.value = {
      ...strategy.value,
      openMarket: { ratePerFt2: 0, effectiveDate: '' },
    };
    act(() => root.render(<RevenueStrategyPanel developmentId="dev-zero" />));
    const rateInput = container.querySelector('input[type="number"]');
    expect(rateInput.value).toBe('0');
  });
});
