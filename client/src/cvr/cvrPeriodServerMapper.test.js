import { describe, expect, it } from 'vitest';
import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
} from '../test/mockCvrPeriodApi';
import {
  normalizeServerCvrCostCodeInput,
  normalizeServerCvrPeriod,
  normalizeServerCvrPeriodList,
} from './cvrPeriodServerMapper';

describe('CVR period/input mappers (BL-031B)', () => {
  it('maps period list/get documents into camelCase store shape', () => {
    const document = buildServerCvrPeriodFixture({
      periodKey: 'P02',
      periodLabel: 'February',
      status: 'submitted',
      version: 3,
      commentary: { keyCommercialIssues: 'Delay on plot 2' },
      submittedAt: '2026-02-01T12:00:00.000Z',
      submittedBy: 'QS',
    });

    const mapped = normalizeServerCvrPeriod(document);
    expect(mapped.id).toBe(document.id);
    expect(mapped.periodKey).toBe('P02');
    expect(mapped.periodLabel).toBe('February');
    expect(mapped.status).toBe('submitted');
    expect(mapped.version).toBe(3);
    expect(mapped.commercialCommentary.keyCommercialIssues).toBe('Delay on plot 2');
    expect(mapped.submittedBy).toBe('QS');
    expect(JSON.stringify(mapped)).not.toMatch(/period_key|submitted_at/);

    const listed = normalizeServerCvrPeriodList([
      buildServerCvrPeriodFixture({ id: 'b', periodKey: 'P02' }),
      buildServerCvrPeriodFixture({ id: 'a', periodKey: 'P01' }),
    ]);
    expect(listed.map((item) => item.periodKey)).toEqual(['P01', 'P02']);
  });

  it('maps cost-code inputs including manualAccrual and labels', () => {
    const mapped = normalizeServerCvrCostCodeInput(
      buildServerCvrInputFixture({
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        originalBudget: 10000,
        currentBudget: 11000,
        commercialAdjustment: 250,
        adjustmentReason: 'Inflation',
        manualAccrual: 400,
        notes: 'QS overlay',
        active: true,
        version: 2,
      })
    );

    expect(mapped.costCodeKey).toBe('5231');
    expect(mapped.costCodeLabel).toBe('5231 — Cleaning');
    expect(mapped.originalBudget).toBe(10000);
    expect(mapped.currentBudget).toBe(11000);
    expect(mapped.commercialAdjustment).toBe(250);
    expect(mapped.commercialReason).toBe('Inflation');
    expect(mapped.manualAccrual).toBe(400);
    expect(mapped.commercialNotes).toBe('QS overlay');
    expect(mapped.active).toBe(true);
    expect(mapped.version).toBe(2);
    expect(JSON.stringify(mapped)).not.toMatch(/cost_code_key|manual_accrual/);
  });
});
