import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const mockOrders = vi.hoisted(() => []);

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../payments/subcontractOrders.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildSubcontractOrdersFromPos: () => mockOrders,
  };
});

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  buildServerCvrSnapshotRowFixture,
  getCvrMutationCallCounts,
  getLastUpsertPayload,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrInputListReject,
  setCvrUpsertInputsReject,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrInputs,
  getCachedCvrPeriods,
  upsertCachedCvrPeriod,
  refreshCvrPeriodsForDevelopment,
} from './cvrPeriodServerCache';
import { buildCvrModel } from './cvrEngine';
import {
  __resetCvrDraftCreateLockForTests,
  createNextCvrPeriod,
  createOrOpenDraftPeriod,
} from './cvrPeriodStore';

const DEV = 'dev-bl031f-carry';
const P01_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const P02_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

const SOURCE_KEYS = [
  '1110',
  '2300',
  '5105',
  '5206',
  '5212',
  '5213',
  '5215',
  '5218',
  '5231',
];

function p01Inputs() {
  return SOURCE_KEYS.map((key) =>
    buildServerCvrInputFixture({
      id: `input-p01-${key}`,
      periodId: P01_ID,
      costCodeKey: key,
      costCodeLabel: `${key} — Trade`,
      originalBudget: 0,
      currentBudget: 0,
      manualAccrual: key === '5231' ? 100 : 0,
      commercialAdjustment: key === '5231' ? 500 : 0,
      adjustmentReason: key === '5231' ? 'BL-031D UAT test adjustment' : '',
      notes: key === '5231' ? 'BL-031D UAT test notes' : '',
      adjustmentHistory:
        key === '5231'
          ? [
              {
                id: 'adj-p01-5231',
                previousAdjustment: 0,
                newAdjustment: 500,
                reason: 'BL-031D UAT test adjustment',
                user: 'QS',
                date: '2026-04-01T09:00:00.000Z',
              },
            ]
          : [],
      displayMetadata:
        key === '5231'
          ? {
              adjustmentHistory: [
                {
                  id: 'adj-p01-5231',
                  previousAdjustment: 0,
                  newAdjustment: 500,
                  reason: 'BL-031D UAT test adjustment',
                },
              ],
            }
          : {},
    })
  );
}

function lockedSnapshot() {
  return buildServerCvrSnapshotFixture({
    developmentId: DEV,
    periodId: P01_ID,
    periodKey: 'P01',
    rows: [
      buildServerCvrSnapshotRowFixture({
        snapshotId: 'snap-p01',
        costCodeKey: '5231',
        committed: 50250,
        finalForecast: 50750,
      }),
    ],
  });
}

async function seedLockedP01({ wipeCostCentres = true } = {}) {
  authorityEnabled.value = true;
  seedMockCvrPeriod(
    DEV,
    buildServerCvrPeriodFixture({
      id: P01_ID,
      developmentId: DEV,
      periodKey: 'P01',
      status: 'locked',
      version: 5,
      snapshot: lockedSnapshot(),
      snapshotDeferred: false,
      approvedAt: '2026-04-01T12:00:00.000Z',
    })
  );
  seedMockCvrInputs(P01_ID, p01Inputs());
  await ensureCvrPeriodAndInputsReady(DEV, 'P01');
  if (wipeCostCentres) {
    const period = getCachedCvrPeriods(DEV).find((item) => item.periodKey === 'P01');
    if (period) period.costCentres = [];
  }
}

function liveWipeOrder(committed = 50260) {
  return {
    orderKey: `${DEV}::wipe::5231`,
    developmentId: DEV,
    costCode: '5231',
    supplierLabel: 'Wipe It Cleaners',
    committedValue: committed,
    commercialEventsReady: true,
  };
}

function p02Inputs() {
  const p02 = getCachedCvrPeriods(DEV).find((item) => item.periodKey === 'P02');
  return p02?.id ? getCachedCvrInputs(p02.id) : [];
}

function p02Row(key) {
  return p02Inputs().find((item) => item.costCodeKey === key) || null;
}

