/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const cvrAuthorityEnabled = vi.hoisted(() => ({ value: false }));
const listPOs = vi.hoisted(() => vi.fn());

vi.mock('../cvr/cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthorityEnabled.value,
}));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  getCvrMutationCallCounts,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrPeriodListDelay,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';
import { formatCvrSubmissionBlockers } from '../cvr/cvrSubmissionBlockerPresentation';
import CVRWorkspace from './CVRWorkspace';

const DEV = {
  id: 'dev-cvr-ws',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
};
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

describe('CVRWorkspace input hydration (BL-031B)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthorityEnabled.value = true;
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    localStorage.clear();
    listPOs.mockResolvedValue([]);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function flush() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('rerenders worksheet after period input hydration', async () => {
    setCvrPeriodListDelay(30);
    seedMockCvrPeriod(
      DEV.id,
      buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id })
    );
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({
        periodId: PERIOD_ID,
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        originalBudget: 10000,
      }),
    ]);

    await act(async () => {
      root.render(<CVRWorkspace development={DEV} periodKey="P01" />);
    });

    expect(container.textContent).toContain('Loading CVR data…');
    expect(container.textContent).not.toContain('5231');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    await flush();

    expect(container.textContent).toContain('5231');
    expect(container.textContent).toContain('Cleaning');
    expect(container.textContent).not.toContain('Loading CVR data…');
    expect(container.textContent).toContain('Add Cost Code');
    expect(container.textContent).toContain('Import Budget');
    expect(getCvrMutationCallCounts().addMember).toBe(0);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
    const closedWorkbench = container.querySelector('.dev-cvr__workbench');
    expect(closedWorkbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(false);
    expect(closedWorkbench.children).toHaveLength(1);

    const rowButton = [...container.querySelectorAll('button')].find((button) => button.textContent === '5231');
    act(() => rowButton.click());
    const storyboard = document.body.querySelector('[aria-label*="Cost Code Storyboard for 5231"]');
    expect(storyboard).not.toBeNull();
    expect(storyboard.textContent).toContain('Manual Accrual');
    expect(storyboard.textContent).toContain('Commercial Adjustment');
    expect(container.querySelector('[data-expanded-for]')).toBeNull();
    expect(container.querySelector('.dev-cvr__workbench').children).toHaveLength(1);
    expect(container.querySelector('[role="region"][aria-label="CVR cost code grid"]')).not.toBeNull();
    act(() => [...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Back to Worksheet').click());
    await act(async () => { await Promise.resolve(); });
    expect(document.body.querySelector('[aria-label*="Cost Code Storyboard for 5231"]')).toBeNull();
    expect(document.activeElement).toBe(rowButton);
    expect(container.textContent).toContain('5231');
  });

  it('uses exactly two workbench panes only while a wide Storyboard is open', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1400, height: 600, top: 0, right: 1400, bottom: 600, left: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id }));
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({ periodId: PERIOD_ID, costCodeKey: '3640', costCodeLabel: '3640 — Planting' })]);
    await act(async () => { root.render(<CVRWorkspace development={DEV} periodKey="P01" />); });
    await flush(); await flush();

    let workbench = container.querySelector('.dev-cvr__workbench');
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(false);
    expect(workbench.children).toHaveLength(1);
    const rowButton = [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '3640');
    act(() => rowButton.click());
    workbench = container.querySelector('.dev-cvr__workbench');
    expect(workbench.classList.contains('dev-cvr__workbench--storyboard-open')).toBe(true);
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(true);
    expect(workbench.children).toHaveLength(2);
    expect(workbench.querySelector('.dev-cvr-storyboard--side')).not.toBeNull();
    expect(workbench.querySelector('[data-expanded-for]')).toBeNull();

    act(() => [...workbench.querySelectorAll('button')].find((button) => button.textContent === 'Close').click());
    await act(async () => { await Promise.resolve(); });
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(false);
    expect(workbench.children).toHaveLength(1);
    expect(document.activeElement).toBe(rowButton);
    rect.mockRestore();
  });

  it('transitions an open Storyboard between adjacent and focused-sheet modes on live resize', async () => {
    let measuredWidth = 1400;
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      width: measuredWidth, height: 600, top: 0, right: measuredWidth, bottom: 600,
      left: 0, x: 0, y: 0, toJSON: () => ({}),
    }));
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id }));
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({
      periodId: PERIOD_ID,
      costCodeKey: '6170',
      costCodeLabel: '6170 — Sales Office Set-up',
      commercialAdjustment: 115062.5,
      adjustmentReason: 'Selling Costs forecast adopted — 2027-02',
      displayMetadata: { sellingCostsAdoption: {
        adoptedAdjustment: 115062.5,
        adoptedAt: '2026-09-20T18:48:21.413Z',
        adoptedBy: 'David Morris',
        reportingMonth: '2027-02',
        superseded: false,
      } },
      adjustmentHistory: [{
        id: 'adj-selling-costs-6170', source: 'selling_costs_adoption',
        newAdjustment: 115062.5,
        newReason: 'Selling Costs forecast adopted — 2027-02',
        date: '2026-09-20T18:48:21.413Z', user: 'David Morris',
      }],
    })]);
    await act(async () => { root.render(<CVRWorkspace development={DEV} periodKey="P01" />); });
    await flush(); await flush();

    const rowButton = [...container.querySelectorAll('.dev-cvr__row-link')]
      .find((button) => button.textContent === '6170');
    act(() => rowButton.click());
    await flush();
    let workbench = container.querySelector('.dev-cvr__workbench');
    let storyboard = workbench.querySelector('.dev-cvr-storyboard--side');
    expect(storyboard).not.toBeNull();
    expect(storyboard.getAttribute('role')).toBe('region');
    expect(storyboard.textContent).toContain('Selling Costs forecast adopted');
    expect(document.body.querySelectorAll('[aria-label*="Cost Code Storyboard for 6170"]')).toHaveLength(1);

    measuredWidth = 1359;
    await act(async () => window.dispatchEvent(new Event('resize')));
    await flush();
    workbench = container.querySelector('.dev-cvr__workbench');
    storyboard = document.body.querySelector('.dev-cvr-storyboard--sheet');
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(false);
    expect(storyboard).not.toBeNull();
    expect(storyboard.getAttribute('role')).toBe('dialog');
    expect(storyboard.textContent).toContain('Selling Costs forecast adopted');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.body.querySelectorAll('[aria-label*="Cost Code Storyboard for 6170"]')).toHaveLength(1);

    measuredWidth = 1400;
    await act(async () => window.dispatchEvent(new Event('resize')));
    await flush();
    workbench = container.querySelector('.dev-cvr__workbench');
    storyboard = workbench.querySelector('.dev-cvr-storyboard--side');
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(true);
    expect(storyboard).not.toBeNull();
    expect(storyboard.textContent).toContain('Selling Costs forecast adopted');
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.body.style.overflow).toBe('');
    expect(document.body.querySelectorAll('[aria-label*="Cost Code Storyboard for 6170"]')).toHaveLength(1);

    act(() => [...storyboard.querySelectorAll('button')].find((button) => button.textContent === 'Close').click());
    await flush();
    expect(document.body.querySelector('[aria-label*="Cost Code Storyboard for 6170"]')).toBeNull();
    expect(document.activeElement).toBe(rowButton);
    rect.mockRestore();
  });

  it('hydrates workflow-owned adjustment provenance into the production Storyboard row', async () => {
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id }));
    const reason = 'Prelims forecast adopted — 2027-02';
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({
      periodId: PERIOD_ID,
      costCodeKey: '2100',
      costCodeLabel: '2100 — Site Manager',
      commercialAdjustment: 57000,
      adjustmentReason: reason,
      displayMetadata: { prelimsAdoption: {
        adoptedAdjustment: 57000, adoptedAt: '2026-09-19T13:32:00.000Z',
        adoptedBy: 'David Morris', reportingMonth: '2027-02', superseded: false,
      } },
      adjustmentHistory: [{
        id: 'adj-prelims-1', source: 'prelims_adoption', newAdjustment: 57000,
        newReason: reason, date: '2026-09-19T13:32:00.000Z', user: 'David Morris',
      }],
    })]);
    await act(async () => { root.render(<CVRWorkspace development={DEV} periodKey="P01" />); });
    await flush(); await flush();
    const rowButton = [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '2100');
    act(() => rowButton.click());
    const storyboard = document.body.querySelector('[aria-label*="Cost Code Storyboard for 2100"]') || container.querySelector('[aria-label*="Cost Code Storyboard for 2100"]');
    expect(storyboard.textContent).toContain('+£57,000.00');
    expect(storyboard.textContent).toContain('Site Prelims forecast adopted');
    expect(storyboard.textContent).toContain('February 2027');
    expect(storyboard.querySelector('.dev-cvr-drawer__save-adjustment')).toBeNull();
  });

  it('keeps the focused-sheet fallback below the 1360px side-by-side capability threshold', async () => {
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 1359, height: 600, top: 0, right: 1359, bottom: 600, left: 0, x: 0, y: 0,
      toJSON: () => ({}),
    });
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id }));
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({ periodId: PERIOD_ID, costCodeKey: '3640', costCodeLabel: '3640 — Planting' })]);
    await act(async () => { root.render(<CVRWorkspace development={DEV} periodKey="P01" />); });
    await flush(); await flush();

    const rowButton = [...container.querySelectorAll('.dev-cvr__row-link')].find((button) => button.textContent === '3640');
    act(() => rowButton.click());
    const workbench = container.querySelector('.dev-cvr__workbench');
    expect(workbench.classList.contains('dev-cvr__workbench--side-by-side')).toBe(false);
    expect(workbench.children).toHaveLength(1);
    expect(document.body.querySelector('.dev-cvr-storyboard--sheet')).not.toBeNull();
    rect.mockRestore();
  });

  it('uses captured Cost Code membership for hierarchy drill-down and clears it explicitly', async () => {
    const onClearHierarchyFilter = vi.fn();
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id }));
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({ periodId: PERIOD_ID, costCodeKey: 'A', costCodeLabel: 'A — Included', currentBudget: 10 }),
      buildServerCvrInputFixture({ periodId: PERIOD_ID, costCodeKey: 'B', costCodeLabel: 'B — Excluded', currentBudget: 20 }),
    ]);
    await act(async () => {
      root.render(<CVRWorkspace development={DEV} periodKey="P01" hierarchyFilter={{ kind: 'commercial_head', headId: 'head-a', label: 'Duplicate name', costCodeKeys: [' A '] }} onClearHierarchyFilter={onClearHierarchyFilter} />);
    });
    await flush();
    await flush();
    expect(container.textContent).toContain('Included');
    expect(container.textContent).not.toContain('Excluded');
    expect(container.textContent).toContain('Showing hierarchy selection: Duplicate name');
    act(() => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear filter').click());
    expect(onClearHierarchyFilter).toHaveBeenCalledOnce();
  });
});

describe('CVR submission blocker presentation', () => {
  it('identifies a single forecast-pending VA clearly', () => {
    expect(formatCvrSubmissionBlockers([
      { reference: 'VA-0002', reason: 'forecast_unassessed' },
    ])).toBe('VA-0002 requires a QS Forecast before this CVR can be submitted.');
  });

  it('presents multiple structured blockers compactly', () => {
    expect(formatCvrSubmissionBlockers([
      { reference: 'VA-0002', reason: 'forecast_unassessed' },
      { reference: 'VA-0003', reason: 'incomplete_source_provenance' },
    ])).toBe(
      'Resolve these Variation Account exposure items before submitting:\n' +
      '• VA-0002 requires a QS Forecast before this CVR can be submitted.\n' +
      '• VA-0003 has incomplete variation authority evidence.'
    );
  });

  it('retains a readable fallback for an unfamiliar server reason', () => {
    expect(formatCvrSubmissionBlockers([
      { reference: 'VA-0004', reason: 'future_integrity_check' },
    ])).toBe('VA-0004 is not ready for CVR submission (future integrity check).');
  });
});
