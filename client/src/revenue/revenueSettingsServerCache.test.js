import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/revenueSettings', () => import('../test/mockRevenueSettingsApi'));

import {
  buildServerRevenueSettingsFixture,
  getRevenueSettingsCallCounts,
  resetRevenueSettingsApiStore,
  seedMockRevenueSettings,
  setRevenueSettingsGetDelay,
  setRevenueSettingsGetReject,
} from '../test/mockRevenueSettingsApi';
import {
  __resetRevenueSettingsServerCacheForTests,
  ensureRevenueSettingsReady,
  getCachedRevenueSettings,
  getRevenueSettingsLoadState,
  getRevenueSettingsReadiness,
  refreshRevenueSettings,
  requireCachedRevenueSettings,
} from './revenueSettingsServerCache';

const DEV_A = 'dev-rev-a';
const DEV_B = 'dev-rev-b';

describe('revenueSettingsServerCache (BL-032A)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    __resetRevenueSettingsServerCacheForTests();
    resetRevenueSettingsApiStore();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('loads from idle/loading into loaded', async () => {
    setRevenueSettingsGetDelay(20);
    seedMockRevenueSettings(
      DEV_A,
      buildServerRevenueSettingsFixture({
        id: 'set-a',
        developmentId: DEV_A,
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 375, effectiveDate: '' } },
      })
    );

    expect(getRevenueSettingsLoadState(DEV_A)).toBe('idle');
    const pending = ensureRevenueSettingsReady(DEV_A);
    expect(getRevenueSettingsLoadState(DEV_A)).toBe('loading');
    await pending;
    expect(getRevenueSettingsLoadState(DEV_A)).toBe('loaded');
    expect(getCachedRevenueSettings(DEV_A).revenueStrategy.openMarket.ratePerFt2).toBe(375);
  });

  it('deduplicates in-flight loads', async () => {
    setRevenueSettingsGetDelay(30);
    seedMockRevenueSettings(
      DEV_A,
      buildServerRevenueSettingsFixture({ id: 'set-a', developmentId: DEV_A, exists: true, version: 1 })
    );

    await Promise.all([ensureRevenueSettingsReady(DEV_A), ensureRevenueSettingsReady(DEV_A)]);
    expect(getRevenueSettingsCallCounts().get).toBe(1);
  });

  it('isolates cache per development', async () => {
    seedMockRevenueSettings(
      DEV_A,
      buildServerRevenueSettingsFixture({
        id: 'set-a',
        developmentId: DEV_A,
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 111, effectiveDate: '' } },
      })
    );
    seedMockRevenueSettings(
      DEV_B,
      buildServerRevenueSettingsFixture({
        id: 'set-b',
        developmentId: DEV_B,
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 222, effectiveDate: '' } },
      })
    );

    await ensureRevenueSettingsReady(DEV_A);
    await ensureRevenueSettingsReady(DEV_B);
    expect(getCachedRevenueSettings(DEV_A).revenueStrategy.openMarket.ratePerFt2).toBe(111);
    expect(getCachedRevenueSettings(DEV_B).revenueStrategy.openMarket.ratePerFt2).toBe(222);
  });

  it('refresh reloads from the server', async () => {
    seedMockRevenueSettings(
      DEV_A,
      buildServerRevenueSettingsFixture({
        id: 'set-a',
        developmentId: DEV_A,
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 350, effectiveDate: '' } },
      })
    );
    await ensureRevenueSettingsReady(DEV_A);
    seedMockRevenueSettings(
      DEV_A,
      buildServerRevenueSettingsFixture({
        id: 'set-a',
        developmentId: DEV_A,
        exists: true,
        version: 2,
        revenueStrategy: { openMarket: { ratePerFt2: 400, effectiveDate: '' } },
      })
    );
    await refreshRevenueSettings(DEV_A);
    expect(getCachedRevenueSettings(DEV_A).revenueStrategy.openMarket.ratePerFt2).toBe(400);
    expect(getRevenueSettingsCallCounts().get).toBe(2);
  });

  it('error is not treated as loaded defaults', async () => {
    setRevenueSettingsGetReject();
    await expect(ensureRevenueSettingsReady(DEV_A)).rejects.toThrow(/Unable to load revenue settings/);
    expect(getRevenueSettingsLoadState(DEV_A)).toBe('error');
    expect(getCachedRevenueSettings(DEV_A)).toBeNull();
    expect(getRevenueSettingsReadiness(DEV_A).ready).toBe(false);
    expect(() => requireCachedRevenueSettings(DEV_A)).toThrow();
  });

  it('unresolved idle is not ready and is not a default record', () => {
    expect(getRevenueSettingsReadiness(DEV_A).ready).toBe(false);
    expect(getCachedRevenueSettings(DEV_A)).toBeNull();
    expect(() => requireCachedRevenueSettings(DEV_A)).toThrow(/have not loaded yet/);
  });
});
