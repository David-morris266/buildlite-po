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
  seedMockCvrInputs,
  buildServerCvrPeriodFixture,
  buildServerCvrInputFixture,
  getLastCreatePayload,
  getCvrMutationCallCounts,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrInputs,
} from './cvrPeriodServerCache';
import {
  __resetCvrDraftCreateLockForTests,
  createNextCvrPeriod,
  listCvrPeriods,
} from './cvrPeriodStore';
import { resolveCreateNextReportingMonthAction } from './cvrCreateNextReportingMonth';

const DEV = 'dev-bl033c1-reporting-month';

describe('BL-033C.1 Create Next reportingMonth', () => {
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
    vi.useRealTimers();
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function seedLocked(periodKey, reportingMonth, extras = {}) {
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        developmentId: DEV,
        periodKey,
        status: 'locked',
        reportingMonth,
        ...extras,
      })
    );
  }

  it('does not suggest a month when previous reportingMonth is null', async () => {
    await seedLocked('P03', null);
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const action = resolveCreateNextReportingMonthAction(DEV);
    expect(action.kind).toBe('prompt');
    expect(action.suggestedMonth).toBeNull();
    expect(action.requiresExplicitSelection).toBe(true);
    expect(action.nextPeriodKey).toBe('P04');
  });

  it('suggests previous 2026-08 as 2026-09', async () => {
    await seedLocked('P01', '2026-08-01');
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const action = resolveCreateNextReportingMonthAction(DEV);
    expect(action.suggestedMonth).toBe('2026-09');
    expect(action.requiresExplicitSelection).toBe(false);
    expect(action.nextPeriodKey).toBe('P02');
  });

  it('copies previous reportingMonth + 1 onto a new period and leaves historic months untouched', async () => {
    await seedLocked('P01', '2026-01-01');
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    expect(created.period.periodKey).toBe('P02');
    expect(created.period.reportingMonth).toBe('2026-02');
    const historic = listCvrPeriods(DEV).find((period) => period.periodKey === 'P01');
    expect(historic.reportingMonth).toBe('2026-01-01');
  });

  it('does not invent today when previous reportingMonth is null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-03-15T12:00:00.000Z'));
    await seedLocked('P01', null);
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    expect(created.period.reportingMonth).toBeNull();
    expect(getLastCreatePayload()?.payload?.reportingMonth).toBeFalsy();
    vi.useRealTimers();
  });

  it('persists an explicit month on the new period only', async () => {
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: 'period-p01-historic',
        developmentId: DEV,
        periodKey: 'P01',
        status: 'locked',
        reportingMonth: null,
      })
    );
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: 'period-p02-historic',
        developmentId: DEV,
        periodKey: 'P02',
        status: 'locked',
        reportingMonth: null,
      })
    );
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: 'period-p03-historic',
        developmentId: DEV,
        periodKey: 'P03',
        status: 'locked',
        reportingMonth: null,
      })
    );
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV, { reportingMonth: '2026-09' });
    expect(created.ok).toBe(true);
    expect(created.period.periodKey).toBe('P04');
    expect(created.period.reportingMonth).toBe('2026-09');
    expect(getLastCreatePayload()).toMatchObject({
      developmentId: DEV,
      payload: { periodKey: 'P04', reportingMonth: '2026-09' },
    });
    const historic = listCvrPeriods(DEV).filter((period) => period.periodKey !== 'P04');
    expect(historic).toHaveLength(3);
    expect(historic.every((period) => period.reportingMonth == null)).toBe(true);
  });

  it('rejects an invalid explicit YYYY-MM and does not create a period', async () => {
    await seedLocked('P01', null);
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV, { reportingMonth: '2026-13' });
    expect(created.ok).toBe(false);
    expect(created.errors[0]).toMatch(/YYYY-MM/i);
    expect(getCvrMutationCallCounts().create).toBe(0);
    expect(listCvrPeriods(DEV).map((period) => period.periodKey)).toEqual(['P01']);
  });

  it('does not infer a reporting month from the period key', async () => {
    await seedLocked('P03', null);
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const action = resolveCreateNextReportingMonthAction(DEV);
    expect(action.suggestedMonth).toBeNull();
    const created = await createNextCvrPeriod(DEV);
    expect(created.period.reportingMonth).toBeNull();
    expect(created.period.periodKey).toBe('P04');
  });

  it('still copies QS opening inputs when an explicit reporting month is supplied', async () => {
    const p01 = buildServerCvrPeriodFixture({
      id: 'period-p01-qs',
      developmentId: DEV,
      periodKey: 'P01',
      status: 'locked',
      reportingMonth: null,
    });
    seedMockCvrPeriod(DEV, p01);
    seedMockCvrInputs(p01.id, [
      buildServerCvrInputFixture({
        periodId: p01.id,
        costCodeKey: '5231',
        costCodeLabel: 'Cleaning',
        originalBudget: 50000,
        currentBudget: 50000,
        manualAccrual: 100,
        commercialAdjustment: 0,
      }),
    ]);
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const created = await createNextCvrPeriod(DEV, { reportingMonth: '2026-09' });
    expect(created.ok).toBe(true);
    expect(created.copied).toBe(true);
    expect(created.period.reportingMonth).toBe('2026-09');
    expect(getCachedCvrInputs(created.period.id)).toHaveLength(1);
    expect(getCachedCvrInputs(created.period.id)[0].costCodeKey).toBe('5231');
    expect(getCachedCvrInputs(created.period.id)[0].manualAccrual).toBe(100);
  });
});
