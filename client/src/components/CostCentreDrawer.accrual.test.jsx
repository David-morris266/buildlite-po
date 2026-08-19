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
          onClose={vi.fn()}
          onSaveNotes={onSaveNotes}
          onSaveCommercialAdjustment={onSaveCommercialAdjustment}
        />
      );
    });
    return { onSaveNotes, onSaveCommercialAdjustment };
  }

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
});
