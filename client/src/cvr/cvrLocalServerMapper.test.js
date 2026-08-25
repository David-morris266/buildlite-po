import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mapLocalCommentary,
  mapLocalCostCodeInput,
  mapLocalCvrPeriod,
  readLocalCvrDevelopment,
  readRawLocalCvrStore,
} from './cvrLocalServerMapper';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

describe('CVR local→server mapper (BL-031C)', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('reads raw localStorage without synthesising an empty P01', () => {
    expect(readRawLocalCvrStore()).toEqual({});
    expect(readLocalCvrDevelopment('dev-missing').exists).toBe(false);
    expect(readLocalCvrDevelopment('dev-missing').periods).toEqual([]);
  });

  it('maps period keys, commentary, and cost-code inputs', () => {
    const mapped = mapLocalCvrPeriod('P02', {
      status: 'submitted',
      periodLabel: 'February',
      commercialCommentary: { keyCommercialIssues: 'Delay' },
      costCentres: [
        {
          costCodeKey: '5231 — Cleaning',
          costCodeLabel: '5231 — Cleaning',
          description: 'Cleaning',
          commercialHead: 'House Build',
          commercialFamily: 'Internal Finishes',
          trade: 'Cleaning',
          originalBudget: 10000,
          currentBudget: 11000,
          commercialAdjustment: 250,
          commercialReason: 'Inflation',
          adjustmentHistory: [{ amount: 250, reason: 'Inflation' }],
          commercialNotes: 'QS overlay',
          active: true,
        },
      ],
    });
    expect(mapped.ok).toBe(true);
    expect(mapped.value.periodKey).toBe('P02');
    expect(mapped.value.periodLabel).toBe('February');
    expect(mapped.value.status).toBe('submitted');
    expect(mapped.value.commentary.keyCommercialIssues).toBe('Delay');
    expect(mapped.value.inputs[0].costCodeKey).toBe('5231');
    expect(mapped.value.inputs[0].manualAccrual).toBe(0);
    expect(mapped.value.inputs[0].adjustmentHistory).toEqual([{ amount: 250, reason: 'Inflation' }]);
    expect(mapped.value.snapshot).toBeNull();
  });

  it('defaults manualAccrual to 0 unless a value exists', () => {
    expect(mapLocalCostCodeInput({ costCodeKey: '5231' }).value.manualAccrual).toBe(0);
    expect(mapLocalCostCodeInput({ costCodeKey: '5231', manualAccrual: 400 }).value.manualAccrual).toBe(400);
  });

  it('preserves null budgets instead of coercing them to £0', () => {
    const mapped = mapLocalCostCodeInput({
      costCodeKey: '2300',
      originalBudget: null,
      currentBudget: null,
    });
    expect(mapped.ok).toBe(true);
    expect(mapped.value.originalBudget).toBeNull();
    expect(mapped.value.currentBudget).toBeNull();
  });

  it('maps commentary fields deterministically', () => {
    expect(mapLocalCommentary(null)).toEqual({
      keyCommercialIssues: '',
      commercialOpportunities: '',
      financialRisks: '',
      actionsBeforeNextCvr: '',
    });
  });

  it('rejects duplicate normalised cost-code keys', () => {
    const mapped = mapLocalCvrPeriod('P01', {
      status: 'draft',
      costCentres: [
        { costCodeKey: '5231' },
        { costCodeKey: '5231 — Cleaning' },
      ],
    });
    expect(mapped.ok).toBe(false);
    expect(mapped.errors[0]).toMatch(/Duplicate normalised cost-code keys/);
  });

  it('rejects invalid local period status', () => {
    const mapped = mapLocalCvrPeriod('P01', { status: 'reopened' });
    expect(mapped.ok).toBe(false);
    expect(mapped.errors[0]).toMatch(/Invalid local period status/);
  });

  it('does not put historic actors or timestamps on the create payload', () => {
    const mapped = mapLocalCvrPeriod('P01', {
      status: 'locked',
      createdAt: '2020-01-01T00:00:00.000Z',
      createdBy: 'Historic QS',
      approvedAt: '2020-02-01T00:00:00.000Z',
      approvedBy: 'Historic Director',
      costCentres: [],
    });
    expect(mapped.value).not.toHaveProperty('createdAt');
    expect(mapped.value).not.toHaveProperty('createdBy');
    expect(mapped.value).not.toHaveProperty('approvedAt');
    expect(mapped.value).not.toHaveProperty('approvedBy');
  });
});
