/** @vitest-environment jsdom */
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CVRTable from './CVRTable';

let root;
let container;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = null; container = null; });

const row = {
  id: 'r1', costCodeKey: '4120', costCodeLabel: '4120 — Brickwork', description: 'Brickwork',
  currentBudget: 120, currentBudgetLabel: '£120.00', finalForecastLabel: '£125.00', varianceLabel: '−£5.00', varianceState: 'negative',
  committedLabel: '£100.00', certifiedLabel: '£50.00', actualCostLabel: '£40.00', manualAccrualLabel: '£5.00',
  systemForecastLabel: '£100.00', expectedLiabilityLabel: '£10.00', vaExposureUpliftLabel: '£5.00', commercialAdjustmentLabel: '+£10.00', costToCompleteLabel: '£80.00',
};
const totals = { currentBudgetLabel: '£120.00', finalForecastLabel: '£125.00', varianceLabel: '−£5.00', varianceState: 'negative' };
const comparison = { available: true, totalMovementLabel: '+£25.00', rows: [{ costCodeKey: '4120', previousForecast: 100, previousForecastLabel: '£100.00', currentForecastLabel: '£125.00', movement: 25, movementLabel: '+£25.00', hierarchyChanged: false }] };

describe('CVR Worksheet period movement presentation', () => {
  it('leads with the six reporting columns and retains detailed controls in expansion', () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CVRTable rows={[row]} totals={totals} comparison={comparison} onRowSelect={vi.fn()} readOnly />));
    expect([...container.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual([
      'Cost Code', 'Description', 'Current Budget', 'Previous CVR', 'Current CVR', 'Movement', 'Variance to Budget', 'Supporting detail',
    ]);
    expect(container.textContent).toContain('+£25.00');
    expect(container.textContent).toContain('System Forecast');
    expect(container.textContent).toContain('Commercial Adjustment');
  });

  it('keeps first-period Previous CVR and Movement unavailable', () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CVRTable rows={[row]} totals={totals} comparison={{ available: false, rows: [] }} readOnly />));
    const cells = [...container.querySelectorAll('tbody td')].map((node) => node.textContent);
    expect(cells[3]).toBe('—');
    expect(cells[5]).toBe('—');
  });
});
