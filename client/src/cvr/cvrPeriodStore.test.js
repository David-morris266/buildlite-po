import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { addCostCentre, updateCostCentre } from './costCentreStore';
import {
  approveCvrPeriod,
  createOrOpenDraftPeriod,
  createNextCvrPeriod,
  findDraftCvrPeriod,
  listCvrPeriods,
  rejectCvrPeriod,
  submitCvrPeriod,
} from './cvrPeriodStore';

const DEV_ID = 'dev-period-test';

describe('cvrPeriodStore workflow', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('creates an initial draft period', () => {
    const result = createOrOpenDraftPeriod(DEV_ID);
    expect(result.ok).toBe(true);
    expect(result.periodKey).toBe('P01');

    const draft = findDraftCvrPeriod(DEV_ID);
    expect(draft?.status).toBe('draft');
  });

  it('opens existing draft instead of creating another', () => {
    createOrOpenDraftPeriod(DEV_ID);
    const second = createOrOpenDraftPeriod(DEV_ID);

    expect(second.opened).toBe(true);
    expect(listCvrPeriods(DEV_ID)).toHaveLength(1);
  });

  it('submits, approves, and locks a period', () => {
    const { periodKey } = createOrOpenDraftPeriod(DEV_ID);
    expect(submitCvrPeriod(DEV_ID, periodKey).ok).toBe(true);

    const submitted = listCvrPeriods(DEV_ID)[0];
    expect(submitted.status).toBe('submitted');

    expect(approveCvrPeriod(DEV_ID, periodKey).ok).toBe(true);
    const locked = listCvrPeriods(DEV_ID)[0];
    expect(locked.status).toBe('locked');
    expect(locked.auditHistory.some((entry) => entry.action === 'approved')).toBe(true);
  });

  it('rejects a submitted period back to draft with comment', () => {
    const { periodKey } = createOrOpenDraftPeriod(DEV_ID);
    submitCvrPeriod(DEV_ID, periodKey);

    const rejected = rejectCvrPeriod(DEV_ID, periodKey, '');
    expect(rejected.ok).toBe(false);

    const ok = rejectCvrPeriod(DEV_ID, periodKey, 'Brickwork adjustment required');
    expect(ok.ok).toBe(true);

    const period = listCvrPeriods(DEV_ID)[0];
    expect(period.status).toBe('draft');
    expect(period.auditHistory.some((entry) => entry.action === 'rejected')).toBe(true);
  });

  it('rolls forward budgets and adjustments into the next draft period', () => {
    const first = createOrOpenDraftPeriod(DEV_ID);
    const added = addCostCentre(
      DEV_ID,
      {
        costCodeLabel: 'Brickwork',
        currentBudget: 250000,
        commercialAdjustment: 15000,
        commercialReason: 'Variation allowance',
      },
      first.periodKey
    );
    expect(added.ok).toBe(true);

    submitCvrPeriod(DEV_ID, first.periodKey);
    approveCvrPeriod(DEV_ID, first.periodKey);

    const next = createNextCvrPeriod(DEV_ID);
    expect(next.ok).toBe(true);
    expect(next.periodKey).toBe('P02');

    const p01 = listCvrPeriods(DEV_ID).find((item) => item.periodKey === 'P01');
    const p02 = listCvrPeriods(DEV_ID).find((item) => item.periodKey === 'P02');
    const p01Centre = p01.costCentres.find((item) => item.costCodeLabel === 'Brickwork');
    const p02Centre = p02.costCentres.find((item) => item.costCodeLabel === 'Brickwork');

    expect(p01Centre.commercialAdjustment).toBe(15000);
    expect(p02Centre.commercialAdjustment).toBe(15000);
    expect(p02Centre.currentBudget).toBe(250000);
  });

  it('prevents editing locked period manual data', () => {
    const { periodKey } = createOrOpenDraftPeriod(DEV_ID);
    const added = addCostCentre(
      DEV_ID,
      {
        costCodeLabel: 'Groundworks',
        currentBudget: 100000,
      },
      periodKey
    );
    expect(added.ok).toBe(true);

    submitCvrPeriod(DEV_ID, periodKey);
    approveCvrPeriod(DEV_ID, periodKey);

    const blocked = updateCostCentre(
      DEV_ID,
      added.costCentre.id,
      { currentBudget: 120000 },
      periodKey
    );
    expect(blocked.ok).toBe(false);
  });
});
