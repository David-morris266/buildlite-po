/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CVRTable from './CVRTable';

describe('CVRTable Storyboard selection contract', () => {
  let container;
  let root;

  beforeEach(() => {
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

  it('keeps the matrix concise and delegates detail through the canonical Cost Code action', () => {
    const onRowSelect = vi.fn();
    act(() => {
      root.render(
        <CVRTable
          rows={[
            {
              id: 'cc-5231',
              costCodeKey: '5231',
              costCodeLabel: '5231 — Cleaning — Cleaning',
              currentBudgetLabel: '£0.00',
              committedLabel: '£50,250.00',
              certifiedLabel: '£2,150.00',
              actualCostLabel: '£0.00',
              manualAccrualLabel: '£100.00',
              currentCostLabel: '£100.00',
              systemForecastLabel: '£50,250.00',
              finalForecastLabel: '£50,750.00',
              costToCompleteLabel: '£50,650.00',
              costToComplete: 50650,
              varianceLabel: '£50,750.00',
              commercialAdjustment: 500,
              commercialAdjustmentLabel: '+£500.00',
              adjustmentState: 'positive',
            },
          ]}
          totals={{
            currentBudgetLabel: '£0.00',
            committedLabel: '£2,364,873.00',
            certifiedLabel: '£2,150.00',
            actualCostLabel: '£0.00',
            manualAccrualLabel: '£100.00',
            currentCostLabel: '£100.00',
            systemForecastLabel: '£2,364,873.00',
            finalForecastLabel: '£2,365,373.00',
            costToCompleteLabel: '£2,365,273.00',
            costToComplete: 2365273,
            varianceLabel: '—',
          }}
          onRowSelect={onRowSelect}
        />
      );
    });

    const text = container.textContent;
    expect(text).not.toMatch(/Accrual/);
    expect(text).not.toMatch(/Current Cost/);
    expect(text).not.toContain('View detail');
    const headers = Array.from(container.querySelectorAll('thead th')).map(
      (header) => header.textContent.trim()
    );
    expect(headers).toEqual([
      'Cost Code', 'Description', 'Current Budget', 'Previous CVR', 'Current CVR',
      'Movement', 'Variance to Budget',
    ]);
    const action = container.querySelector('.dev-cvr__row-link');
    act(() => action.click());
    expect(onRowSelect).toHaveBeenCalledOnce();
    expect(onRowSelect.mock.calls[0][0].costCodeKey).toBe('5231');
    expect(onRowSelect.mock.calls[0][1]).toBe(action);
  });
});
