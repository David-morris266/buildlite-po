/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const summaryState = vi.hoisted(() => ({ current: null }));
const saveCommentary = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const submitPeriod = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const approvePeriod = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('../api', () => ({ listPOs: vi.fn(async () => []) }));
vi.mock('../commercial/commercialEvents', () => ({ subscribeCommercialChanged: () => () => {} }));
vi.mock('../cvr/cvrSummaryHelpers', () => ({ buildCvrSummaryModel: () => summaryState.current }));
vi.mock('../cvr/cvrPeriodStore', async (importOriginal) => ({
  ...(await importOriginal()),
  saveCvrPeriodCommentary: saveCommentary,
  submitCvrPeriod: submitPeriod,
  approveCvrPeriod: approvePeriod,
}));
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
      { key: 'commercialAdjustment', label: 'Projected Adjustment', available: true, previousLabel: '£500.00', currentLabel: '£1,500.00', movementLabel: '+£1,000.00', attributions: [{ sourceType: 'commercial_adjustment', sourceId: 'adjustment-1', reference: 'Projected Adjustment', description: 'UAT movement change', amount: 1000 }] },
    ], ...overrides,
  };
}

function model(rows = [canonicalRow], movement = movementRow()) {
  return {
    unavailable: false, historic: false, historicUnavailable: false, readOnly: false, loadState: 'ready',
    periodKey: 'P04', period: { status: 'draft' }, rows,
    header: { developmentName: 'Hawthorn Gardens UAT', developmentNumber: 'HG01', reportingPeriodLabel: 'September 2026', createdLabel: '1 Sep 2026', submittedLabel: '—', approvedLabel: '—', approvedBy: '—', lastUpdatedLabel: '18 Sep 2026', commercialManager: 'David Morris' },
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
    saveCommentary.mockClear();
    submitPeriod.mockReset(); submitPeriod.mockResolvedValue({ ok: true });
    approvePeriod.mockReset(); approvePeriod.mockResolvedValue({ ok: true });
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
      root.render(<CVRSummaryPage development={{ id: 'hawthorn', developmentName: 'Hawthorn Gardens UAT', jobNumber: 'HG01' }} periodKey="P04" activeSubview={props.activeSubview || 'movements'} onSelectSubview={props.onSelectSubview} certificatesReady onContinueToCvr={props.onContinueToCvr} onOpenWorksheetForCostCode={props.onOpenWorksheetForCostCode} onOpenVariationAccount={props.onOpenVariationAccount} refreshToken={props.refreshToken || 0} />);
      await Promise.resolve();
    });
  }

  it('saves a second component explanation with the complete authoritative collection', async () => {
    const systemExplanation = {
      costCodeKey: '3640', component: 'systemForecast', previousPeriodId: 'period-p01',
      previousSnapshotId: 'snapshot-p01', fingerprint: 'p01|snapshot|3640|systemForecast|7320000',
      unexplainedAmount: 73200, reason: 'Explanation A',
    };
    const movement = movementRow({
      unexplained: true,
      components: [
        {
          key: 'systemForecast', label: 'System Forecast', available: true,
          previousLabel: '£90,000.00', currentLabel: '£163,200.00', movementLabel: '+£73,200.00',
          unattributed: 0, fingerprint: systemExplanation.fingerprint,
          explanation: { ...systemExplanation, stale: false },
        },
        {
          key: 'changeExposure', label: 'Change Exposure', available: true,
          previousLabel: '£0.00', currentLabel: '£4,000.00', movementLabel: '+£4,000.00',
          unattributed: 4000, fingerprint: 'p01|snapshot|3640|changeExposure|400000',
        },
      ],
    });
    summaryState.current = model([canonicalRow], movement);
    summaryState.current.commentary.movementExplanations = [systemExplanation];
    summaryState.current.movementReport.previousPeriodId = 'period-p01';
    summaryState.current.movementReport.previousSnapshotId = 'snapshot-p01';

    await render();
    const textarea = container.querySelector('.cvr-movement__explanation textarea');
    expect(textarea).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Explanation B');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    const saveButton = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Save explanation');
    expect(saveButton.disabled).toBe(false);
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(saveCommentary).toHaveBeenCalledWith('hawthorn', 'P04', {
      movementExplanations: [
        systemExplanation,
        {
          costCodeKey: '3640', component: 'changeExposure', previousPeriodId: 'period-p01',
          previousSnapshotId: 'snapshot-p01', fingerprint: 'p01|snapshot|3640|changeExposure|400000',
          unexplainedAmount: 4000, reason: 'Explanation B',
        },
      ],
    });
  });

  it('keeps the Summary landing focused and routes review work to dedicated views', async () => {
    const onSelectSubview = vi.fn();
    await render({ activeSubview: 'summary', onSelectSubview });

    expect(container.textContent).toContain('Commercial Cost Summary');
    expect(container.querySelector('[aria-label="CVR review shortcuts"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Movement explanations');
    expect(container.textContent).not.toContain('Financial Position');
    expect(container.textContent).not.toContain('Commercial Commentary');

    act(() => [...container.querySelectorAll('[aria-label="CVR review shortcuts"] button')]
      .find((button) => button.textContent.startsWith('Movements')).click());
    expect(onSelectSubview).toHaveBeenCalledWith('movements');
  });

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
    expect(detail.textContent).toContain('Previous EFC£53,500.00');
    expect(detail.textContent).toContain('Current EFC£55,000.00');
    expect(detail.textContent).toContain('System Forecast£53,000.00£53,500.00+£500.00');
    expect(detail.textContent).toContain('Projected Adjustment£500.00£1,500.00+£1,000.00');
    expect(detail.textContent).toContain('QS explanation: Planting scope matured');
    expect(detail.textContent).toContain('Projected Adjustment: UAT movement change +£1,000.00');
    expect(detail.textContent.match(/UAT movement change/g)).toHaveLength(1);
    expect(detail.querySelectorAll('col.cvr-movement-inspection__component-column')).toHaveLength(1);
    expect(detail.querySelectorAll('col.cvr-movement-inspection__numeric-column')).toHaveLength(3);
    expect(detail.querySelectorAll('thead th.cvr-summary__numeric')).toHaveLength(3);
    expect(detail.querySelectorAll('tbody td.cvr-summary__numeric')).toHaveLength(15);
    expect(detail.textContent).not.toContain('Manual Accrual');
    expect(detail.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[aria-label="CVR Movement Report"]')).not.toBeNull();
    expect(container.textContent).not.toContain('Commercial Cost Summary');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(onContinueToCvr).not.toHaveBeenCalled();
    act(() => [...detail.querySelectorAll('button')].find((button) => button.textContent === 'Open Variation Account item').click());
    expect(onOpenVariationAccount).toHaveBeenCalledWith({ id: 'va-1', reference: 'VA-0001' });

    act(() => [...detail.querySelectorAll('button')].find((button) => button.textContent === 'Open in CVR Worksheet').click());
    expect(onOpenWorksheetForCostCode).toHaveBeenCalledWith('3640');
    expect(onContinueToCvr).not.toHaveBeenCalled();

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

  it('confirms Approve & Lock with current values and invokes authority once', async () => {
    summaryState.current = model();
    summaryState.current.period = { status: 'submitted' };
    summaryState.current.status = { label: 'Submitted', modifier: 'submitted' };
    summaryState.current.workflow = { showApprove: true, showReject: true };
    summaryState.current.movementReport.executive = { labels: {
      forecastRevenue: '£4,525,000.00', currentForecastCost: '£3,083,000.00',
      grossProfit: '£1,442,000.00', grossMargin: '31.9%', netMovement: '+£77,200.00',
    } };
    await render({ activeSubview: 'summary' });
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Approve & Lock').click());
    let dialog = container.querySelector('[role="dialog"][aria-labelledby="cvr-approve-lock-title"]');
    expect(dialog.textContent).toContain('Approve and lock P04 — September 2026?');
    expect(dialog.textContent).toContain('£4,525,000.00');
    expect(approvePeriod).not.toHaveBeenCalled();
    act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Cancel').click());
    expect(approvePeriod).not.toHaveBeenCalled();
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Approve & Lock').click());
    dialog = container.querySelector('[role="dialog"][aria-labelledby="cvr-approve-lock-title"]');
    await act(async () => { [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Approve & Lock').click(); await Promise.resolve(); });
    expect(approvePeriod).toHaveBeenCalledTimes(1);
  });

  it('retains actionable Variation Account blockers and opens the affected item', async () => {
    const onOpenVariationAccount = vi.fn();
    summaryState.current = model();
    summaryState.current.workflow = { showSubmit: true };
    submitPeriod.mockResolvedValue({ ok: false, errors: ['Variation exposure is not ready to submit.'], blockers: [
      { variationAccountItemId: 'va-1', reference: 'VA-0001', reason: 'forecast_unassessed' },
      { variationAccountItemId: 'va-2', reference: 'VA-0002', reason: 'forecast_unassessed' },
    ] });
    await render({ activeSubview: 'summary', onOpenVariationAccount });
    await act(async () => { [...container.querySelectorAll('button')].find(button => button.textContent === 'Submit for Approval').click(); await Promise.resolve(); });
    const dialog = container.querySelector('[role="dialog"][aria-labelledby="cvr-submission-blockers-title"]');
    expect(dialog.textContent).toContain('2 Variation Account items require QS Forecast assessment');
    expect(dialog.textContent).toContain('VA-0001');
    act(() => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Review Variation Account').click());
    expect(onOpenVariationAccount).toHaveBeenCalledWith({ id: 'va-1', reference: 'VA-0001' });
  });
});
