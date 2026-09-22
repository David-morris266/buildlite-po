import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import { enrichCvrRow } from './cvrCalculations';
import { buildCvrPeriodComparison } from './cvrPeriodMovement';

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
  patchCachedCvrPeriod,
  refreshCvrPeriodsForDevelopment,
  refreshCvrInputsForPeriod,
  upsertCachedCvrInput,
  upsertCachedCvrPeriod,
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

  it('cache patch helpers insert and update periods/inputs', () => {
    const inserted = upsertCachedCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A, periodKey: 'P04' })
    );
    expect(inserted.periodKey).toBe('P04');
    expect(getCachedCvrPeriods(DEV_A)[0].periodKey).toBe('P04');
    patchCachedCvrPeriod(DEV_A, PERIOD_A, { status: 'submitted', version: 2 });
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('submitted');
    upsertCachedCvrInput(PERIOD_A, buildServerCvrInputFixture({ periodId: PERIOD_A, costCodeKey: '5218' }));
    expect(getCachedCvrInputs(PERIOD_A)[0].costCodeKey).toBe('5218');
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

  it('period-scoped input refresh performs a fresh authoritative GET and preserves unrelated caches', async () => {
    seedMockCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A, periodKey: 'P04' })
    );
    seedMockCvrPeriod(
      DEV_B,
      buildServerCvrPeriodFixture({ id: PERIOD_B, developmentId: DEV_B, periodKey: 'P02' })
    );
    seedMockCvrInputs(PERIOD_A, [
      buildServerCvrInputFixture({
        periodId: PERIOD_A,
        costCodeKey: '2100',
        commercialAdjustment: 0,
        manualAccrual: 125,
        version: 1,
      }),
      buildServerCvrInputFixture({
        id: 'input-unrelated-a',
        periodId: PERIOD_A,
        costCodeKey: '2101',
        commercialAdjustment: 0,
        version: 1,
      }),
    ]);
    seedMockCvrInputs(PERIOD_B, [
      buildServerCvrInputFixture({
        id: 'input-other-period',
        periodId: PERIOD_B,
        costCodeKey: '3100',
        commercialAdjustment: 50,
        version: 1,
      }),
    ]);
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    await ensureCvrPeriodsReadyForDevelopment(DEV_B);
    await ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    await ensureCvrInputsReadyForPeriod(DEV_B, PERIOD_B);
    expect(getCvrInputListCallCount()).toBe(2);

    seedMockCvrInputs(PERIOD_A, [
      buildServerCvrInputFixture({
        periodId: PERIOD_A,
        costCodeKey: '2100',
        commercialAdjustment: 9000,
        adjustmentReason: 'Prelims forecast adopted — 2026-12',
        manualAccrual: 125,
        version: 2,
        displayMetadata: {
          adjustmentHistory: [{
            id: 'adj-prelims-2100',
            source: 'prelims_adoption',
            previousAdjustment: 0,
            newAdjustment: 9000,
            reason: 'Prelims forecast adopted — 2026-12',
          }],
        },
        adjustmentHistory: [{
          id: 'adj-prelims-2100',
          source: 'prelims_adoption',
          previousAdjustment: 0,
          newAdjustment: 9000,
          reason: 'Prelims forecast adopted — 2026-12',
        }],
      }),
      buildServerCvrInputFixture({
        id: 'input-unrelated-a',
        periodId: PERIOD_A,
        costCodeKey: '2101',
        commercialAdjustment: 0,
        version: 1,
      }),
    ]);

    await refreshCvrInputsForPeriod(DEV_A, PERIOD_A);

    expect(getCvrInputListCallCount()).toBe(3);
    const adopted = getCachedCvrInputs(PERIOD_A).find((row) => row.costCodeKey === '2100');
    expect(adopted).toMatchObject({
      commercialAdjustment: 9000,
      adjustmentReason: 'Prelims forecast adopted — 2026-12',
      manualAccrual: 125,
      version: 2,
    });
    expect(adopted.adjustmentHistory[0]).toMatchObject({
      source: 'prelims_adoption',
      previousAdjustment: 0,
      newAdjustment: 9000,
    });
    expect(getCachedCvrInputs(PERIOD_A).find((row) => row.costCodeKey === '2101')).toMatchObject({
      commercialAdjustment: 0,
      version: 1,
    });
    expect(getCachedCvrInputs(PERIOD_B)[0]).toMatchObject({
      costCodeKey: '3100',
      commercialAdjustment: 50,
      version: 1,
    });
  });

  it('refreshes a Selling Costs adoption into worksheet and movement inputs without touching another period', async () => {
    seedMockCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A, periodKey: 'P04' })
    );
    seedMockCvrPeriod(
      DEV_B,
      buildServerCvrPeriodFixture({ id: PERIOD_B, developmentId: DEV_B, periodKey: 'P02' })
    );
    const stale6170 = buildServerCvrInputFixture({
      periodId: PERIOD_A,
      costCodeKey: '6170',
      costCodeLabel: '6170',
      description: 'Sales Office Set-up',
      currentBudget: 0,
      commercialAdjustment: 0,
      version: 1,
    });
    const unrelated = buildServerCvrInputFixture({
      id: 'input-unrelated-period',
      periodId: PERIOD_B,
      costCodeKey: '1100',
      commercialAdjustment: 25,
      version: 7,
    });
    seedMockCvrInputs(PERIOD_A, [stale6170]);
    seedMockCvrInputs(PERIOD_B, [unrelated]);
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    await ensureCvrPeriodsReadyForDevelopment(DEV_B);
    await ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    await ensureCvrInputsReadyForPeriod(DEV_B, PERIOD_B);

    const adoptionEvidence = {
      mode: 'simple',
      adoptedAdjustment: 115062.5,
      adoptedTargetFinal: 115062.5,
      destinationCostCodeKey: '6170',
    };
    const history = [{
      id: 'adj-selling-costs-6170',
      source: 'selling_costs_adoption',
      previousAdjustment: 0,
      newAdjustment: 115062.5,
      reason: 'Selling Costs forecast adopted — 2027-02',
    }];
    seedMockCvrInputs(PERIOD_A, [
      buildServerCvrInputFixture({
        ...stale6170,
        commercialAdjustment: 115062.5,
        adjustmentReason: 'Selling Costs forecast adopted — 2027-02',
        version: 2,
        displayMetadata: {
          sellingCostsAdoption: adoptionEvidence,
          adjustmentHistory: history,
        },
        adjustmentHistory: history,
      }),
    ]);

    await refreshCvrInputsForPeriod(DEV_A, PERIOD_A);

    const refreshed = getCachedCvrInputs(PERIOD_A)[0];
    expect(refreshed).toMatchObject({
      costCodeKey: '6170',
      commercialAdjustment: 115062.5,
      adjustmentReason: 'Selling Costs forecast adopted — 2027-02',
      version: 2,
    });
    expect(refreshed.displayMetadata.sellingCostsAdoption).toEqual(adoptionEvidence);
    expect(refreshed.adjustmentHistory[0]).toMatchObject({
      source: 'selling_costs_adoption',
      newAdjustment: 115062.5,
    });

    const previousRow = enrichCvrRow({ ...stale6170, committed: 0, actualCost: 0 });
    const currentRow = enrichCvrRow({ ...refreshed, committed: 0, actualCost: 0 });
    expect(currentRow).toMatchObject({ systemForecast: 0, finalForecast: 115062.5 });
    const movement = buildCvrPeriodComparison({
      currentModel: { rows: [currentRow], summary: { finalForecast: 115062.5 }, ready: true },
      previousModel: { rows: [previousRow], summary: { finalForecast: 0 }, historic: true, snapshot: {} },
      currentPeriod: { id: PERIOD_A, periodKey: 'P04' },
      previousPeriod: { id: 'period-p03', periodKey: 'P03', snapshot: {} },
    });
    expect(movement.rows[0]).toMatchObject({
      costCodeKey: '6170',
      currentForecast: 115062.5,
      movement: 115062.5,
    });
    expect(getCachedCvrInputs(PERIOD_B)).toEqual(expect.arrayContaining([
      expect.objectContaining({ costCodeKey: '1100', commercialAdjustment: 25, version: 7 }),
    ]));
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

  it('empty costCentres does not suppress loaded input cache on upsert', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    seedMockCvrInputs(PERIOD_A, [buildServerCvrInputFixture({ periodId: PERIOD_A, manualAccrual: 100 })]);
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    await ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    getCachedCvrPeriods(DEV_A)[0].costCentres = [];

    upsertCachedCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({
        id: PERIOD_B,
        developmentId: DEV_A,
        periodKey: 'P02',
      })
    );

    const p01 = getCachedCvrPeriods(DEV_A).find((item) => item.id === PERIOD_A);
    expect(p01.costCentres).toHaveLength(1);
    expect(p01.costCentres[0].manualAccrual).toBe(100);
    expect(getCachedCvrInputs(PERIOD_A)[0].manualAccrual).toBe(100);
  });

  it('ensureCvrInputsReadyForPeriod reattaches loaded inputs onto the period shape', async () => {
    seedMockCvrPeriod(DEV_A, buildServerCvrPeriodFixture({ id: PERIOD_A, developmentId: DEV_A }));
    seedMockCvrInputs(PERIOD_A, [buildServerCvrInputFixture({ periodId: PERIOD_A })]);
    await ensureCvrPeriodsReadyForDevelopment(DEV_A);
    await ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    getCachedCvrPeriods(DEV_A)[0].costCentres = [];
    await ensureCvrInputsReadyForPeriod(DEV_A, PERIOD_A);
    expect(getCachedCvrPeriods(DEV_A)[0].costCentres).toHaveLength(1);
    expect(getCvrInputListCallCount()).toBe(1);
  });
});
