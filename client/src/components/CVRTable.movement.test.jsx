/** @vitest-environment jsdom */
import React, { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cwd } from 'node:process';
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
  it('uses the bounded seven-column width contract without a forced KPI scrollbar', () => {
    const styles = readFileSync(join(cwd(), 'src/styles/po-module.css'), 'utf8');
    expect(styles).toMatch(/\.dev-cvr__table--balanced\s*{[^}]*min-width:\s*940px/s);
    expect(styles).not.toMatch(/\.dev-cvr__table--balanced\s*{[^}]*min-width:\s*1180px/s);
    expect(styles).toMatch(/\.dev-cvr__column-description\s*{\s*width:\s*34%/);
    const ribbonRule = styles.match(/\.dev-cvr__cards--ribbon\s*{([^}]*)}/)?.[1] || '';
    expect(ribbonRule).not.toContain('overflow-x');
  });

  it('renders the seven reporting columns with Cost Code as the sole Storyboard action', () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CVRTable rows={[row]} totals={totals} comparison={comparison} onRowSelect={vi.fn()} readOnly />));
    expect([...container.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual([
      'Cost Code', 'Description', 'Current Budget', 'Previous CVR', 'Current CVR', 'Movement', 'Variance to Budget',
    ]);
    expect(container.textContent).toContain('+£25.00');
    expect(container.textContent).not.toContain('Supporting detail');
    expect(container.textContent).not.toContain('View detail');
    const action = container.querySelector('.dev-cvr__row-link');
    expect(action.tagName).toBe('BUTTON');
    expect(action.type).toBe('button');
    expect(action.getAttribute('aria-label')).toBe('Open Cost Code 4120 — Brickwork');
  });

  it('keeps first-period Previous CVR and Movement unavailable', () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CVRTable rows={[row]} totals={totals} comparison={{ available: false, rows: [] }} readOnly />));
    const cells = [...container.querySelectorAll('tbody td')].map((node) => node.textContent);
    expect(cells[3]).toBe('—');
    expect(cells[5]).toBe('—');
  });

  it('selects a middle row without inserting detail into the table', () => {
    const rows = ['A', 'B', '3640', 'C', 'D'].map((key) => ({ ...row, id: `row-${key}`, costCodeKey: key, costCodeLabel: key, description: `Description ${key}` }));
    function Harness() {
      const [selected, setSelected] = useState(null);
      return <CVRTable rows={rows} totals={totals} comparison={{ available: false, rows: [] }} selectedRow={selected} onRowSelect={setSelected} />;
    }
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<Harness />));
    expect(container.querySelector('.dev-cvr__expanded-row')).toBeNull();
    expect(container.querySelectorAll('colgroup col')).toHaveLength(7);
    expect(container.querySelectorAll('col.dev-cvr__column-money')).toHaveLength(4);
    expect(container.querySelectorAll('col.dev-cvr__column-variance')).toHaveLength(1);

    const button3640 = [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '3640');
    act(() => button3640.click());
    let bodyRows = [...container.querySelectorAll('tbody > tr')];
    expect(bodyRows).toHaveLength(5);
    expect(container.querySelector('.dev-cvr__expanded-row')).toBeNull();
    expect(container.querySelector('[data-cost-code-key="3640"]').classList.contains('dev-cvr__row--selected')).toBe(true);
    expect(button3640.getAttribute('aria-current')).toBe('true');

    act(() => [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === 'D').click());
    bodyRows = [...container.querySelectorAll('tbody > tr')];
    expect(bodyRows).toHaveLength(5);
    expect(container.querySelector('[data-cost-code-key="D"]').classList.contains('dev-cvr__row--selected')).toBe(true);
    expect(container.querySelector('[data-expanded-for]')).toBeNull();
    expect([...container.querySelectorAll('tbody > tr')].map((item) => item.dataset.costCodeKey)).toEqual(['A', 'B', '3640', 'C', 'D']);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('tfoot')?.textContent).toContain('Totals');
  });
});
