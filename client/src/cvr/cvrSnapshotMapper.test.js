import { describe, expect, it } from 'vitest';
import {
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  buildServerCvrSnapshotRowFixture,
  buildServerCvrRevenueSnapshotFixture,
  buildServerCvrSnapshotPlotFixture,
} from '../test/mockCvrPeriodApi';
import { normalizeServerCvrPeriod } from './cvrPeriodServerMapper';
import {
  normalizeCvrSnapshotRow,
  normalizeServerCvrSnapshot,
  snapshotHasFrozenRevenue,
} from './cvrSnapshotMapper';

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
    expect(mapped.totals.forecastRevenue).toBeNull();
    expect(mapped.totals.expectedLiability).toBeNull();
    expect(mapped.totals.expectedLiabilityCaptured).toBe(false);
    expect(mapped.totals.grossProfit).toBeNull();
    expect(mapped.plots).toEqual([]);
    expect(mapped.committed).toBeUndefined();
    expect(JSON.stringify(mapped)).not.toMatch(/current_budget|actual_cost|cost_code_key/);
  });

  it('maps schema-v3 frozen Expected and provenance without consulting live CE state', () => {
    const mapped = normalizeServerCvrSnapshot(
      buildServerCvrSnapshotFixture({
        schemaVersion: 3,
        expectedLiability: 20000,
        expectedLiabilityCaptured: true,
        systemForecast: 10000,
        commercialAdjustment: 5000,
        finalForecast: 35000,
        rows: [
          buildServerCvrSnapshotRowFixture({
            expectedLiability: 20000,
            expectedLiabilityCaptured: true,
            systemForecast: 10000,
            commercialAdjustment: 5000,
            finalForecast: 35000,
            expectedLiabilityProvenance: [
              {
                ceId: 'ce-1',
                eventNumber: 'CE-0001',
                costCode: '5231',
                factualValue: 20000,
                statusAtLock: 'submitted',
                expectedTreatment: 'default',
                overrideAmount: null,
                effectiveExpectedAmount: 20000,
                reason: null,
              },
            ],
          }),
        ],
      })
    );
    expect(mapped.totals.expectedLiability).toBe(20000);
    expect(mapped.totals.expectedLiabilityCaptured).toBe(true);
    expect(mapped.rows[0].expectedLiability).toBe(20000);
    expect(mapped.rows[0].expectedLiabilityProvenance[0].eventNumber).toBe('CE-0001');
    expect(
      mapped.rows[0].systemForecast +
        mapped.rows[0].expectedLiability +
        mapped.rows[0].commercialAdjustment
    ).toBe(mapped.rows[0].finalForecast);
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

  it('maps schema-v2 Revenue totals and plot snapshot rows', () => {
    const mapped = normalizeServerCvrSnapshot(
      buildServerCvrRevenueSnapshotFixture({
        forecastRevenue: 10444608,
        securedRevenue: 0,
        remainingForecastRevenue: 10444608,
        plotsSold: 0,
        plotsRemaining: 1,
        grossProfit: 8079185,
        grossMarginPercent: 77.3512,
        plots: [
          buildServerCvrSnapshotPlotFixture({
            plotId: 'plot-31',
            plotNumber: '31',
            forecastRevenue: 255100,
          }),
        ],
      })
    );
    expect(mapped.schemaVersion).toBe(2);
    expect(mapped.totals.forecastRevenue).toBe(10444608);
    expect(mapped.totals.remainingForecast).toBe(10444608);
    expect(mapped.totals.grossProfit).toBe(8079185);
    expect(mapped.plots[0].plotNumber).toBe('31');
    expect(mapped.plots[0].forecastRevenue).toBe(255100);
    expect(snapshotHasFrozenRevenue(mapped)).toBe(true);
  });
});
