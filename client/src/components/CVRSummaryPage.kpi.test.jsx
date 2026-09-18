/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommercialCostSummaryTable, CvrMovementReport, RevenueMovementTable, SummaryKpiRibbon } from './CVRSummaryPage';

const ITEMS = [
  { key: 'forecastRevenue', label: 'Forecast Revenue', value: '£1,000,000.00', modifier: 'primary', emphasis: 'hero' },
  { key: 'forecastCost', label: 'Forecast Cost', value: '£700,000.00', modifier: 'primary', emphasis: 'hero' },
  { key: 'forecastProfit', label: 'Gross Profit', value: '£300,000.00', modifier: 'saving', emphasis: 'hero' },
  { key: 'forecastMargin', label: 'Gross Margin', value: '30.0%', modifier: 'saving', emphasis: 'hero' },
  { key: 'costToComplete', label: 'Cost To Complete', value: '£250,000.00', modifier: 'ctc', emphasis: 'hero' },
  { key: 'forecastVariance', label: 'Forecast Variance', value: '−£25,000.00', modifier: 'overspend', emphasis: 'hero' },
  { key: 'securedRevenue', label: 'Secured Revenue', value: '£600,000.00', modifier: 'neutral', emphasis: 'supporting' },
  { key: 'remainingForecast', label: 'Remaining Forecast', value: '£400,000.00', modifier: 'neutral', emphasis: 'supporting' },
];

let root;
let container;

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(items = ITEMS) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<SummaryKpiRibbon items={items} />));
}

function labels(selector) {
  return [...container.querySelectorAll(`${selector} .cvr-summary__kpi-label`)].map((node) => node.textContent);
}

describe('CVR Summary KPI ribbon', () => {
  it('renders all KPIs in deliberate core and revenue-context order', () => {
    render();
    expect(container.querySelectorAll('.cvr-summary__kpi')).toHaveLength(8);
    expect(labels('.cvr-summary__kpi-grid--core')).toEqual([
      'Forecast Cost', 'Gross Profit', 'Gross Margin', 'Cost To Complete', 'Forecast Variance',
    ]);
    expect(labels('.cvr-summary__kpi-grid--revenue')).toEqual([
      'Forecast Revenue', 'Secured Revenue', 'Remaining Forecast',
    ]);
    for (const item of ITEMS) expect(container.textContent).toContain(item.value);
    expect(container.querySelector('.cvr-summary__kpi-hero')).toBeNull();
    expect(container.querySelector('.cvr-summary__kpi-future')).toBeNull();
  });

  it('keeps unavailable revenue placeholders and hints visible', () => {
    render(ITEMS.map((item) => ['forecastRevenue', 'securedRevenue', 'remainingForecast'].includes(item.key)
      ? { ...item, value: '—', hint: 'Revenue unavailable' }
      : item));
    const revenue = container.querySelector('.cvr-summary__kpi-grid--revenue');
    expect([...revenue.querySelectorAll('.cvr-summary__kpi-value')].map((node) => node.textContent)).toEqual(['—', '—', '—']);
    expect(revenue.querySelectorAll('.cvr-summary__kpi-hint')).toHaveLength(3);
    expect(revenue.textContent).toContain('Revenue unavailable');
  });
});

