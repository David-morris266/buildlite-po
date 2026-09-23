import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

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
  CvrPeriodApiError,
  getCvrMutationCallCounts,
  getLastCvrAddMemberPayload,
  getLastCvrPatchInputPayload,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrMutationReject,
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrInputs,
  getCachedCvrPeriods,
} from './cvrPeriodServerCache';
import {
  addCostCentre,
  listCostCentres,
  updateCostCentre,
  upsertAutoCostCentre,
} from './costCentreStore';
import {
  approveCvrPeriod,
  createOrOpenDraftPeriod,
  getCvrPeriod,
  listCvrPeriods,
  rejectCvrPeriod,
  saveCvrPeriodCommentary,
  submitCvrPeriod,
} from './cvrPeriodStore';
import { ensureDraftCvrOverlayMemberOnServer } from './cvrPeriodAuthorityWrites';
import { enrichCvrForecastRow } from './cvrForecastEngine';

const DEV_A = 'dev-auth-a';
const DEV_B = 'dev-auth-b';
const STORAGE_KEY = 'buildlite_cvr_v1';

function snapshotLocalStore() {
  return localStorage.getItem(STORAGE_KEY);
}

async function openServerDraft(developmentId) {
  await ensureCvrPeriodsReadyForDevelopment(developmentId);
  return createOrOpenDraftPeriod(developmentId);
}

