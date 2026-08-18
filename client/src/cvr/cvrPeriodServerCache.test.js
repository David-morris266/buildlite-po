import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  getCvrInputListCallCount,
  getCvrPeriodListCallCount,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrInputListReject,
  setCvrPeriodListDelay,
  setCvrPeriodListReject,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrInputsReadyForPeriod,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrInputs,
  getCachedCvrPeriods,
  getCvrInputLoadState,
  getCvrPeriodLoadState,
  refreshCvrPeriodsForDevelopment,
} from './cvrPeriodServerCache';

const DEV_A = 'dev-cvr-a';
const DEV_B = 'dev-cvr-b';
const PERIOD_A = '11111111-2222-4333-8444-aaaaaaaaaaaa';
const PERIOD_B = '11111111-2222-4333-8444-bbbbbbbbbbbb';

describe('cvrPeriodServerCache (BL-031B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('loads CVR periods from idle/loading into loaded', async () => {
    setCvrPeriodListDelay(20);
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));

    expect(getCvrPeriodLoadState(DEV_A)).toBe('idle');
    const pending = ensureCvrPeriodsReadyForDevelopment(DEV_A);
    expect(getCvrPeriodLoadState(DEV_A)).toBe('loading');
    await pending;
    expect(getCvrPeriodLoadState(DEV_A)).toBe('loaded');
    expect(getCachedCvrPeriods(DEV_A)).toHaveLength(1);
    expect(getCachedCvrPeriods(DEV_A)[0].periodKey).toBe('P01');
  });

  it('treats a loaded empty period list as genuine empty', async () => {
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    expect(getCvrPeriodLoadState(DEV_A)).toBe('loaded');
    expect(getCachedCvrPeriods(DEV_A)).toEqual([]);
  });

  it('records CVR cache error without collapsing to loaded empty', async () => {
    setCvrPeriodListReject();
    await expect(ensureCvrPeriodsReadyForDevelopment(DEV_A)).rejects.toThrow(/Unable to load CVR/);
    expect(getCvrPeriodLoadState(DEV_A)).toBe('error');
    expect(getCachedCvrPeriods(DEV_A)).toEqual([]);
  });

  it('loads period inputs from idle/loading into loaded', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    seedMockCvrInputs(PERIOD_A, [buildServerCvrInputFixture({ periodId: PERIOD_A })]);
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);

    setCvrPeriodListDelay(20);
    expect(getCvrInputLoadState(PERIOD_A)).toBe('idle');
    const pending = ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    expect(getCvrInputLoadState(PERIOD_A)).toBe('loading');
    await pending;
    expect(getCvrInputLoadState(PERIOD_A)).toBe('loaded');
    expect(getCachedCvrInputs(PERIOD_A)[0].manualAccrual).toBe(400);
  });

  it('deduplicates in-flight loads for the same development and period', async () => {
    setCvrPeriodListDelay(30);
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    seedMockCvrInputs(PERIOD_A, [buildServerCvrInputFixture({ periodId: PERIOD_A })]);

    const [first, second] = await Promise.all([
      ensureCvrPeriodsReadyForDevelopment(DEV_A),
      ensureCvrPeriodsReadyForDevelopment(DEV_A),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(getCvrPeriodListCallCount()).toBe(1);

    const [inputsA, inputsB] = await Promise.all([
      ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A),
      ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A),
    ]);
    expect(inputsA).toHaveLength(1);
    expect(inputsB).toHaveLength(1);
    expect(getCvrInputListCallCount()).toBe(1);
  });

  it('refresh replaces the cached period list', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    expect(getCachedCvrPeriods(DEV_A)).toHaveLength(1);

    seedMockCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({ id: PERIOD_B, developmentId: DEV_A, periodKey: 'P02' })
    );
    await refreshCvrPeriodsForDevelopment(DEV_A);
    expect(getCachedCvrPeriods(DEV_A).map((item) => item.periodKey)).toEqual(['P01', 'P02']);
  });

  it('isolates development A from development B', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    seedMockCvrPeriod(
      DEV_B,
      buildServerCvrPeriodFixture({ id: PERIOD_B, developmentId: DEV_B, periodKey: 'P03' })
    );

    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    await ensureCvrPeriodsReadyForDevelopment(DEV_B);

    expect(getCachedCvrPeriods(DEV_A).map((item) => item.periodKey)).toEqual(['P01']);
    expect(getCachedCvrPeriods(DEV_B).map((item) => item.periodKey)).toEqual(['P03']);
  });

  it('records input cache error without treating it as empty inputs', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    setCvrInputListReject();
    await expect(ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A)).rejects.toThrow();
    expect(getCvrInputLoadState(PERIOD_A)).toBe('error');
    expect(getCachedCvrInputs(PERIOD_A)).toEqual([]);
  });
});
