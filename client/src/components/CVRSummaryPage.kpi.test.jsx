/** @vitest-environment jsdom */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommercialCostSummaryTable, SummaryKpiRibbon } from './CVRSummaryPage';

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
      items: [{ headKey: 'resolution:unresolved_legacy', head: filter.label, filter, budgetLabel: '£10.00', finalForecastLabel: '£12.00', varianceLabel: '−£2.00', varianceState: 'negative' }],
      totals: { budgetLabel: '£10.00', finalForecastLabel: '£12.00', varianceLabel: '−£2.00', varianceState: 'negative' },
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<CommercialCostSummaryTable summary={summary} onOpen={onOpen} />));
    expect(container.textContent).toContain('Legacy hierarchy unresolved');
    expect(container.textContent).not.toContain('Other');
    expect(container.textContent).toContain('Select a Commercial Head or hierarchy status');
    act(() => container.querySelector('button').click());
    expect(onOpen).toHaveBeenCalledWith(filter);
  });
});
