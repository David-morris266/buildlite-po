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
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrPeriodListDelay,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';
import CVRRegister from './CVRRegister';

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
      buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV.id, periodKey: 'P01' })
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
});
