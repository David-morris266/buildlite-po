// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CommercialReadinessCard } from './DevelopmentOverview';
import { firstCvrCreationState } from '../cvr/cvrFirstPeriodReadiness';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let container;
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = null; container = null; });

function render(readiness, onResolve = vi.fn()) {
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  act(() => root.render(<CommercialReadinessCard readiness={readiness} onResolve={onResolve} />));
  return { onResolve, text: () => container.textContent };
}

describe('Development commercial readiness', () => {
  it('promotes blockers and attention while hiding routine ready items', () => {
    const view = render({ overallState: 'blocker', canCreateFirstCvr: true, items: [
      { key: 'revenue', state: 'blocker', title: 'Revenue', reason: 'Revenue settings are missing.', resolutionTarget: { tab: 'revenue' } },
      { key: 'ledger', state: 'needs_attention', title: 'Purchase ledger', reason: 'Confirm £0 actuals.', resolutionTarget: { tab: 'ledger' } },
      { key: 'packages', state: 'ready', title: 'Packages', reason: 'No packages recorded.' },
    ] });
    expect(view.text()).toContain('Revenue'); expect(view.text()).toContain('Purchase ledger');
    expect(view.text()).not.toContain('No packages recorded.');
    expect(view.text()).toContain('Ready to create the first working CVR.');
    act(() => container.querySelector('button').click());
    expect(view.onResolve).toHaveBeenCalledWith({ tab: 'revenue' });
  });

  it('shows the clean Ready state without a giant checklist', () => {
    const view = render({ overallState: 'ready', canCreateFirstCvr: true, items: [{ key: 'budget', state: 'ready', title: 'Development Budget', reason: 'Ready' }] });
    expect(view.text()).toContain('No commercial readiness issues require attention.');
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });

  it('presents an established open CVR as workflow state without first-CVR or blocker wording', () => {
    const view = render({ overallState: 'needs_attention', canCreateFirstCvr: false, hasCvrHistory: true, items: [
      { key: 'cvr_periods', state: 'needs_attention', workflowState: true, title: 'CVR in progress', reason: 'P02 is draft. Continue the current CVR before creating another.', openPeriod: { periodKey: 'P02' }, resolutionTarget: { tab: 'cvr', periodKey: 'P02' } },
      { key: 'prelims', state: 'needs_attention', title: 'Prelims', reason: 'Prelims are not configured.', resolutionTarget: { tab: 'prelims' } },
      { key: 'selling_costs', state: 'needs_attention', title: 'Selling Costs', reason: 'Selling Costs are not configured.', resolutionTarget: { tab: 'selling-costs' } },
    ] });
    expect(view.text()).toContain('Needs attention');
    expect(view.text()).toContain('P02 is in progress.');
    expect(view.text()).toContain('2 items to review');
    expect(view.text()).not.toContain('starting the first CVR');
    const buttons = [...container.querySelectorAll('button')];
    expect(buttons[0].textContent).toBe('Continue current CVR');
    act(() => buttons[0].click());
    expect(view.onResolve).toHaveBeenCalledWith({ tab: 'cvr', periodKey: 'P02' });
  });

  it('fails first-period creation closed while preserving existing period access', () => {
    expect(firstCvrCreationState({ rowCount: 0, readiness: null }).blocked).toBe(true);
    expect(firstCvrCreationState({ rowCount: 0, readiness: { canCreateFirstCvr: false } }).blocked).toBe(true);
    expect(firstCvrCreationState({ rowCount: 0, readiness: { canCreateFirstCvr: true } }).blocked).toBe(false);
    expect(firstCvrCreationState({ rowCount: 1, readiness: null, error: 'unavailable' }).blocked).toBe(false);
  });
});
