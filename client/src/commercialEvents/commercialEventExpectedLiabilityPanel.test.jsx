/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommercialEventExpectedLiabilityPanel from '../components/CommercialEventExpectedLiabilityPanel';
import { COMMERCIAL_EVENT_STATUSES } from './commercialEventTypes';

function changeElement(element, value) {
  const proto =
    element.tagName === 'SELECT'
      ? window.HTMLSelectElement.prototype
      : element.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor.set.call(element, value);
  const tracker = element._valueTracker;
  if (tracker) tracker.setValue('');
  element.dispatchEvent(
    new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
  );
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function submittedEvent(overrides = {}) {
  return {
    id: 'ce-el-1',
    eventType: 'variation',
    financialTreatment: 'contractAmendment',
    relationshipType: null,
    status: COMMERCIAL_EVENT_STATUSES.submitted.key,
    value: 20000,
    expectedTreatment: 'default',
    expectedAmount: null,
    expectedReason: null,
    version: 2,
    ...overrides,
  };
}

describe('CommercialEventExpectedLiabilityPanel', () => {
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

  it('does not show an active control on draft', () => {
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({ status: COMMERCIAL_EVENT_STATUSES.draft.key })}
          onApply={vi.fn()}
        />
      );
    });
    expect(container.querySelector('[data-testid="ce-expected-liability-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="ce-expected-liability-readonly"]')).toBeNull();
  });

  it('shows default = full submitted value without requiring apply', () => {
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel event={submittedEvent()} onApply={vi.fn()} />
      );
    });
    expect(container.textContent).toContain('£20,000.00');
    expect(container.textContent).toContain('Default — full submitted value');
    expect(container.querySelector('[data-testid="ce-expected-default-hint"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ce-expected-apply"]')).toBeNull();
  });

  it('override requires amount and reason, and warns when above submitted', () => {
    const onApply = vi.fn();
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel event={submittedEvent()} onApply={onApply} />
      );
    });
    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-treatment"]'), 'override');
    });
    act(() => {
      container.querySelector('[data-testid="ce-expected-apply"]').click();
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="ce-expected-errors"]').textContent).toMatch(
      /reason|amount/i
    );

    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-amount"]'), '25000');
      changeElement(
        container.querySelector('[data-testid="ce-expected-reason"]'),
        'Likely extra instruction'
      );
    });
    expect(container.querySelector('[data-testid="ce-expected-above-warning"]')).toBeTruthy();
    act(() => {
      container.querySelector('[data-testid="ce-expected-apply"]').click();
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        treatment: 'override',
        expectedAmount: 25000,
        reason: 'Likely extra instruction',
      })
    );
  });

  it('hold and exclude require a reason', () => {
    const onApply = vi.fn();
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel event={submittedEvent()} onApply={onApply} />
      );
    });
    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-treatment"]'), 'hold');
    });
    act(() => {
      container.querySelector('[data-testid="ce-expected-apply"]').click();
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="ce-expected-errors"]').textContent).toMatch(
      /reason/i
    );
  });

  it('saved non-default treatment mutes Save until the form is edited', () => {
    const onApply = vi.fn();
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({
            expectedTreatment: 'override',
            expectedAmount: 15000,
            expectedReason: 'Likely negotiated settlement',
          })}
          onApply={onApply}
        />
      );
    });
    const saved = container.querySelector('[data-testid="ce-expected-apply"]');
    expect(saved).toBeTruthy();
    expect(saved.textContent).toBe('Saved');
    expect(saved.disabled).toBe(true);
    act(() => {
      saved.click();
    });
    expect(onApply).not.toHaveBeenCalled();

    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-amount"]'), '25000');
    });
    const dirtyAmount = container.querySelector('[data-testid="ce-expected-apply"]');
    expect(dirtyAmount.disabled).toBe(false);
    expect(dirtyAmount.textContent).toBe('Save expected treatment');

    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-amount"]'), '15000');
      changeElement(
        container.querySelector('[data-testid="ce-expected-reason"]'),
        'Further exposure anticipated'
      );
    });
    const dirtyReason = container.querySelector('[data-testid="ce-expected-apply"]');
    expect(dirtyReason.disabled).toBe(false);
    expect(dirtyReason.textContent).toBe('Save expected treatment');
  });

  it('restore default is available after override', () => {
    const onApply = vi.fn();
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({
            expectedTreatment: 'override',
            expectedAmount: 15000,
            expectedReason: 'Partial',
          })}
          onApply={onApply}
        />
      );
    });
    act(() => {
      changeElement(container.querySelector('[data-testid="ce-expected-treatment"]'), 'default');
    });
    act(() => {
      container.querySelector('[data-testid="ce-expected-apply"]').click();
    });
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ treatment: 'default' }));
  });

  it('approved and rejected are read-only / inactive', () => {
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({ status: COMMERCIAL_EVENT_STATUSES.approved.key })}
          onApply={vi.fn()}
        />
      );
    });
    expect(container.querySelector('[data-testid="ce-expected-liability-readonly"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ce-expected-treatment"]')).toBeNull();

    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({ status: COMMERCIAL_EVENT_STATUSES.rejected.key })}
          onApply={vi.fn()}
        />
      );
    });
    expect(container.querySelector('[data-testid="ce-expected-liability-readonly"]')).toBeTruthy();
  });

  it('shows conflict/error text from the parent', () => {
    act(() => {
      root.render(
        <CommercialEventExpectedLiabilityPanel
          event={submittedEvent({
            expectedTreatment: 'hold',
            expectedReason: 'Wait',
          })}
          error="This Commercial Event was updated by another user. Refresh and try again."
          onApply={vi.fn()}
        />
      );
    });
    expect(container.querySelector('[data-testid="ce-expected-errors"]').textContent).toMatch(
      /another user/i
    );
  });
});
