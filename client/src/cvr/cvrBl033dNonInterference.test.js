import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateFinalForecast, calculateSystemForecast } from './cvrForecastEngine';
import { calculateCostToComplete } from './cvrCalculations';
import { normalizeServerCvrSnapshot } from './cvrSnapshotMapper';
import { buildServerCvrRevenueSnapshotFixture } from '../test/mockCvrPeriodApi';

describe('BL-033D.1 CVR non-interference', () => {
  it('keeps P04 5231 Standard CVR money as committed + QS adjustment', () => {
    const systemForecast = calculateSystemForecast({
      committed: 50280,
      actualCost: 0,
      currentBudget: 0,
    });
    expect(systemForecast).toBe(50280);
    expect(calculateFinalForecast(systemForecast, 520)).toBe(50800);
    expect(calculateCostToComplete(50800, 0, 120)).toBe(50680);
  });

  it('does not feed Prelims proposal values into CVR, snapshot, or close helpers', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      'cvrEngine.js',
      'cvrForecastEngine.js',
      'cvrSummaryHelpers.js',
      'cvrSnapshotMapper.js',
      'cvrReportingMonth.js',
    ];
    const interference =
      /development_prelims_items|calculateTimeLine|calculateLumpSumLine|prelimsProposal|Review & Adopt/;
    for (const file of files) {
      expect(readFileSync(join(dir, file), 'utf8')).not.toMatch(interference);
    }
  });

  it('keeps P03 schema-v2 snapshot totals unchanged', () => {
    const v2 = normalizeServerCvrSnapshot(
      buildServerCvrRevenueSnapshotFixture({
        schemaVersion: 2,
        committed: 2365423,
        forecastRevenue: 10444608,
        remainingForecastRevenue: 10444608,
        plotsRemaining: 31,
        grossProfit: 8079185,
        grossMarginPct: 77.3527,
      })
    );
    expect(v2.schemaVersion).toBe(2);
    expect(v2.totals.forecastRevenue).toBe(10444608);
    expect(v2.totals.grossProfit).toBe(8079185);
  });
});
