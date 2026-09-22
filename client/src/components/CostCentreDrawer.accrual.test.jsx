/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CostCentreDrawer from './CostCentreDrawer';

const baseRow = {
  id: 'cc-5231',
  costCodeKey: '5231',
  costCodeLabel: '5231 — Cleaning — Cleaning',
  originalBudget: 0,
  currentBudget: 0,
  committed: 50250,
  certified: 2150,
  actualCost: 0,
  manualAccrual: 0,
  currentCost: 0,
  outstandingCertified: 2150,
  outstandingCertifiedState: 'warning',
  commercialAdjustment: 0,
  commercialReason: '',
  systemForecast: 0,
  finalForecast: 0,
  costToComplete: 0,
  variance: 0,
  varianceState: 'overspend',
  adjustmentHistory: [],
};

describe('CostCentreDrawer accrual and forecast UX', () => {
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

  function renderDrawer(props = {}) {
    const onSaveNotes =
      props.onSaveNotes ||
      vi.fn(async () => ({ ok: true, costCentre: { manualAccrual: 100 } }));
    const onSaveCommercialAdjustment =
      props.onSaveCommercialAdjustment ||
      vi.fn(async () => ({ ok: true, costCentre: { commercialAdjustment: 0 } }));
    act(() => {
      root.render(
        <CostCentreDrawer
          open
          row={props.row || baseRow}
          movement={props.movement}
          onClose={vi.fn()}
          onSaveNotes={onSaveNotes}
          onSaveCommercialAdjustment={onSaveCommercialAdjustment}
          onOpenVariationAccount={props.onOpenVariationAccount}
          onOpenAdjustmentWorkflow={props.onOpenAdjustmentWorkflow}
          storyboard
          sideBySide={props.sideBySide ?? true}
        />
      );
    });
    return { onSaveNotes, onSaveCommercialAdjustment };
  }

  it('uses a non-modal labelled Storyboard region in side-by-side mode', () => {
    renderDrawer({ sideBySide: true });
    expect(container.querySelector('.dev-cvr-storyboard--side')).not.toBeNull();
    expect(container.querySelector('[role="region"]')).not.toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(container.textContent).toContain('Close');
  });

  it('portals the constrained Storyboard as a focused sheet', () => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'scroll';
    renderDrawer({ sideBySide: false });
    expect(container.querySelector('.dev-cvr-storyboard')).toBeNull();
    const sheet = document.body.querySelector('.dev-cvr-storyboard--sheet');
    expect(sheet).not.toBeNull();
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(document.body.querySelector('.dev-cvr-storyboard__backdrop')).not.toBeNull();
    expect(sheet.textContent).toContain('Back to Worksheet');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    act(() => [...sheet.querySelectorAll('button')].find((button) => button.textContent === 'Back to Worksheet').click());
    act(() => root.render(<CostCentreDrawer open={false} row={baseRow} onClose={vi.fn()} />));
    expect(document.documentElement.style.overflow).toBe('auto');
    expect(document.body.style.overflow).toBe('scroll');
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  });

  it('restores document scroll when a sheet transitions to side-by-side mode', () => {
    renderDrawer({ sideBySide: false });
    expect(document.body.style.overflow).toBe('hidden');
    renderDrawer({ sideBySide: true });
    expect(document.body.style.overflow).toBe('');
    expect(container.querySelectorAll('.dev-cvr-storyboard__body')).toHaveLength(1);
    expect(container.querySelector('.dev-cvr-storyboard--side')).not.toBeNull();
  });

  it('offers Variation Account drill-through only with stable item and package identity', () => {
    const onOpenVariationAccount = vi.fn();
    renderDrawer({ row: { ...baseRow, variationExposureItems: [{ variationAccountItemId: 'va-1', packageId: 'pkg-1', reference: 'VA-0001', vaExposureUplift: 1000, authorityComposition: {} }, { variationAccountItemId: 'va-2', reference: 'VA-0002', vaExposureUplift: 500, authorityComposition: {} }] }, onOpenVariationAccount });
    const links = [...container.querySelectorAll('button')].filter(button => button.textContent === 'Open Variation Account item');
    expect(links).toHaveLength(1);
    act(() => links[0].click());
    expect(onOpenVariationAccount).toHaveBeenCalledWith({ id: 'va-1', packageId: 'pkg-1', reference: 'VA-0001' });
    expect(container.textContent).toContain('Commercial Event authority');
    expect(container.textContent).toContain('Issued Variation Order authority');
    expect(container.textContent).not.toContain('Effective VA Exposure');
  });

  it('preserves Current Cost and hierarchy-change evidence in the Storyboard', () => {
    renderDrawer({
      row: { ...baseRow, actualCost: 48200, currentCost: 48200 },
      movement: {
        hierarchyChanged: true,
        previousHierarchy: { label: 'External Works / Landscaping' },
        currentHierarchy: { label: 'Plot Works / Landscaping' },
      },
    });
    expect(container.textContent).toContain('Current Cost');
    expect(container.textContent).toMatch(/Current Cost[^0-9]*48,200\.00/);
    const supporting = [...container.querySelectorAll('details')].find((node) => node.querySelector('summary')?.textContent === 'Supporting evidence');
    expect(supporting.textContent).toContain('Hierarchy changed: External Works / Landscaping → Plot Works / Landscaping');
  });

  function workflowOwnedRow(source = 'prelims_adoption') {
    const prelims = source === 'prelims_adoption';
    const reason = prelims
      ? 'Prelims forecast adopted — 2027-02'
      : 'Selling Costs forecast adopted — 2027-02';
    return {
      ...baseRow,
      commercialAdjustment: 57000,
      commercialReason: reason,
      displayMetadata: {
        [prelims ? 'prelimsAdoption' : 'sellingCostsAdoption']: {
          adoptedAdjustment: 57000,
          adoptedAt: '2026-09-19T13:32:00.000Z',
          adoptedBy: 'David Morris',
          reportingMonth: '2027-02',
          superseded: false,
        },
      },
      adjustmentHistory: [{
        id: 'adoption-1', source, newAdjustment: 57000, newReason: reason,
        date: '2026-09-19T13:32:00.000Z', user: 'David Morris',
      }],
    };
  }

  it('presents current Site Prelims ownership as formatted read-only provenance', () => {
    const onOpenAdjustmentWorkflow = vi.fn();
    renderDrawer({ row: workflowOwnedRow(), onOpenAdjustmentWorkflow });
    expect(container.textContent).toContain('+£57,000.00');
    expect(container.textContent).toContain('Source');
    expect(container.textContent).toContain('Site Prelims');
    expect(container.textContent).toContain('Site Prelims forecast adopted');
    expect(container.textContent).toContain('David Morris');
    expect(container.textContent).toContain('February 2027');
    expect(container.textContent).not.toContain('Site Prelims forecast adopted — 2027-02');
    expect(container.querySelector('.dev-cvr-drawer__save-adjustment')).toBeNull();
    const view = [...container.querySelectorAll('button')].find((button) => button.textContent === 'View Site Prelims');
    act(() => view.click());
    expect(onOpenAdjustmentWorkflow).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'prelims' }));
  });

  it('uses the same ownership and navigation contract for Selling Costs', () => {
    const onOpenAdjustmentWorkflow = vi.fn();
    renderDrawer({ row: workflowOwnedRow('selling_costs_adoption'), onOpenAdjustmentWorkflow });
    expect(container.textContent).toContain('Selling Costs forecast adopted');
    const view = [...container.querySelectorAll('button')].find((button) => button.textContent === 'View Selling Costs');
    act(() => view.click());
    expect(onOpenAdjustmentWorkflow).toHaveBeenCalledWith(expect.objectContaining({ tabId: 'selling-costs' }));
  });

  it('renders frozen Detailed Selling Costs constituent evidence without replacing generic evidence', () => {
    const row = workflowOwnedRow('selling_costs_adoption');
    row.commercialAdjustment = 35000;
    row.displayMetadata.sellingCostsAdoption = {
      ...row.displayMetadata.sellingCostsAdoption,
      adoptedTargetFinal: 35000,
      forecastRevenueAtAdoption: 8341500,
      detailedEvidence: {
        aggregate: 35000,
        forecastRevenue: 8341500,
        reportingMonth: '2027-02',
        lines: [
          { id: 'home', name: 'Show Home Furnishing', driver: 'LUMP_SUM', lumpSum: 20000, forecast: 20000, assumptionOverridden: true, destinationOverridden: true },
          { id: 'suite', name: 'Sales Office / Marketing Suite Setup', driver: 'LUMP_SUM', lumpSum: 15000, forecast: 15000, assumptionOverridden: false, destinationOverridden: false },
          { id: 'legal', name: 'Legal Fees', driver: 'QUANTITY_RATE', quantitySource: 'PRIVATE_SALE_PLOTS', resolvedQuantity: 20, rate: 500, unitCode: 'PLOTS', forecast: 10000, quantityEvidence: { message: 'From frozen Plot Master evidence' } },
          { id: 'agents', name: 'Estate Agents', driver: 'PERCENT_REVENUE', percent: 1.5, forecast: 125122.5 },
        ],
      },
    };
    renderDrawer({ row });
    const supporting = [...container.querySelectorAll('details')].find(node => node.querySelector('summary')?.textContent === 'Supporting evidence');
    supporting.open = true;
    expect(supporting.textContent).toContain('Selling Costs — Detailed');
    expect(supporting.textContent).toContain('Adopted forecast£35,000.00');
    expect(supporting.textContent).toContain('Show Home Furnishing£20,000.00');
    expect(supporting.textContent).toContain('Sales Office / Marketing Suite Setup£15,000.00');
    expect(supporting.textContent).toContain('20 private-sale plots × £500.00 / plot');
    expect(supporting.textContent).toContain('1.50% of £8,341,500.00');
    expect(supporting.textContent).toContain('Development Cost Code override');
    expect(supporting.textContent).toContain('Company assumption');
    expect(supporting.textContent).toContain('February 2027');
    expect(supporting.textContent).toContain('Packages / commitments');
    expect(supporting.textContent).toContain('Approved Certificates');
    expect(supporting.textContent).toContain('Ledger Transactions');
  });

  it('renders legacy Selling Costs release dash encoding safely without changing evidence', () => {
    renderDrawer({
      row: {
        ...baseRow,
        adjustmentHistory: [{
          id: 'release-1',
          previousAdjustment: 115062.5,
          newAdjustment: 0,
          reason: 'Selling Costs position released â€“ 2027-02',
          user: 'David Morris',
          date: '2026-09-21T09:30:00.000Z',
        }],
      },
    });
    expect(container.textContent).toContain('Selling Costs position released — 2027-02');
    expect(container.textContent).not.toContain('â€“');
    expect(container.textContent).toContain('115,062.50');
    expect(container.textContent).toContain('David Morris');
  });

  it('requires deliberate, reasoned replacement before saving a workflow-owned adjustment', async () => {
    const onSaveCommercialAdjustment = vi.fn(async () => ({ ok: true }));
    renderDrawer({ row: workflowOwnedRow(), onSaveCommercialAdjustment });
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Replace with manual adjustment').click());
    expect(container.textContent).toContain('will supersede the currently adopted Site Prelims position');
    const save = container.querySelector('.dev-cvr-drawer__save-adjustment');
    expect(save.disabled).toBe(true);
    const reasonInput = container.querySelector('.dev-cvr-drawer__reason-input');
    act(() => changeInput(reasonInput, 'Revised staffing risk'));
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(onSaveCommercialAdjustment).toHaveBeenCalledWith({
      commercialAdjustment: '57000',
      commercialReason: 'Revised staffing risk',
    });
  });

  function accrualInput() {
    return container.querySelector('input[aria-describedby="manual-accrual-help"]');
  }

  function changeInput(element, value) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor.set.call(element, value);
    const tracker = element._valueTracker;
    if (tracker) tracker.setValue('');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  it('recomputes system forecast and CTC from commitment, not stale £0 forecast', () => {
    renderDrawer({
      row: {
        ...baseRow,
        manualAccrual: 100,
        systemForecast: 0,
        finalForecast: 0,
        costToComplete: -100,
        currentCost: 100,
      },
    });
    const text = container.textContent;
    expect(text).toMatch(/50[,\s]?250/);
    expect(text).toMatch(/2[,\s]?150/);
    expect(text).toMatch(/50[,\s]?150/);
    expect(text).not.toMatch(/-100\.00/);
    expect(text).toMatch(/Save commercial adjustment/);
    expect(text).toMatch(/Save accrual/);
  });

  it('typing accrual does not call a mutation', () => {
    const { onSaveNotes, onSaveCommercialAdjustment } = renderDrawer();
    act(() => {
      changeInput(accrualInput(), '100');
    });
    expect(onSaveNotes).not.toHaveBeenCalled();
    expect(onSaveCommercialAdjustment).not.toHaveBeenCalled();
  });

  it('blur accrual does not call a mutation', () => {
    const { onSaveNotes } = renderDrawer();
    act(() => {
      const input = accrualInput();
      changeInput(input, '100');
      input.dispatchEvent(new Event('blur', { bubbles: true }));
    });
    expect(onSaveNotes).not.toHaveBeenCalled();
  });

  function accrualSaveButton() {
    return container.querySelector('.dev-cvr-drawer__save-accrual');
  }

  function expectInactivePrimarySave(button) {
    expect(button.classList.contains('po-btn-primary')).toBe(true);
    expect(button.classList.contains('po-list-btn-secondary')).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toMatch(/no unsaved accrual changes/i);
  }

  function expectActivePrimarySave(button) {
    expect(button.classList.contains('po-btn-primary')).toBe(true);
    expect(button.classList.contains('po-list-btn-secondary')).toBe(false);
    expect(button.disabled).toBe(false);
  }

  it('Save accrual is disabled until the typed value differs from the saved accrual', () => {
    const { onSaveNotes } = renderDrawer({
      row: { ...baseRow, manualAccrual: 100, currentCost: 100 },
    });
    const button = accrualSaveButton();
    expect(button.disabled).toBe(true);
    act(() => {
      changeInput(accrualInput(), '100');
    });
    expect(button.disabled).toBe(true);
    act(() => {
      changeInput(accrualInput(), '150');
    });
    expect(button.disabled).toBe(false);
    expect(onSaveNotes).not.toHaveBeenCalled();
  });

  it('Save accrual uses the same green dirty-state styling as commercial adjustment', async () => {
    const onSaveNotes = vi.fn(async () => ({ ok: true, costCentre: { manualAccrual: 100 } }));
    renderDrawer({ onSaveNotes });
    expectInactivePrimarySave(accrualSaveButton());

    await act(async () => {
      changeInput(accrualInput(), '100');
    });
    expectActivePrimarySave(accrualSaveButton());

    await act(async () => {
      accrualSaveButton().click();
    });
    expect(onSaveNotes).toHaveBeenCalledWith({ manualAccrual: 100 });

    renderDrawer({
      onSaveNotes,
      row: { ...baseRow, manualAccrual: 100, currentCost: 100 },
    });
    expectInactivePrimarySave(accrualSaveButton());
  });

  it('Save accrual persists the typed value', async () => {
    const { onSaveNotes, onSaveCommercialAdjustment } = renderDrawer();
    await act(async () => {
      changeInput(accrualInput(), '100');
    });
    await act(async () => {
      container.querySelector('.dev-cvr-drawer__save-accrual').click();
    });
    expect(onSaveNotes).toHaveBeenCalledWith({ manualAccrual: 100 });
    expect(onSaveCommercialAdjustment).not.toHaveBeenCalled();
  });

  it('Save commercial adjustment is disabled until adjustment or reason actually changes', () => {
    renderDrawer({
      row: {
        ...baseRow,
        commercialAdjustment: 500,
        commercialReason: 'QS overlay',
      },
    });
    expect(container.querySelector('.dev-cvr-drawer__save-adjustment').disabled).toBe(true);
  });

  it('Save commercial adjustment stays disabled when only unsaved accrual is typed', async () => {
    const { onSaveNotes, onSaveCommercialAdjustment } = renderDrawer();
    await act(async () => {
      changeInput(accrualInput(), '100');
    });
    const adjustmentButton = container.querySelector('.dev-cvr-drawer__save-adjustment');
    expect(adjustmentButton.disabled).toBe(true);
    await act(async () => {
      adjustmentButton.click();
    });
    expect(onSaveNotes).not.toHaveBeenCalled();
    expect(onSaveCommercialAdjustment).not.toHaveBeenCalled();
  });

  it('Save commercial adjustment does not send unsaved accrual', async () => {
    const { onSaveNotes, onSaveCommercialAdjustment } = renderDrawer();
    const adjustmentInput = () =>
      container.querySelector('input[aria-describedby="commercial-adjustment-help"]');
    const reasonInput = () => container.querySelector('.dev-cvr-drawer__reason-field input');
    await act(async () => {
      changeInput(accrualInput(), '100');
      changeInput(adjustmentInput(), '500');
    });
    await act(async () => {
      changeInput(reasonInput(), 'QS overlay');
    });
    await act(async () => {
      container.querySelector('.dev-cvr-drawer__save-adjustment').click();
    });
    expect(onSaveNotes).not.toHaveBeenCalled();
    expect(onSaveCommercialAdjustment).toHaveBeenCalledWith({
      commercialAdjustment: '500',
      commercialReason: 'QS overlay',
    });
  });

  it('failed accrual save preserves the typed value and shows 409', async () => {
    const onSaveNotes = vi.fn(async () => ({
      ok: false,
      status: 409,
      errors: ['Cost-code input version conflict.'],
    }));
    renderDrawer({ onSaveNotes });
    await act(async () => {
      changeInput(accrualInput(), '100');
    });
    await act(async () => {
      container.querySelector('.dev-cvr-drawer__save-accrual').click();
    });
    expect(accrualInput().value).toBe('100');
    expect(container.textContent).toMatch(/version conflict/i);
    expectActivePrimarySave(accrualSaveButton());
  });

  it('shows one adjustment-scoped server failure without duplicating it in the drawer', async () => {
    const onSaveCommercialAdjustment = vi.fn(async () => ({
      ok: false,
      status: 409,
      errors: ['Budget is managed from Development Budget.'],
    }));
    renderDrawer({
      row: { ...baseRow, commercialAdjustment: 8000, commercialReason: 'Existing' },
      onSaveCommercialAdjustment,
    });
    const adjustment = container.querySelector(
      'input[aria-describedby="commercial-adjustment-help"]'
    );
    const reason = container.querySelector('.dev-cvr-drawer__reason-field input');
    await act(async () => {
      changeInput(adjustment, '9000');
      changeInput(reason, 'Updated reason');
      container.querySelector('.dev-cvr-drawer__save-adjustment').click();
    });

    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]').textContent).toMatch(/Budget is managed/);
    expect(adjustment.value).toBe('9000');
    expectActivePrimarySave(container.querySelector('.dev-cvr-drawer__save-adjustment'));
  });

  it('shows saved confirmation and becomes clean when the authoritative row refreshes', async () => {
    const onSaveCommercialAdjustment = vi.fn(async () => ({
      ok: true,
      costCentre: { commercialAdjustment: 9000, commercialReason: 'Updated reason' },
    }));
    const initialRow = {
      ...baseRow,
      commercialAdjustment: 8000,
      commercialReason: 'Existing',
    };
    renderDrawer({ row: initialRow, onSaveCommercialAdjustment });
    await act(async () => {
      changeInput(
        container.querySelector('input[aria-describedby="commercial-adjustment-help"]'),
        '9000'
      );
      changeInput(container.querySelector('.dev-cvr-drawer__reason-field input'), 'Updated reason');
      container.querySelector('.dev-cvr-drawer__save-adjustment').click();
    });
    expect(container.querySelector('[role="status"]').textContent).toMatch(/saved/i);

    renderDrawer({
      row: {
        ...initialRow,
        commercialAdjustment: 9000,
        commercialReason: 'Updated reason',
      },
      onSaveCommercialAdjustment,
    });
    expect(container.querySelector('.dev-cvr-drawer__save-adjustment').disabled).toBe(true);
    expect(container.textContent).toMatch(/Commercial adjustment saved/i);
  });
});
