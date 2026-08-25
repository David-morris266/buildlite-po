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
  });
});
