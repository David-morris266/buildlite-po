/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CVRTable from './CVRTable';

describe('CVRTable current cost and accrual visibility', () => {
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

  it('shows accrual and current cost on the worksheet row and totals', () => {
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
          onRowSelect={vi.fn()}
        />
      );
    });

    const text = container.textContent;
    expect(text).toMatch(/Accrual/);
    expect(text).toMatch(/Current Cost/);
    expect(text).toMatch(/£100\.00/);
    const headers = Array.from(container.querySelectorAll('thead th')).map(
      (header) => header.textContent.trim()
    );
    expect(headers.indexOf('Actual')).toBeLessThan(headers.indexOf('Accrual'));
    expect(headers.indexOf('Accrual')).toBeLessThan(headers.indexOf('Current Cost'));
    expect(headers.indexOf('Current Cost')).toBeLessThan(headers.indexOf('System Forecast'));
  });
});
