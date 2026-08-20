/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const cvrAuthorityEnabled = vi.hoisted(() => ({ value: true }));
const listPOs = vi.hoisted(() => vi.fn(async () => []));
const createNextCvrPeriod = vi.hoisted(() =>
  vi.fn(async () => ({ ok: true, periodKey: 'P02' }))
);

vi.mock('../cvr/cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthorityEnabled.value,
}));

vi.mock('../revenue/revenueAuthority', () => ({
  isRevenueServerAuthorityEnabled: () => false,
}));

vi.mock('../api', () => ({
  listPOs,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

vi.mock('../commercial/commercialEvents', () => ({
  subscribeCommercialChanged: () => () => {},
}));

vi.mock('../cvr/cvrPeriodStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createNextCvrPeriod: (...args) => createNextCvrPeriod(...args),
  };
});

vi.mock('../cvr/cvrPeriodHelpers', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createNextCvrPeriod: (...args) => createNextCvrPeriod(...args),
  };
});

import {
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  resetCvrPeriodApiStore,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';
import CVRSummaryPage from './CVRSummaryPage';
import CVRWorkspace from './CVRWorkspace';

const DEV = {
  id: 'dev-cvr-next-nav',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
};
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

describe('Create Next Period navigation (BL-031F)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthorityEnabled.value = true;
    createNextCvrPeriod.mockClear();
    createNextCvrPeriod.mockResolvedValue({ ok: true, periodKey: 'P02' });
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    localStorage.clear();
    listPOs.mockResolvedValue([]);
    seedMockCvrPeriod(
      DEV.id,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV.id,
        status: 'locked',
        snapshot: buildServerCvrSnapshotFixture({
          developmentId: DEV.id,
          periodId: PERIOD_ID,
        }),
        snapshotDeferred: false,
        approvedAt: '2026-04-01T12:00:00.000Z',
      })
    );
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('Summary success returns to the CVR Register', async () => {
    const onBackToRegister = vi.fn();
    await act(async () => {
      root.render(
        <CVRSummaryPage
          development={DEV}
          periodKey="P01"
          certificatesReady
          onBackToRegister={onBackToRegister}
        />
      );
    });
    await flush();
    await flush();

    const button = [...container.querySelectorAll('button')].find((item) =>
      /Create Next Period/i.test(item.textContent || '')
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
    await flush();
    expect(createNextCvrPeriod).toHaveBeenCalledWith(DEV.id);
    expect(onBackToRegister).toHaveBeenCalledTimes(1);
  });

  it('Worksheet success returns to the CVR Register', async () => {
    const onBackToRegister = vi.fn();
    const onBackToSummary = vi.fn();
    await act(async () => {
      root.render(
        <CVRWorkspace
          development={DEV}
          periodKey="P01"
          certificatesReady
          onBackToRegister={onBackToRegister}
          onBackToSummary={onBackToSummary}
        />
      );
    });
    await flush();
    await flush();

    const button = [...container.querySelectorAll('button')].find((item) =>
      /^Next Period$/i.test((item.textContent || '').trim())
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button.click();
    });
    await flush();
    expect(createNextCvrPeriod).toHaveBeenCalledWith(DEV.id);
    expect(onBackToRegister).toHaveBeenCalledTimes(1);
    expect(onBackToSummary).not.toHaveBeenCalled();
  });
});