describe('BL-031D CVR authority writes', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF still uses localStorage lifecycle', () => {
    const created = createOrOpenDraftPeriod(DEV_A);
    expect(created.ok).toBe(true);
    expect(submitCvrPeriod(DEV_A, created.periodKey).ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_A].periods.P01.status).toBe(
      'submitted'
    );
    expect(getCvrMutationCallCounts().total).toBe(0);
  });

  it('create/edit/submit/reject/approve use server mutations and cache', async () => {
    authorityEnabled.value = true;
    const created = await openServerDraft(DEV_A);
    expect(created.ok).toBe(true);
    expect(created.periodKey).toBe('P01');
    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(getCachedCvrPeriods(DEV_A)).toHaveLength(1);

    const added = await addCostCentre(
      DEV_A,
      {
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        currentBudget: 10000,
        commercialAdjustment: 250,
        commercialReason: 'QS overlay',
        manualAccrual: 400,
      },
      'P01'
    );
    expect(added.ok).toBe(true);
    expect(added.costCentre.manualAccrual).toBe(400);
    expect(getCvrMutationCallCounts().createInput).toBe(1);

    const patched = await updateCostCentre(
      DEV_A,
      added.costCentre.id,
      { commercialNotes: 'site note', manualAccrual: 500 },
      'P01'
    );
    expect(patched.ok).toBe(true);
    expect(patched.costCentre.manualAccrual).toBe(500);
    expect(patched.costCentre.notes || patched.costCentre.commercialNotes).toMatch(/site note/);

    const commentary = await saveCvrPeriodCommentary(DEV_A, 'P01', {
      keyCommercialIssues: 'Delay',
    });
    expect(commentary.ok).toBe(true);
    expect(getCvrPeriod(DEV_A, 'P01').commercialCommentary.keyCommercialIssues).toBe('Delay');

    expect((await submitCvrPeriod(DEV_A, 'P01')).ok).toBe(true);
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('submitted');
    expect((await rejectCvrPeriod(DEV_A, 'P01', 'Need overlay')).ok).toBe(true);
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('draft');
    expect((await submitCvrPeriod(DEV_A, 'P01')).ok).toBe(true);
    const approved = await approveCvrPeriod(DEV_A, 'P01');
    expect(approved.ok).toBe(true);
    expect(approved.snapshotDeferred).toBe(false);
    expect(approved.snapshot).toBeTruthy();
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('locked');
    expect(getCachedCvrPeriods(DEV_A)[0].snapshot).toBeTruthy();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('hydration after mutation reads server cache, not localStorage', async () => {
    authorityEnabled.value = true;
    await openServerDraft(DEV_A);
    const added = await addCostCentre(
      DEV_A,
      { costCodeKey: '5231', costCodeLabel: 'Cleaning', manualAccrual: 400 },
      'P01'
    );
    expect(added.ok).toBe(true);
    await ensureCvrPeriodAndInputsReady(DEV_A, 'P01');
    expect(listCvrPeriods(DEV_A)[0].periodKey).toBe('P01');
    expect(listCostCentres(DEV_A, 'P01')[0].manualAccrual).toBe(400);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('409 conflict is visible and does not overwrite cache', async () => {
    authorityEnabled.value = true;
    const created = await openServerDraft(DEV_A);
    const before = snapshotLocalStore();
    setCvrMutationReject(
      new CvrPeriodApiError('This CVR period was changed elsewhere. Refresh and retry.', {
        status: 409,
        body: { message: 'This CVR period was changed elsewhere. Refresh and retry.' },
      })
    );
    const submitted = await submitCvrPeriod(DEV_A, created.periodKey);
    expect(submitted.ok).toBe(false);
    expect(submitted.status).toBe(409);
    expect(submitted.errors[0]).toMatch(/changed elsewhere|version conflict/i);
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('draft');
    expect(snapshotLocalStore()).toBe(before);
  });

  it('500 error is visible with no localStorage fallback', async () => {
    authorityEnabled.value = true;
    await openServerDraft(DEV_A);
    setCvrMutationReject(
      new CvrPeriodApiError('Unable to save CVR period.', { status: 500 })
    );
    const result = await submitCvrPeriod(DEV_A, 'P01');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getCachedCvrPeriods(DEV_A)[0].status).toBe('draft');
  });

  it('development A mutations do not contaminate development B', async () => {
    authorityEnabled.value = true;
    seedMockCvrPeriod(
      DEV_B,
      buildServerCvrPeriodFixture({
        developmentId: DEV_B,
        periodKey: 'P01',
        id: 'bbbbbbbb-2222-4333-8444-555555555555',
      })
    );
    seedMockCvrInputs('bbbbbbbb-2222-4333-8444-555555555555', [
      buildServerCvrInputFixture({
        periodId: 'bbbbbbbb-2222-4333-8444-555555555555',
        costCodeKey: '1110',
        manualAccrual: 0,
      }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV_B, 'P01');
    await openServerDraft(DEV_A);
    await addCostCentre(
      DEV_A,
      { costCodeKey: '5231', costCodeLabel: 'Cleaning', manualAccrual: 400 },
      'P01'
    );
    expect(listCostCentres(DEV_A, 'P01').some((item) => item.costCodeKey === '5231')).toBe(true);
    expect(listCostCentres(DEV_B, 'P01').some((item) => item.costCodeKey === '5231')).toBe(false);
    expect(getCachedCvrInputs('bbbbbbbb-2222-4333-8444-555555555555')[0].costCodeKey).toBe('1110');
  });

  it('commercial adjustment save does not overwrite existing accrual', async () => {
    authorityEnabled.value = true;
    await openServerDraft(DEV_A);
    const added = await addCostCentre(
      DEV_A,
      { costCodeKey: '5231', costCodeLabel: 'Cleaning', manualAccrual: 100 },
      'P01'
    );
    const patched = await updateCostCentre(
      DEV_A,
      added.costCentre.id,
      { commercialAdjustment: 0, commercialReason: '' },
      'P01'
    );
    expect(patched.ok).toBe(true);
    expect(patched.costCentre.manualAccrual).toBe(100);
    expect(listCostCentres(DEV_A, 'P01')[0].manualAccrual).toBe(100);
  });

  it('development-budget adjustment save omits protected budgets and retains unrelated input facts', async () => {
    authorityEnabled.value = true;
    const period = buildServerCvrPeriodFixture({
      developmentId: DEV_A,
      budgetSourceMode: 'development_budget',
    });
    seedMockCvrPeriod(DEV_A, period);
    seedMockCvrInputs(period.id, [
      buildServerCvrInputFixture({
        periodId: period.id,
        costCodeKey: '3640',
        costCodeLabel: '3640 — Planting',
        originalBudget: 50000,
        currentBudget: 54000,
        commercialAdjustment: 8000,
        adjustmentReason: 'Existing adjustment',
        manualAccrual: 125,
        notes: 'Retain this note',
        commercialHead: 'External Works',
        commercialFamily: 'Landscaping',
        trade: 'Planting',
        version: 1,
      }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV_A, 'P01');

    const current = listCostCentres(DEV_A, 'P01')[0];
    const result = await updateCostCentre(
      DEV_A,
      current.id,
      {
        commercialAdjustment: 9000,
        commercialReason: 'UAT movement change to test explanation staleness.',
      },
      'P01'
    );

    expect(result.ok).toBe(true);
    const request = getLastCvrPatchInputPayload();
    expect(request.payload).not.toHaveProperty('originalBudget');
    expect(request.payload).not.toHaveProperty('currentBudget');
    expect(request.payload).toMatchObject({
      version: 1,
      commercialAdjustment: 9000,
      adjustmentReason: 'UAT movement change to test explanation staleness.',
    });
    expect(result.costCentre).toMatchObject({
      originalBudget: 50000,
      currentBudget: 54000,
      commercialAdjustment: 9000,
      commercialReason: 'UAT movement change to test explanation staleness.',
      manualAccrual: 125,
      notes: 'Retain this note',
      commercialHead: 'External Works',
      commercialFamily: 'Landscaping',
      trade: 'Planting',
      version: 2,
    });
    expect(
      enrichCvrForecastRow({
        ...result.costCentre,
        committed: 46000,
        actualCost: 0,
        expectedLiability: 0,
        vaExposureUplift: 0,
      })
    ).toMatchObject({
      recognisedObligation: 46000,
      uncommittedForecast: 8000,
      systemForecast: 54000,
      commercialAdjustment: 9000,
      finalForecast: 63000,
    });

    setCvrMutationReject(
      new CvrPeriodApiError('Cost-code input version conflict.', {
        status: 409,
        body: { message: 'Cost-code input version conflict.' },
      })
    );
    const conflict = await updateCostCentre(
      DEV_A,
      current.id,
      { commercialAdjustment: 9100, commercialReason: 'Conflicting edit' },
      'P01'
    );
    expect(conflict).toMatchObject({ ok: false, status: 409 });
    expect(conflict.errors[0]).toMatch(/version conflict/i);
    expect(listCostCentres(DEV_A, 'P01')[0]).toMatchObject({
      commercialAdjustment: 9000,
      version: 2,
    });
  });

  it('legacy CVR input edits keep their editable budget fields in the existing adapter contract', async () => {
    authorityEnabled.value = true;
    await openServerDraft(DEV_A);
    const added = await addCostCentre(
      DEV_A,
      {
        costCodeKey: '5231',
        costCodeLabel: 'Cleaning',
        originalBudget: 10000,
        currentBudget: 11000,
        manualAccrual: 100,
      },
      'P01'
    );

    const result = await updateCostCentre(
      DEV_A,
      added.costCentre.id,
      { manualAccrual: 150 },
      'P01'
    );

    expect(result.ok).toBe(true);
    expect(getLastCvrPatchInputPayload().payload).toMatchObject({
      originalBudget: 10000,
      currentBudget: 11000,
      manualAccrual: 150,
    });
  });

  it('authority OFF explicit accrual save still works locally', () => {
    const created = createOrOpenDraftPeriod(DEV_A);
    const added = addCostCentre(
      DEV_A,
      { costCodeKey: '5231', costCodeLabel: 'Cleaning', manualAccrual: 0 },
      created.periodKey
    );
    const saved = updateCostCentre(
      DEV_A,
      added.costCentre.id,
      { manualAccrual: 100 },
      created.periodKey
    );
    expect(saved.ok).toBe(true);
    expect(saved.costCentre.manualAccrual).toBe(100);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_A].periods.P01.costCentres[0].manualAccrual).toBe(
      100
    );
    expect(getCvrMutationCallCounts().total).toBe(0);
  });

  it('first auto-row overlay uses 037A membership instead of POST /inputs', async () => {
    authorityEnabled.value = true;
    await openServerDraft(DEV_A);
    const created = await upsertAutoCostCentre(
      DEV_A,
      { costCodeKey: '2300', costCodeLabel: '2300 — Brickwork' },
      'P01'
    );
    expect(created.costCodeKey).toBe('2300');
    expect(created.originalBudget).toBeNull();
    expect(created.commercialAdjustment).toBe(0);
    expect(created.manualAccrual).toBe(0);
    expect(getCvrMutationCallCounts().addMember).toBe(1);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
    expect(getLastCvrAddMemberPayload().payload.costCodeKey).toBe('2300');
  });

  it('ensureDraftCvrOverlayMemberOnServer reuses existing overlay on duplicate', async () => {
    authorityEnabled.value = true;
    const created = await openServerDraft(DEV_A);
    seedMockCvrInputs(created.period.id, [
      buildServerCvrInputFixture({
        id: 'existing-member',
        periodId: created.period.id,
        costCodeKey: '2300',
        originalBudget: 12000,
        currentBudget: 12000,
        commercialAdjustment: 40,
        version: 3,
      }),
    ]);
    const result = await ensureDraftCvrOverlayMemberOnServer(DEV_A, 'P01', '2300');
    expect(result.ok).toBe(true);
    expect(result.alreadyMember).toBe(true);
    expect(result.costCentre.originalBudget).toBe(12000);
    expect(result.costCentre.commercialAdjustment).toBe(40);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
  });
});
