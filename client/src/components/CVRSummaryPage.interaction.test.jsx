/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const summaryState = vi.hoisted(() => ({ current: null }));

vi.mock('../api', () => ({ listPOs: vi.fn(async () => []) }));
vi.mock('../commercial/commercialEvents', () => ({ subscribeCommercialChanged: () => () => {} }));
vi.mock('../cvr/cvrSummaryHelpers', () => ({ buildCvrSummaryModel: () => summaryState.current }));
vi.mock('../cvr/cvrPeriodAuthority', () => ({ isCvrServerAuthorityEnabled: () => false }));
vi.mock('../ledger/ledgerAuthority', () => ({ isLedgerServerAuthorityEnabled: () => false }));
vi.mock('../revenue/revenueAuthority', () => ({ isRevenueServerAuthorityEnabled: () => false }));

import CVRSummaryPage from './CVRSummaryPage';

const canonicalRow = {
  id: 'input-3640', costCodeKey: '3640', costCodeLabel: '3640 — Planting', description: 'Planting',
  originalBudget: 50000, currentBudget: 50000, committed: 46000, certified: 0, actualCost: 0,
  manualAccrual: 0, expectedLiability: 0, vaExposureUplift: 0, commercialAdjustment: 9000,
  commercialReason: 'UAT movement change', commercialNotes: '', variationExposureItems: [],
};

function movementRow(overrides = {}) {
  return {
    id: 'movement-3640', costCodeKey: '3640', costCodeLabel: '3640', description: 'Planting',
    previousForecastLabel: '£53,500.00', currentForecastLabel: '£55,000.00', movementLabel: '+£1,500.00',
    movement: 1500, currentBudgetLabel: '£50,000.00', varianceLabel: '−£5,000.00', unexplained: false,
    explainedLabel: '+£1,500.00', residualLabel: '£0.00', adjustmentReason: 'UAT movement change', components: [
      { key: 'systemForecast', label: 'System Forecast', available: true, previousLabel: '£53,000.00', currentLabel: '£53,500.00', movementLabel: '+£500.00', explanation: { reason: 'Planting scope matured', stale: false } },
      { key: 'expectedLiability', label: 'Expected Liability', available: true, previousLabel: '£0.00', currentLabel: '£0.00', movementLabel: '£0.00' },
      { key: 'vaExposureUplift', label: 'Variation Account exposure', available: true, previousLabel: '£0.00', currentLabel: '£0.00', movementLabel: '£0.00', attributions: [{ sourceType: 'variation_account', sourceId: 'va-1', reference: 'VA-0001', description: 'Valley detail', amount: 0, drillThrough: { type: 'variation_account', id: 'va-1' } }] },
      { key: 'commercialAdjustment', label: 'Commercial Adjustment', available: true, previousLabel: '£500.00', currentLabel: '£1,500.00', movementLabel: '+£1,000.00', attributions: [{ sourceType: 'commercial_adjustment', sourceId: 'adjustment-1', reference: 'Commercial Adjustment', description: 'UAT movement change', amount: 1000 }] },
    ], ...overrides,
  };
}

function model(rows = [canonicalRow], movement = movementRow()) {
  return {
    unavailable: false, historic: false, historicUnavailable: false, readOnly: false, loadState: 'ready',
    periodKey: 'P04', period: { status: 'draft' }, rows,
    header: { developmentName: 'Hawthorn Gardens UAT', developmentNumber: 'HG01', createdLabel: '1 Sep 2026', submittedLabel: '—', approvedLabel: '—', approvedBy: '—', lastUpdatedLabel: '18 Sep 2026', commercialManager: 'David Morris' },
    status: { label: 'Draft', modifier: 'draft' },
    workflow: { showContinue: true, continueLabel: 'Open CVR Worksheet', showSubmit: false, showApprove: false, showReject: false, showCreateNext: false },
    kpis: [], commercialCostSummary: { available: false, emptyMessage: 'No hierarchy.' },
    movementReport: {
      available: true, totalMovement: 1500, automaticallyAttributed: 0, qsExplained: 0, awaitingExplanation: 1500,
      executive: { labels: { previousForecastRevenue: '—', forecastRevenue: '—', revenueMovement: '—', previousGrossProfit: '—', grossProfit: '—', profitMovement: '—', previousGrossMargin: '—', grossMargin: '—', marginMovement: '—' } },
      sections: { adverse: [movement], favourable: [], other: [], unexplained: [] },
    },
    financialPosition: [], commercialExceptions: [], topVariances: [],
    developmentSummary: { activePlots: 0, totalPlots: 0, plotsSoldLabel: '—', configurationLabel: '—', purchaseOrderCount: 0, certificateCount: 0 },
    historicRevenuePlots: null,
    commentary: { keyCommercialIssues: '', commercialOpportunities: '', financialRisks: '', actionsBeforeNextCvr: '', movementExplanations: [] },
    recentActivity: [],
  };
}

