import { describe, expect, it } from 'vitest';
import {
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  buildServerCvrSnapshotRowFixture,
} from '../test/mockCvrPeriodApi';
import { normalizeServerCvrPeriod } from './cvrPeriodServerMapper';
import { normalizeCvrSnapshotRow, normalizeServerCvrSnapshot } from './cvrSnapshotMapper';

describe('CVR snapshot mapper (BL-031E.4)', () => {
  it('maps a server snapshot header into nested camelCase totals', () => {
    const document = buildServerCvrSnapshotFixture({
      id: 'snap-1',
      clientId: 'client-9',
      developmentId: 'dev-1',
      periodId: 'period-1',
      periodKey: 'P01',
      schemaVersion: 1,
      commentary: { keyCommercialIssues: 'Freeze note' },
      sourceReadiness: { ledgerReady: true, certificatesReady: false },
      createdAt: '2026-04-01T12:00:00.000Z',
      createdBy: 'QS',
      currentBudget: 0,
      committed: 2364873,
      certified: 2150,
      actualCost: 0,
      manualAccrual: 100,
      currentCost: 100,
      systemForecast: 2364873,
      commercialAdjustment: 500,
      finalForecast: 2365373,
      costToComplete: 2365273,
      outstandingCertified: 2150,
      variance: -2365373,
    });

    const mapped = normalizeServerCvrSnapshot(document);
    expect(mapped.id).toBe('snap-1');
    expect(mapped.clientId).toBe('client-9');
    expect(mapped.developmentId).toBe('dev-1');
    expect(mapped.periodId).toBe('period-1');
    expect(mapped.periodKey).toBe('P01');
    expect(mapped.schemaVersion).toBe(1);
    expect(mapped.createdAt).toBe('2026-04-01T12:00:00.000Z');
    expect(mapped.createdBy).toBe('QS');
    expect(mapped.commentary.keyCommercialIssues).toBe('Freeze note');
    expect(mapped.sourceReadiness.ledgerReady).toBe(true);
    expect(mapped.sourceReadiness.certificatesReady).toBe(false);
    expect(mapped.totals.committed).toBe(2364873);
    expect(mapped.totals.certified).toBe(2150);
    expect(mapped.totals.manualAccrual).toBe(100);
    expect(mapped.totals.finalForecast).toBe(2365373);
    expect(mapped.totals.outstandingCertified).toBe(2150);
    expect(mapped.committed).toBeUndefined();
    expect(JSON.stringify(mapped)).not.toMatch(/current_budget|actual_cost|cost_code_key/);
  });

  it('maps snapshot rows including reason aliases and adjustment history', () => {
    const mapped = normalizeCvrSnapshotRow(
      buildServerCvrSnapshotRowFixture({
        costCodeKey: '5231',
        adjustmentReason: 'BL-031D UAT test adjustment',
        notes: 'Frozen overlay',
        commercialAdjustment: 500,
        committed: 50250,
        certified: 2150,
        actualCost: 0,
        manualAccrual: 100,
        currentCost: 100,
        systemForecast: 50250,
        finalForecast: 50750,
        costToComplete: 50650,
        outstandingCertified: 2150,
        variance: -50750,
      })
    );

    expect(mapped.costCodeKey).toBe('5231');
    expect(mapped.costCodeLabel).toBe('5231 — Cleaning');
    expect(mapped.committed).toBe(50250);
    expect(mapped.certified).toBe(2150);
    expect(mapped.commercialReason).toBe('BL-031D UAT test adjustment');
    expect(mapped.adjustmentReason).toBe('BL-031D UAT test adjustment');
    expect(mapped.notes).toBe('Frozen overlay');
    expect(mapped.commercialNotes).toBe('Frozen overlay');
    expect(mapped.adjustmentHistory).toHaveLength(1);
    expect(mapped.adjustmentHistory[0].newAdjustment).toBe(500);
    expect(mapped.displayMetadata.adjustmentHistory[0].reason).toBe(
      'BL-031D UAT test adjustment'
    );
    expect(JSON.stringify(mapped)).not.toMatch(/cost_code_key|manual_accrual|adjustment_reason/);
  });

  it('nests snapshot onto the period document and clears snapshotDeferred', () => {
    const snapshot = buildServerCvrSnapshotFixture();
    const mapped = normalizeServerCvrPeriod(
      buildServerCvrPeriodFixture({
        status: 'locked',
        snapshot,
        snapshotDeferred: false,
        snapshotNote: 'Immutable CVR snapshot created.',
      })
    );

    expect(mapped.status).toBe('locked');
    expect(mapped.snapshotDeferred).toBe(false);
    expect(mapped.historicUnavailable).toBe(false);
    expect(mapped.snapshot.totals.committed).toBe(2364873);
    expect(mapped.snapshot.rows[0].costCodeKey).toBe('5231');
    expect(mapped.snapshotNote).toBe('Immutable CVR snapshot created.');
  });

  it('marks locked periods without a snapshot as historic unavailable', () => {
    const mapped = normalizeServerCvrPeriod(
      buildServerCvrPeriodFixture({
        status: 'locked',
        snapshot: null,
        snapshotDeferred: true,
      })
    );
    expect(mapped.snapshot).toBeNull();
    expect(mapped.snapshotDeferred).toBe(true);
    expect(mapped.historicUnavailable).toBe(true);
  });
});
