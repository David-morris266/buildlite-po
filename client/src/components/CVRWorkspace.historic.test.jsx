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

vi.mock('../commercial/commercialEvents', () => ({
  subscribeCommercialChanged: () => () => {},
}));

import {
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  resetCvrPeriodApiStore,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import { __resetCvrPeriodServerCacheForTests } from '../cvr/cvrPeriodServerCache';
import {
  CVR_HISTORIC_SNAPSHOT_BANNER,
  CVR_HISTORIC_UNAVAILABLE_MESSAGE,
} from '../cvr/cvrHistoricConstants';
import CVRWorkspace from './CVRWorkspace';

const DEV = {
  id: 'dev-cvr-historic',
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
};
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

describe('CVRWorkspace historic snapshot (BL-031E.4)', () => {
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it('renders locked snapshot values without edit/save controls', async () => {
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

    await act(async () => {
      root.render(
        <CVRWorkspace
          development={DEV}
          periodKey="P01"
          certificatesReady
        />
      );
    });
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain(CVR_HISTORIC_SNAPSHOT_BANNER);
    expect(text).toMatch(/50,250/);
    expect(text).toMatch(/2,150/);
    expect(text).toMatch(/50,750/);
    expect(text).not.toContain('Import Budget');
    expect(text).not.toContain('Add Cost Code');
    expect(text).not.toContain('Save accrual');
    expect(text).not.toContain('Save commercial adjustment');
    expect(container.querySelector('.dev-cvr__cell-input')).toBeNull();
  });

  it('shows the legacy historic-unavailable banner instead of live figures', async () => {
    seedMockCvrPeriod(
      DEV.id,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV.id,
        status: 'locked',
        snapshot: null,
        snapshotDeferred: true,
        approvedAt: '2026-04-01T12:00:00.000Z',
      })
    );

    await act(async () => {
      root.render(
        <CVRWorkspace
          development={DEV}
          periodKey="P01"
          certificatesReady
        />
      );
    });
    await flush();
    await flush();

    const text = container.textContent;
    expect(text).toContain(CVR_HISTORIC_UNAVAILABLE_MESSAGE);
    expect(text).not.toMatch(/50,250/);
    expect(text).not.toContain('Import Budget');
  });

  it('does not expose Add Cost Code or Import Budget on a submitted period', async () => {
    seedMockCvrPeriod(
      DEV.id,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV.id,
        status: 'submitted',
        snapshot: null,
      })
    );

    await act(async () => {
      root.render(
        <CVRWorkspace
          development={DEV}
          periodKey="P01"
          certificatesReady
        />
      );
    });
    await flush();
    await flush();

    expect(container.textContent).not.toContain('Add Cost Code');
    expect(container.textContent).not.toContain('Import Budget');
  });
});
