/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const cvrAuthorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../cvr/cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthorityEnabled.value,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  getCvrMutationCallCounts,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrMutationReject,
  setCvrPeriodListDelay,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';
import CVRRegister from './CVRRegister';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const DEV = {
  id: 'dev-cvr-register',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
};
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

describe('CVRRegister hydration (BL-031B)', () => {
  let networkGuard;
  let container;
  let root;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthorityEnabled.value = true;
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    localStorage.clear();
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

  it('shows loading then loaded period rows', async () => {
    setCvrPeriodListDelay(40);
    seedMockCvrPeriod(
      DEV.id,
      buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id, periodKey: 'P01', reportingMonth: '2026-09-01', createdAt: '2026-10-08T12:00:00.000Z' })
    );
    seedMockCvrInputs(PERIOD_ID, [buildServerCvrInputFixture({ periodId: PERIOD_ID })]);

    await act(async () => {
      root.render(<CVRRegister development={DEV} />);
    });

    expect(container.textContent).toContain('Loading CVR data…');
    expect(container.textContent).not.toContain('No CVR periods yet');
    expect(container.querySelector('button.po-btn-primary')).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 160));
    });
    await flush();

    expect(container.textContent).toContain('P01');
    expect(container.textContent).toContain('Reporting Period');
    expect(container.textContent).toContain('September 2026');
    expect(container.textContent).not.toContain('Loading CVR data…');
    expect(container.textContent).not.toContain('No CVR periods yet');
  });

  it('shows genuine empty period state only after load', async () => {
    setCvrPeriodListDelay(20);

    await act(async () => {
      root.render(<CVRRegister development={DEV} />);
    });
    expect(container.textContent).toContain('Loading CVR data…');
    expect(container.textContent).not.toContain('No CVR periods yet');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await flush();

    expect(container.textContent).toContain('No CVR periods yet');
    expect(container.textContent).not.toContain('Loading CVR data…');
  });

  it('does not offer create-P01 while unresolved', async () => {
    setCvrPeriodListDelay(80);

    await act(async () => {
      root.render(<CVRRegister development={DEV} />);
    });

    expect(container.textContent).toContain('Loading CVR data…');
    expect(container.textContent).not.toMatch(/Create New CVR Period/);
  });

  it('turns an Overview start request into the real first-period reporting-month workflow without creating early', async () => {
    await act(async () => {
      root.render(<CVRRegister
        development={DEV}
        commercialReadiness={{ canCreateFirstCvr: true, overallState: 'needs_attention' }}
        createRequestToken={1}
      />);
    });
    await flush();

    expect(document.body.textContent).toContain('Select the closed commercial month this CVR reports.');
    expect(document.body.textContent).toContain('Create P01');
    expect(getCvrMutationCallCounts().create).toBe(0);

    const cancel = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Cancel');
    act(() => cancel.click());
    expect(document.body.textContent).not.toContain('Select the closed commercial month this CVR reports.');

    await act(async () => {
      root.render(<CVRRegister
        development={DEV}
        commercialReadiness={{ canCreateFirstCvr: true, overallState: 'needs_attention' }}
        createRequestToken={2}
      />);
    });
    await flush();
    expect(document.body.textContent).toContain('Create P01');
    expect(getCvrMutationCallCounts().create).toBe(0);
  });

  it('creates exactly one first period from the requested workflow and opens the returned period', async () => {
    const onOpenPeriod = vi.fn();
    await act(async () => {
      root.render(<CVRRegister
        development={DEV}
        commercialReadiness={{ canCreateFirstCvr: true, overallState: 'ready' }}
        createRequestToken={1}
        onOpenPeriod={onOpenPeriod}
      />);
    });
    await flush();

    const input = document.body.querySelector('input[type="month"]');
    act(() => {
      input.value = '2026-08';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const create = [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Create P01');
    await act(async () => {
      create.click();
      create.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(onOpenPeriod).toHaveBeenCalledTimes(1);
    expect(onOpenPeriod).toHaveBeenCalledWith('P01');
  });

  it('renders a visible error when first-period creation fails', async () => {
    setCvrMutationReject();
    await act(async () => {
      root.render(<CVRRegister
        development={DEV}
        commercialReadiness={{ canCreateFirstCvr: true, overallState: 'ready' }}
        createRequestToken={1}
      />);
    });
    await flush();

    const input = document.body.querySelector('input[type="month"]');
    act(() => {
      input.value = '2026-08';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      [...document.body.querySelectorAll('button')].find(button => button.textContent === 'Create P01').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await flush();

    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/version conflict/i);
  });
});