describe('CVR Summary Cost Code interaction', () => {
  let container;
  let root;

  beforeEach(() => {
    summaryState.current = model();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(props = {}) {
    await act(async () => {
      root.render(<CVRSummaryPage development={{ id: 'hawthorn', developmentName: 'Hawthorn Gardens UAT', jobNumber: 'HG01' }} periodKey="P04" certificatesReady onContinueToCvr={props.onContinueToCvr} onOpenWorksheetForCostCode={props.onOpenWorksheetForCostCode} onOpenVariationAccount={props.onOpenVariationAccount} refreshToken={props.refreshToken || 0} />);
      await Promise.resolve();
    });
  }

  it('opens compact read-only movement inspection and hands editing to the Worksheet', async () => {
    const onContinueToCvr = vi.fn();
    const onOpenWorksheetForCostCode = vi.fn();
    const onOpenVariationAccount = vi.fn();
    await render({ onContinueToCvr, onOpenWorksheetForCostCode, onOpenVariationAccount });
    const movementPanel = [...container.querySelectorAll('.cvr-summary__panel')].find((node) => node.querySelector('h2')?.textContent === 'Movement explanations');
    act(() => [...movementPanel.querySelectorAll('button')].find((button) => button.textContent === '3640').click());

    const detail = movementPanel.querySelector('[role="region"][aria-label="Movement inspection for 3640"]');
    expect(detail).not.toBeNull();
    expect(document.activeElement).toBe(detail);
    expect(detail.textContent).toContain('3640 — Planting');
    expect(detail.textContent).toContain('Previous CVR£53,500.00');
    expect(detail.textContent).toContain('Current CVR£55,000.00');
    expect(detail.textContent).toContain('System Forecast£53,000.00£53,500.00+£500.00');
    expect(detail.textContent).toContain('Commercial Adjustment£500.00£1,500.00+£1,000.00');
    expect(detail.textContent).toContain('QS explanation: Planting scope matured');
    expect(detail.textContent).toContain('Commercial Adjustment: UAT movement change +£1,000.00');
    expect(detail.textContent.match(/UAT movement change/g)).toHaveLength(1);
    expect(detail.querySelectorAll('col.cvr-movement-inspection__component-column')).toHaveLength(1);
    expect(detail.querySelectorAll('col.cvr-movement-inspection__numeric-column')).toHaveLength(3);
    expect(detail.querySelectorAll('thead th.cvr-summary__numeric')).toHaveLength(3);
    expect(detail.querySelectorAll('tbody td.cvr-summary__numeric')).toHaveLength(15);
    expect(detail.textContent).not.toContain('Manual Accrual');
    expect(detail.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[aria-label="CVR Movement Report"]')).not.toBeNull();
    expect(container.textContent).toContain('Commercial Cost Summary');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onContinueToCvr).not.toHaveBeenCalled();
    act(() => [...detail.querySelectorAll('button')].find((button) => button.textContent === 'Open Variation Account item').click());
    expect(onOpenVariationAccount).toHaveBeenCalledWith({ id: 'va-1', reference: 'VA-0001' });

    act(() => [...detail.querySelectorAll('button')].find((button) => button.textContent === 'Open in CVR Worksheet').click());
    expect(onOpenWorksheetForCostCode).toHaveBeenCalledWith('3640');
    expect(onContinueToCvr).toHaveBeenCalledOnce();

    act(() => [...detail.querySelectorAll('button')].find((button) => button.textContent === 'Close').click());
    await act(async () => { await Promise.resolve(); });
    expect(movementPanel.querySelector('[aria-label="Movement inspection for 3640"]')).toBeNull();
    expect(container.querySelector('[aria-label="CVR Movement Report"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe('3640');
  });

  it('rehydrates the selected identity from updated canonical rows and fails closed when unresolved', async () => {
    await render();
    act(() => [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '3640').click());
    summaryState.current = model([{ ...canonicalRow, committed: 47000 }]);
    await render({ refreshToken: 1 });
    expect(container.querySelector('[aria-label="Movement inspection for 3640"]')).not.toBeNull();

    summaryState.current = model([{ ...canonicalRow, committed: 47000 }], movementRow({ costCodeKey: 'missing', costCodeLabel: '9999' }));
    await render({ refreshToken: 2 });
    act(() => [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '9999').click());
    expect(container.querySelector('[aria-label^="Movement inspection for"]')).toBeNull();
  });

  it('preserves unavailable historic component evidence without inventing values', async () => {
    summaryState.current = model([canonicalRow], movementRow({ components: [{ key: 'expectedLiability', label: 'Expected Liability', available: false, previousLabel: '—', currentLabel: '—', movementLabel: '—' }] }));
    await render();
    act(() => [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '3640').click());
    expect(container.querySelector('.cvr-movement-inspection__bridge')?.textContent).toContain('Expected Liability———');
  });
});
