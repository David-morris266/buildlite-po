import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  CvrPeriodApiError,
  getCvrMutationCallCounts,
  getLastCvrAddMemberPayload,
  getLastCvrBudgetImportPayload,
  resetCvrPeriodApiStore,
  seedMockCvrPeriod,
  setCvrAddMemberReject,
  setCvrMutationReject,
  buildServerCvrPeriodFixture,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  getCachedCvrInputs,
  getCachedCvrPeriods,
} from './cvrPeriodServerCache';
import {
  addServerCvrCostCodeMember,
  approveServerCvrPeriod,
  createServerCvrPeriod,
  createServerCvrPeriodInput,
  importServerCvrBudget,
  patchServerCvrPeriod,
  patchServerCvrPeriodInput,
  rejectServerCvrPeriod,
  submitServerCvrPeriod,
  upsertServerCvrPeriodInputs,
} from './cvrPeriodServerMutations';

const DEV = 'dev-cvr-mut';

describe('CVR period server mutations (BL-031C)', () => {
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

  it('creates a draft period on the server and caches it', async () => {
    const result = await createServerCvrPeriod(DEV, { periodKey: 'P01', periodLabel: 'P01' });
    expect(result.ok).toBe(true);
    expect(result.period.status).toBe('draft');
    expect(result.period.periodKey).toBe('P01');
    expect(getCachedCvrPeriods(DEV)).toHaveLength(1);
    expect(getCvrMutationCallCounts().create).toBe(1);
  });

  it('patches a draft period', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const result = await patchServerCvrPeriod(DEV, created.period.id, {
      version: created.period.version,
      periodLabel: 'January',
      commentary: { keyCommercialIssues: 'Delay' },
    });
    expect(result.ok).toBe(true);
    expect(result.period.periodLabel).toBe('January');
    expect(getCachedCvrPeriods(DEV)[0].periodLabel).toBe('January');
  });

  it('submits a draft period', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const result = await submitServerCvrPeriod(DEV, created.period.id);
    expect(result.ok).toBe(true);
    expect(result.period.status).toBe('submitted');
  });

  it('rejects a submitted period back to draft', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    await submitServerCvrPeriod(DEV, created.period.id);
    const result = await rejectServerCvrPeriod(DEV, created.period.id, { comment: 'Need more overlay' });
    expect(result.ok).toBe(true);
    expect(result.period.status).toBe('draft');
  });

  it('approve/lock caches the returned snapshot', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    await submitServerCvrPeriod(DEV, created.period.id);
    const result = await approveServerCvrPeriod(DEV, created.period.id);
    expect(result.ok).toBe(true);
    expect(result.period.status).toBe('locked');
    expect(result.snapshot).toBeTruthy();
    expect(result.snapshotDeferred).toBe(false);
    expect(getCachedCvrPeriods(DEV)[0].snapshot).toBeTruthy();
  });

  it('creates and upserts cost-code inputs', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const createdInput = await createServerCvrPeriodInput(DEV, created.period.id, {
      costCodeKey: '5231',
      costCodeLabel: '5231 — Cleaning',
      originalBudget: 10000,
    });
    expect(createdInput.ok).toBe(true);
    expect(createdInput.input.costCodeKey).toBe('5231');

    const upserted = await upsertServerCvrPeriodInputs(DEV, created.period.id, {
      inputs: [
        {
          costCodeKey: '5218',
          costCodeLabel: '5218',
          originalBudget: 5000,
          manualAccrual: 0,
        },
      ],
    });
    expect(upserted.ok).toBe(true);
    expect(upserted.inputs.some((item) => item.costCodeKey === '5218')).toBe(true);
    expect(getCachedCvrInputs(created.period.id).length).toBeGreaterThan(0);
  });

  it('patches an input', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const input = await createServerCvrPeriodInput(DEV, created.period.id, {
      costCodeKey: '5231',
      notes: 'one',
    });
    const patched = await patchServerCvrPeriodInput(DEV, created.period.id, input.input.id, {
      version: input.input.version,
      notes: 'two',
    });
    expect(patched.ok).toBe(true);
    expect(patched.input.notes).toBe('two');
  });

  it('returns a typed 409 without throwing', async () => {
    seedMockCvrPeriod(DEV, buildServerCvrPeriodFixture({ developmentId: DEV, status: 'draft' }));
    setCvrMutationReject(
      new CvrPeriodApiError('CVR period version conflict.', {
        status: 409,
        body: { message: 'CVR period version conflict.' },
      })
    );
    const result = await createServerCvrPeriod(DEV, { periodKey: 'P02' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.errors[0]).toMatch(/version conflict/i);
  });

  it('adds a Draft member with costCodeKey intent only', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const added = await addServerCvrCostCodeMember(DEV, created.period.id, {
      costCodeKey: '5400',
      actor: 'QS',
    });
    expect(added.ok).toBe(true);
    expect(added.input.costCodeKey).toBe('5400');
    expect(added.input.originalBudget).toBeNull();
    expect(added.input.commercialAdjustment).toBe(0);
    expect(getLastCvrAddMemberPayload().payload.costCodeKey).toBe('5400');
    expect(getLastCvrAddMemberPayload().payload.originalBudget).toBeUndefined();
    expect(getCachedCvrInputs(created.period.id).some((item) => item.costCodeKey === '5400')).toBe(
      true
    );
  });

  it('surfaces COST_CODE_ALREADY_MEMBER as a 409', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    setCvrAddMemberReject();
    const added = await addServerCvrCostCodeMember(DEV, created.period.id, {
      costCodeKey: '5400',
    });
    expect(added.ok).toBe(false);
    expect(added.status).toBe(409);
    expect(added.code).toBe('COST_CODE_ALREADY_MEMBER');
  });

  it('imports budget rows through the server command', async () => {
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    const imported = await importServerCvrBudget(DEV, created.period.id, {
      rows: [{ costCodeKey: '1110', originalBudget: 25000, currentBudget: 25000 }],
    });
    expect(imported.ok).toBe(true);
    expect(imported.created).toBe(1);
    expect(getLastCvrBudgetImportPayload().payload.rows[0].costCodeKey).toBe('1110');
    expect(getCachedCvrInputs(created.period.id)[0].originalBudget).toBe(25000);
  });
});
