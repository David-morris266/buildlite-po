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
import { __resetCvrPeriodServerCacheForTests, ensureCvrPeriodsReadyForDevelopment } from '../cvr/cvrPeriodServerCache';
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

  it('Summary success returns to the CVR Register after a reporting month is chosen', async () => {
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
    expect(createNextCvrPeriod).not.toHaveBeenCalled();

    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    const input = dialog.querySelector('input[type="month"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter.call(input, '2026-09');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const create = [...dialog.querySelectorAll('button')].find((item) =>
      /Create P02/i.test(item.textContent || '')
    );
    await act(async () => {
      create.click();
    });
    await flush();
    expect(createNextCvrPeriod).toHaveBeenCalledWith(DEV.id, { reportingMonth: '2026-09' });
    expect(onBackToRegister).toHaveBeenCalledTimes(1);
  });

  it('Summary cancel leaves the period uncreated', async () => {
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
    await act(async () => {
      button.click();
    });
    await flush();
    const cancel = [...container.querySelectorAll('button')].find((item) =>
      /^Cancel$/i.test(item.textContent || '')
    );
    await act(async () => {
      cancel.click();
    });
    await flush();
    expect(createNextCvrPeriod).not.toHaveBeenCalled();
    expect(onBackToRegister).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Summary refreshes authoritative submitted state, warns when stale and gates approval only', async () => {
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({
      id: PERIOD_ID,
      developmentId: DEV.id,
      status: 'submitted',
      variationExposure: { state: 'submitted', captured: true, stale: false, staleReasons: [] },
    }));
    await ensureCvrPeriodsReadyForDevelopment(DEV.id);
    seedMockCvrPeriod(DEV.id, buildServerCvrPeriodFixture({
      id: PERIOD_ID,
      developmentId: DEV.id,
      status: 'submitted',
      submittedAt: '2026-09-03T12:46:18.711Z',
      variationExposure: {
        state: 'submitted',
        captured: true,
        stale: true,
        staleReasons: ['variation_exposure_sources_changed'],
        document: { calculationVersion: 'va_expected_exposure_v1', items: [{ variationAccountItemId: 'va-1', qsForecast: 17000, vaExposureUplift: 5000 }] },
      },
    }));
    await act(async () => {
      root.render(<CVRSummaryPage development={DEV} periodKey="P01" certificatesReady onContinueToCvr={vi.fn()} />);
    });
    await flush();
    await flush();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Variation exposure changed after this CVR was submitted');
    const labels = Array.from(container.querySelectorAll('button')).map(button => button.textContent.trim());
    expect(labels).not.toContain('Approve & Lock');
    expect(labels).toContain('Reject');
    expect(labels).toContain('Open CVR Read Only');
  });

  it('Worksheet success returns to the CVR Register after a reporting month is chosen', async () => {
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
    expect(createNextCvrPeriod).not.toHaveBeenCalled();
    const dialog = container.querySelector('[role="dialog"]');
    const input = dialog.querySelector('input[type="month"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter.call(input, '2026-09');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const create = [...dialog.querySelectorAll('button')].find((item) =>
      /Create P02/i.test(item.textContent || '')
    );
    await act(async () => {
      create.click();
    });
    await flush();
    expect(createNextCvrPeriod).toHaveBeenCalledWith(DEV.id, { reportingMonth: '2026-09' });
    expect(onBackToRegister).toHaveBeenCalledTimes(1);
    expect(onBackToSummary).not.toHaveBeenCalled();
  });
});
