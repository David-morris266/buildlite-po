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
