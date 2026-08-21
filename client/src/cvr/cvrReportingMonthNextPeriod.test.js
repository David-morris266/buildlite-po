import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: true }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  resetCvrPeriodApiStore,
  seedMockCvrPeriod,
  buildServerCvrPeriodFixture,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodsReadyForDevelopment,
} from './cvrPeriodServerCache';
import {
  __resetCvrDraftCreateLockForTests,
  createNextCvrPeriod,
  listCvrPeriods,
} from './cvrPeriodStore';

const DEV = 'dev-bl033c-reporting-month';

describe('BL-033C Create Next reportingMonth', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    __resetCvrPeriodServerCacheForTests();
    __resetCvrDraftCreateLockForTests();
    resetCvrPeriodApiStore();
    storage.clear();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('copies previous reportingMonth + 1 onto a new period and leaves historic months untouched', async () => {
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        developmentId: DEV,
        periodKey: 'P01',
        status: 'locked',
        reportingMonth: '2026-01-01',
      })
    );
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    expect(created.period.periodKey).toBe('P02');
    expect(created.period.reportingMonth).toBe('2026-02');
    const historic = listCvrPeriods(DEV).find((period) => period.periodKey === 'P01');
    expect(historic.reportingMonth).toBe('2026-01-01');
  });

  it('does not invent today when previous reportingMonth is null', async () => {
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        developmentId: DEV,
        periodKey: 'P01',
        status: 'locked',
        reportingMonth: null,
      })
    );
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    expect(created.period.reportingMonth).toBeNull();
  });
});