describe('BL-031F QS input carry-forward', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    mockOrders.length = 0;
    __resetCvrPeriodServerCacheForTests();
    __resetCvrDraftCreateLockForTests();
    resetCvrPeriodApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('copies all 9 persisted QS inputs from locked P01 even when costCentres is empty', async () => {
    await seedLockedP01();
    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(true);
    expect(result.periodKey).toBe('P02');
    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(getCvrMutationCallCounts().upsertInputs).toBe(1);
    expect(p02Inputs()).toHaveLength(9);
    expect(p02Inputs().map((item) => item.costCodeKey).sort()).toEqual([...SOURCE_KEYS]);
  });

  it('carries 5231 overlay, reason, notes, and budgets, and resets adjustment history', async () => {
    await seedLockedP01();
    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(true);
    const row = p02Row('5231');
    expect(row.manualAccrual).toBe(100);
    expect(row.commercialAdjustment).toBe(500);
    expect(row.commercialReason || row.adjustmentReason).toBe('BL-031D UAT test adjustment');
    expect(row.notes || row.commercialNotes).toBe('BL-031D UAT test notes');
    expect(row.originalBudget).toBe(0);
    expect(row.currentBudget).toBe(0);
    expect(row.adjustmentHistory).toEqual([]);
    expect(row.displayMetadata?.adjustmentHistory).toEqual([]);
  });

  it('does not store committed, certified, actual, or forecast facts on P02 inputs', async () => {
    await seedLockedP01();
    await createNextCvrPeriod(DEV);
    const payload = getLastUpsertPayload();
    expect(payload.payload.inputs).toHaveLength(9);
    for (const item of payload.payload.inputs) {
      expect(item).not.toHaveProperty('committed');
      expect(item).not.toHaveProperty('certified');
      expect(item).not.toHaveProperty('actual');
      expect(item).not.toHaveProperty('actualCost');
      expect(item).not.toHaveProperty('currentCost');
      expect(item).not.toHaveProperty('systemForecast');
      expect(item).not.toHaveProperty('finalForecast');
      expect(item).not.toHaveProperty('costToComplete');
      expect(item).not.toHaveProperty('outstandingCertified');
      expect(item).not.toHaveProperty('variance');
    }
    const stored = p02Row('5231');
    expect(stored.committed).toBeUndefined();
    expect(stored.certified).toBeUndefined();
    expect(stored.finalForecast).toBeUndefined();
  });

  it('live P02 still picks up post-lock commitment while P01 historic stays frozen', async () => {
    await seedLockedP01();
    mockOrders.push(liveWipeOrder(50260));
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');

    const live = buildCvrModel(DEV, { periodKey: 'P02', pos: [{ id: 'po-wipe' }] });
    const live5231 = live.rows.find((row) => row.costCodeKey === '5231');
    expect(live5231.committed).toBe(50260);
    expect(live5231.manualAccrual).toBe(100);
    expect(live5231.commercialAdjustment).toBe(500);
    expect(live5231.finalForecast).toBe(50760);

    const historic = buildCvrModel(DEV, { periodKey: 'P01', pos: [{ id: 'po-wipe' }] });
    expect(historic.historic).toBe(true);
    expect(historic.rows[0].committed).toBe(50250);
    expect(historic.rows[0].finalForecast).toBe(50750);
  });

  it('empty costCentres does not suppress the authoritative input cache', async () => {
    await seedLockedP01({ wipeCostCentres: true });
    expect(getCachedCvrPeriods(DEV)[0].costCentres).toEqual([]);
    expect(getCachedCvrInputs(P01_ID)).toHaveLength(9);
    const created = await createNextCvrPeriod(DEV);
    expect(created.ok).toBe(true);
    expect(p02Row('5231').manualAccrual).toBe(100);
  });

  it('reattaching loaded inputs does not make historic P01 financials live', async () => {
    await seedLockedP01({ wipeCostCentres: false });
    mockOrders.push(liveWipeOrder(999999));
    upsertCachedCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: P02_ID,
        developmentId: DEV,
        periodKey: 'P02',
        status: 'draft',
      })
    );
    const p01 = getCachedCvrPeriods(DEV).find((item) => item.periodKey === 'P01');
    expect(p01.costCentres.length).toBe(9);
    const historic = buildCvrModel(DEV, { periodKey: 'P01', pos: [{ id: 'po-wipe' }] });
    expect(historic.rows[0].committed).toBe(50250);
    expect(historic.summary.committed).toBe(2364873);
  });

  it('source input load failure is visible and does not create P02', async () => {
    authorityEnabled.value = true;
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: P01_ID,
        developmentId: DEV,
        status: 'locked',
        snapshot: lockedSnapshot(),
        snapshotDeferred: false,
      })
    );
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    setCvrInputListReject();
    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Unable to load CVR cost-code inputs/i);
    expect(getCvrMutationCallCounts().create).toBe(0);
    expect(getCachedCvrPeriods(DEV).some((item) => item.periodKey === 'P02')).toBe(false);
  });

  it('P02 POST success with PUT failure returns ok:false and is not treated as success', async () => {
    await seedLockedP01();
    setCvrUpsertInputsReject();
    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(false);
    expect(result.copyFailed).toBe(true);
    expect(result.errors[0]).toMatch(/could not be copied|Unable to copy/i);
    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(getCachedCvrPeriods(DEV).some((item) => item.periodKey === 'P02')).toBe(true);
    const p02 = getCachedCvrPeriods(DEV).find((item) => item.periodKey === 'P02');
    expect(getCachedCvrInputs(p02.id)).toHaveLength(0);
  });

  it('existing empty Draft P02 is recovered by PUT and does not POST P03', async () => {
    await seedLockedP01();
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: P02_ID,
        developmentId: DEV,
        periodKey: 'P02',
        status: 'draft',
      })
    );
    seedMockCvrInputs(P02_ID, []);
    await refreshCvrPeriodsForDevelopment(DEV);
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');

    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(true);
    expect(result.periodKey).toBe('P02');
    expect(result.opened).toBe(true);
    expect(result.recovered).toBe(true);
    expect(getCvrMutationCallCounts().create).toBe(0);
    expect(getCvrMutationCallCounts().upsertInputs).toBe(1);
    expect(getCachedCvrInputs(P02_ID)).toHaveLength(9);
    expect(getCachedCvrPeriods(DEV).some((item) => item.periodKey === 'P03')).toBe(false);
  });

  it('retry after successful recovery is a no-op open', async () => {
    await seedLockedP01();
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: P02_ID,
        developmentId: DEV,
        periodKey: 'P02',
        status: 'draft',
      })
    );
    seedMockCvrInputs(P02_ID, []);
    await refreshCvrPeriodsForDevelopment(DEV);
    await ensureCvrPeriodAndInputsReady(DEV, 'P01');
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');
    await createNextCvrPeriod(DEV);
    const afterRecovery = getCvrMutationCallCounts();
    const retry = await createNextCvrPeriod(DEV);
    expect(retry.ok).toBe(true);
    expect(retry.opened).toBe(true);
    expect(retry.alreadyComplete || retry.recovered === false).toBe(true);
    expect(getCvrMutationCallCounts().create).toBe(afterRecovery.create);
    expect(getCvrMutationCallCounts().upsertInputs).toBe(afterRecovery.upsertInputs);
    expect(getCachedCvrInputs(P02_ID)).toHaveLength(9);
  });

  it('partial or conflicting P02 inputs are not blindly overwritten', async () => {
    await seedLockedP01();
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: P02_ID,
        developmentId: DEV,
        periodKey: 'P02',
        status: 'draft',
      })
    );
    seedMockCvrInputs(P02_ID, [
      buildServerCvrInputFixture({
        id: 'p02-partial-5231',
        periodId: P02_ID,
        costCodeKey: '5231',
        manualAccrual: 5,
        commercialAdjustment: 0,
      }),
    ]);
    await refreshCvrPeriodsForDevelopment(DEV);
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');
    const result = await createNextCvrPeriod(DEV);
    expect(result.ok).toBe(false);
    expect(result.conflict).toBe(true);
    expect(result.errors[0]).toMatch(/were not overwritten/i);
    expect(getCvrMutationCallCounts().create).toBe(0);
    expect(getCvrMutationCallCounts().upsertInputs).toBe(0);
    expect(getCachedCvrInputs(P02_ID)).toHaveLength(1);
    expect(getCachedCvrInputs(P02_ID)[0].manualAccrual).toBe(5);
  });

  it('repeated create/open does not create P03 or duplicate rows', async () => {
    await seedLockedP01();
    const [first, second] = await Promise.all([
      createNextCvrPeriod(DEV),
      createNextCvrPeriod(DEV),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(getCachedCvrPeriods(DEV).filter((item) => item.periodKey === 'P02')).toHaveLength(1);
    expect(getCachedCvrPeriods(DEV).some((item) => item.periodKey === 'P03')).toBe(false);
    const p02 = getCachedCvrPeriods(DEV).find((item) => item.periodKey === 'P02');
    expect(getCachedCvrInputs(p02.id)).toHaveLength(9);
  });

  it('authority OFF localStorage roll-forward still copies overlays locally', () => {
    authorityEnabled.value = false;
    const created = createOrOpenDraftPeriod(DEV);
    expect(created.ok).toBe(true);
    const record = JSON.parse(localStorage.getItem('buildlite_cvr_v1'))[DEV];
    record.periods.P01.costCentres = [
      {
        id: 'cc-5231',
        costCodeKey: '5231',
        costCodeLabel: 'Cleaning',
        originalBudget: 0,
        currentBudget: 0,
        manualAccrual: 100,
        commercialAdjustment: 500,
        commercialReason: 'BL-031D UAT test adjustment',
        commercialNotes: 'local notes',
        adjustmentHistory: [{ id: 'adj-1' }],
        active: true,
      },
    ];
    record.periods.P01.status = 'locked';
    localStorage.setItem('buildlite_cvr_v1', JSON.stringify({ [DEV]: record }));

    const next = createNextCvrPeriod(DEV);
    expect(next.ok).toBe(true);
    expect(next.periodKey).toBe('P02');
    const stored = JSON.parse(localStorage.getItem('buildlite_cvr_v1'))[DEV].periods.P02
      .costCentres[0];
    expect(stored.manualAccrual).toBe(100);
    expect(stored.commercialAdjustment).toBe(500);
    expect(stored.commercialReason).toBe('BL-031D UAT test adjustment');
    expect(stored.commercialNotes).toBe('local notes');
    expect(stored.adjustmentHistory).toEqual([]);
    expect(getCvrMutationCallCounts().total).toBe(0);
  });
});