describe('Commercial Cost Summary authority presentation', () => {
  it('renders explicit hierarchy buckets and passes the stable membership descriptor', () => {
    const onOpen = vi.fn();
    const filter = { kind: 'hierarchy_resolution', resolutionStates: ['unresolved_legacy'], label: 'Legacy hierarchy unresolved', costCodeKeys: ['1110'] };
    const summary = {
      available: true,
      items: [{ headKey: 'resolution:unresolved_legacy', head: filter.label, filter, budgetLabel: '£10.00', previousForecastLabel: '£11.00', currentForecastLabel: '£12.00', movementLabel: '+£1.00', movementState: 'adverse', varianceLabel: '−£2.00', varianceState: 'negative' }],
      totals: { budgetLabel: '£10.00', previousForecastLabel: '£11.00', currentForecastLabel: '£12.00', movementLabel: '+£1.00', movementState: 'adverse', varianceLabel: '−£2.00', varianceState: 'negative' },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CommercialCostSummaryTable summary={summary} onOpen={onOpen} />));
    expect(container.textContent).toContain('Legacy hierarchy unresolved');
    expect(container.textContent).not.toContain('Other');
    expect([...container.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual([
      'Commercial Head', 'Current Budget', 'Previous CVR', 'Current CVR', 'Movement', 'Variance to Budget',
    ]);
    expect(container.querySelectorAll('thead th.cvr-summary__numeric')).toHaveLength(5);
    expect(container.querySelectorAll('tbody td.cvr-summary__numeric')).toHaveLength(5);
    expect(container.querySelectorAll('tfoot td.cvr-summary__numeric')).toHaveLength(5);
    expect(container.querySelectorAll('col.cvr-summary__cost-head-column')).toHaveLength(1);
    expect(container.querySelectorAll('col.cvr-summary__cost-value-column')).toHaveLength(3);
    expect(container.querySelectorAll('col.cvr-summary__cost-movement-column')).toHaveLength(1);
    expect(container.querySelectorAll('col.cvr-summary__cost-variance-column')).toHaveLength(1);
    expect(container.textContent).toContain('Select a Commercial Head or hierarchy status');
    act(() => container.querySelector('button').click());
    expect(onOpen).toHaveBeenCalledWith(filter);
  });
});

describe('CVR Movement Report presentation', () => {
  it('presents component reconciliation without claiming commercial explanation', () => {
    const onOpen = vi.fn();
    const movement = {
      id: 'movement-4120', costCodeKey: '4120', costCodeLabel: '4120', description: 'Brickwork',
      previousForecastLabel: '£100.00', currentForecastLabel: '£125.00', movementLabel: '+£25.00',
      movement: 25, currentBudgetLabel: '£120.00', varianceLabel: '−£5.00', unexplained: false,
      explainedLabel: '+£25.00', residualLabel: '£0.00', adjustmentReason: 'Revised brick allowance',
      hierarchyChanged: true, previousHierarchy: { label: 'Build → Masonry' }, currentHierarchy: { label: 'House Build → Brickwork' },
      components: [{ key: 'systemForecast', label: 'System Forecast', movementLabel: '+£25.00' }, { key: 'expectedLiability', label: 'Expected Liability', movementLabel: '£0.00' }, { key: 'vaExposureUplift', label: 'Variation Account exposure', movementLabel: '£0.00' }, { key: 'commercialAdjustment', label: 'Commercial Adjustment', movementLabel: '£0.00' }],
    };
    const report = {
      available: true,
      totalMovement: 25, automaticallyAttributed: 10, qsExplained: 5, awaitingExplanation: 10,
      executive: { labels: { previousForecastCost: '£100.00', currentForecastCost: '£125.00', netMovement: '+£25.00', currentBudget: '£120.00', variance: '−£5.00', forecastRevenue: '£500.00', grossProfit: '£375.00', grossMargin: '75.0%', revenueMovement: '—', profitMovement: '—', marginMovement: '—' } },
      sections: { adverse: [movement], favourable: [], other: [], unexplained: [] },
    };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CvrMovementReport report={report} onOpen={onOpen} />));
    expect(container.textContent).toContain('Key adverse movements');
    expect(container.textContent).toContain('Total movement: +£25.00');
    expect(container.textContent).toContain('Automatically attributed: +£10.00');
    expect(container.textContent).toContain('QS explained: +£5.00');
    expect(container.textContent).toContain('Awaiting explanation: +£10.00');
    expect(container.textContent).toContain('Movement detail');
    expect(container.textContent).toContain('Component reconciled');
    expect(container.textContent).toContain('Reconciled movement+£25.00');
    expect(container.textContent).toContain('Unreconciled£0.00');
    expect(container.textContent).toContain('Commercial Adjustment: Revised brick allowance');
    expect(container.textContent).not.toContain('Explained');
    expect(container.textContent).not.toContain('Explanation');
    expect(container.querySelector('.cvr-movement__executive')).toBeNull();
    act(() => container.querySelector('.dev-cvr__row-link').click());
    expect(onOpen).toHaveBeenCalledWith(movement, expect.any(HTMLButtonElement));
  });

  it('keeps a non-zero component residual visibly unreconciled', () => {
    const movement = {
      id: 'movement-3640', costCodeKey: '3640', costCodeLabel: '3640', description: 'Planting',
      previousForecastLabel: '£53,500.00', currentForecastLabel: '£54,000.00', movementLabel: '+£500.00',
      movement: 500, currentBudgetLabel: '£50,000.00', varianceLabel: '−£4,000.00', unexplained: true,
      explainedLabel: '+£400.00', residualLabel: '+£100.00', adjustmentReason: '', hierarchyChanged: false,
      components: [{ key: 'systemForecast', label: 'System Forecast', movementLabel: '+£400.00' }],
    };
    const report = {
      available: true,
      totalMovement: 500, automaticallyAttributed: 0, qsExplained: 0, awaitingExplanation: 500,
      sections: { adverse: [], favourable: [], other: [], unexplained: [movement] },
    };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CvrMovementReport report={report} />));
    expect(container.textContent).toContain('Unreconciled movements requiring review');
    expect(container.textContent).toContain('Unreconciled +£100.00');
    expect(container.textContent).toContain('Reconciled movement+£400.00');
    expect(container.textContent).not.toContain('No Final Forecast movement this period.');
  });

  it('offers stable Variation Account drill-through only when attribution carries that identity', () => {
    const open = vi.fn();
    const movement = { id: '4180', costCodeLabel: '4180', description: 'Roofing', previousForecastLabel: '£118.00', currentForecastLabel: '£119.00', movementLabel: '+£1.00', movement: 1, currentBudgetLabel: '£100.00', varianceLabel: '−£19.00', unexplained: false, explainedLabel: '+£1.00', residualLabel: '£0.00', components: [{ key: 'vaExposureUplift', label: 'Variation Account exposure', movementLabel: '+£1.00', attributions: [{ sourceType: 'variation_account', sourceId: 'va-1', reference: 'VA-0001', description: 'Valley detail', amount: 1, drillThrough: { type: 'variation_account', id: 'va-1' } }, { sourceType: 'supporting', sourceId: 'none', reference: 'Note', description: 'No identity', amount: 0 }] }] };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CvrMovementReport report={{ available: true, totalMovement: 1, automaticallyAttributed: 1, qsExplained: 0, awaitingExplanation: 0, sections: { adverse: [movement], favourable: [], other: [], unexplained: [] } }} onOpenVariationAccount={open} />));
    const links = [...container.querySelectorAll('button')].filter(button => button.textContent === 'Open Variation Account item');
    expect(links).toHaveLength(1);
    act(() => links[0].click());
    expect(open).toHaveBeenCalledWith({ id: 'va-1', reference: 'VA-0001' });
  });

  it('renders Revenue, profit and margin comparison compactly and preserves unavailable evidence', () => {
    const executive = { labels: { previousForecastRevenue: '—', forecastRevenue: '£500.00', revenueMovement: '—', previousGrossProfit: '—', grossProfit: '£375.00', profitMovement: '—', previousGrossMargin: '—', grossMargin: '75.0%', marginMovement: '—' } };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<RevenueMovementTable executive={executive} />));
    expect([...container.querySelectorAll('thead th')].map((node) => node.textContent)).toEqual(['Metric', 'Previous CVR', 'Current', 'Movement']);
    expect(container.querySelectorAll('thead th.cvr-summary__numeric')).toHaveLength(3);
    expect(container.querySelectorAll('tbody td.cvr-summary__numeric')).toHaveLength(9);
    expect(container.querySelectorAll('col.cvr-summary__revenue-metric-column')).toHaveLength(1);
    expect(container.querySelectorAll('col.cvr-summary__revenue-value-column')).toHaveLength(3);
    expect(container.textContent).toContain('Forecast Revenue');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
    expect(container.textContent).not.toContain('£0.00');
  });

  it('shows truthful first-CVR unavailability', () => {
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
    act(() => root.render(<CvrMovementReport report={{ available: false }} />));
    expect(container.textContent).toContain('after the first CVR is Locked');
  });
});
