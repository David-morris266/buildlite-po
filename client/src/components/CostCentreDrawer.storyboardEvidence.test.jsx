/** @vitest-environment jsdom */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CostCentreDrawer from './CostCentreDrawer';

const base = {
  id: '5545', costCodeKey: '5545', costCodeLabel: '5545 — Plot Fencing',
  currentBudget: 127166.2, committed: 126894.54, certified: 0, actualCost: 0,
  currentCost: 0, uncommittedForecast: 271.66, changeExposure: 0,
  commercialAdjustment: 0, manualAccrual: 0, systemForecast: 127166.2,
  finalForecast: 127166.2, costToComplete: 127166.2, variance: 0,
  displayMetadata: { commercialEvidence: {
    version: 'cvr_commercial_evidence_v1', captured: true,
    commitment: { count: 2, total: 126894.54, supportingTotal: 126894.54, reconciliation: 'reconciled', items: [
      { type: 'purchase_order', id: 'S0016', reference: 'S0016', description: 'Boundary Fencing', includedAmount: 125894.54, status: 'approved', authority: { actor: 'Commercial Director', at: '2026-10-30T10:00:00.000Z', action: 'Approved PO' }, navigation: { type: 'package', orderKey: 'pkg-1', tab: 'overview' } },
      { type: 'variation_order', id: 'vo-1', reference: 'S0016/VO-0001', description: 'Fencing uplift', includedAmount: 1000, status: 'issued', authority: { actor: 'Commercial Director', at: '2026-11-02T09:00:00.000Z', action: 'Issued VO' }, navigation: { type: 'package', orderKey: 'pkg-1', tab: 'variations' } },
    ] },
    exposure: { count: 0, total: 0, reconciliation: 'reconciled', items: [] }, certified: { count: 0, total: 0, items: [] },
    actual: { count: 0, sourceCount: 0, omittedCount: 0, total: 0, items: [] },
    qsJudgement: { count: 0, total: 0, items: [] },
  } }, adjustmentHistory: [],
};

describe('Cost Code Storyboard governed commercial evidence', () => {
  let node; let root;
  beforeEach(() => { node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node); });
  afterEach(() => { act(() => root.unmount()); node.remove(); });

  function render(props = {}) {
    act(() => root.render(<CostCentreDrawer open storyboard sideBySide row={props.row || base}
      movement={props.movement} historic={props.historic} onClose={vi.fn()}
      onOpenCommercialEvidence={props.onOpenCommercialEvidence} />));
  }

  it('leads with the deterministic fencing explanation and exposes actor-backed source evidence', () => {
    const open = vi.fn();
    render({ movement: { comparable: true, movement: 0, bridge: { committed: 1000, uncommittedForecast: -1000 },
      previousCommercialEvidence: { captured: true, commitment: { reconciliation: 'reconciled', items: [{ type: 'purchase_order', id: 'S0016', includedAmount: 125894.54 }] } } },
      onOpenCommercialEvidence: open });
    expect(node.textContent).toContain('Commercial position changed; EFC unchanged');
    expect(node.textContent).toContain('existing allowance absorbed the commitment change');
    const disclosure = [...node.querySelectorAll('details')].find((item) => item.querySelector('summary')?.textContent === 'Supporting commercial evidence');
    expect(disclosure.textContent).toContain('S0016/VO-0001');
    expect(disclosure.textContent).toContain('Issued VO by Commercial Director');
    const buttons = [...disclosure.querySelectorAll('button')].filter((button) => button.textContent === 'Open record');
    act(() => buttons[1].click());
    expect(open).toHaveBeenCalledWith({ type: 'package', orderKey: 'pkg-1', tab: 'variations' });
  });

  it('shows missing governing actor as not recorded instead of substituting another actor', () => {
    const row = structuredClone(base);
    row.displayMetadata.commercialEvidence.commitment.items[1].authority = { actor: null, at: null, action: 'Issued VO' };
    render({ row });
    const disclosure = [...node.querySelectorAll('details')].find((item) => item.querySelector('summary')?.textContent === 'Supporting commercial evidence');
    expect(disclosure.textContent).toContain('Issued VO by Not recorded');
  });

  it('never substitutes current evidence for a legacy locked snapshot', () => {
    render({ row: { ...base, displayMetadata: {} }, historic: true });
    expect(node.textContent).toContain('Record-level commercial evidence was not captured for this historic CVR');
    expect(node.textContent).not.toContain('S0016/VO-0001');
  });
});
