/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CostCentreDrawer from './CostCentreDrawer';
import {
  CVR_HISTORIC_DRAWER_NOTE,
} from '../cvr/cvrHistoricConstants';

const frozenRow = {
  id: 'snap-row-5231',
  costCodeKey: '5231',
  costCodeLabel: '5231 — Cleaning',
  originalBudget: 0,
  currentBudget: 0,
  committed: 50250,
  certified: 2150,
  actualCost: 0,
  manualAccrual: 100,
  currentCost: 100,
  outstandingCertified: 2150,
  outstandingCertifiedState: 'warning',
  commercialAdjustment: 500,
  commercialReason: 'BL-031D UAT test adjustment',
  adjustmentReason: 'BL-031D UAT test adjustment',
  systemForecast: 50250,
  finalForecast: 50750,
  costToComplete: 50650,
  variance: -50750,
  varianceState: 'overspend',
  notes: 'Frozen overlay',
  commercialNotes: 'Frozen overlay',
  adjustmentHistory: [
    {
      id: 'adj-1',
      previousAdjustment: 0,
      newAdjustment: 500,
      reason: 'BL-031D UAT test adjustment',
      user: 'QS',
      date: '2026-04-01T09:00:00.000Z',
    },
  ],
  historic: true,
};

describe('CostCentreDrawer historic snapshot (BL-031E.4)', () => {
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

  it('shows frozen values without edit controls or live evidence lists', () => {
    act(() => {
      root.render(
        <CostCentreDrawer
          open
          historic
          readOnly
          row={frozenRow}
          packages={[{ id: 'live-pkg', label: 'Wipe live evidence', committedValue: 999999 }]}
          ledgerRows={[{ id: 'live-txn', netAmount: 25000, supplier: 'Live' }]}
          certificates={[{ id: 'live-cert', certifiedValue: 8000, certificateNumber: 9 }]}
          onClose={vi.fn()}
          onSaveNotes={vi.fn()}
          onSaveCommercialAdjustment={vi.fn()}
        />
      );
    });

    const text = container.textContent;
    expect(text).toContain(CVR_HISTORIC_DRAWER_NOTE);
    expect(text).toMatch(/£50,250/);
    expect(text).toMatch(/£2,150/);
    expect(text).toMatch(/£100/);
    expect(text).toMatch(/£50,750/);
    expect(text).toContain('BL-031D UAT test adjustment');
    expect(text).toContain('Frozen overlay');
    expect(container.querySelector('.dev-cvr-drawer__save-accrual')).toBeNull();
    expect(container.querySelector('.dev-cvr-drawer__save-adjustment')).toBeNull();
    expect(container.querySelector('input[aria-describedby="manual-accrual-help"]')).toBeNull();
    expect(text).not.toContain('Wipe live evidence');
    expect(text).not.toContain('Packages');
    expect(text).not.toContain('Ledger Transactions');
    expect(text).not.toContain('Approved Certificates');
  });
});
