import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateFinalForecast, calculateSystemForecast } from './cvrForecastEngine';
import { normalizeServerCvrSnapshot } from './cvrSnapshotMapper';
import {
  buildServerCvrRevenueSnapshotFixture,
  buildServerCvrSnapshotFixture,
} from '../test/mockCvrPeriodApi';

describe('BL-033C CVR, snapshot, and classification non-interference', () => {
  it('keeps systemForecast and finalForecast as committed + QS adjustment', () => {
    const systemForecast = calculateSystemForecast({
      committed: 50250,
      actualCost: 0,
      currentBudget: 0,
    });
    expect(systemForecast).toBe(50250);
    expect(calculateFinalForecast(systemForecast, 500)).toBe(50750);
  });

  it('does not feed programme, classification, or prelims engines into CVR formulas', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const engine = readFileSync(join(dir, 'cvrEngine.js'), 'utf8');
    const forecast = readFileSync(join(dir, 'cvrForecastEngine.js'), 'utf8');
    const mapper = readFileSync(join(dir, 'cvrSnapshotMapper.js'), 'utf8');
    const helpers = readFileSync(join(dir, 'cvrSummaryHelpers.js'), 'utf8');
    const interference =
      /semanticGroup|forecastDriver|costCodeClassification|development_programme|siteStart|durationMonths|prelimsEngine|adoptedEngineFinal/;
    expect(engine).not.toMatch(interference);
    expect(forecast).not.toMatch(interference);
    expect(mapper).not.toMatch(interference);
    expect(helpers).not.toMatch(interference);
    expect(forecast).not.toMatch(/max\(systemForecast/);
  });

  it('does not add a Prelims TIME or LUMP_SUM forecast calculator', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = [
      'cvrEngine.js',
      'cvrForecastEngine.js',
      'cvrSummaryHelpers.js',
      'cvrSnapshotMapper.js',
    ];
    for (const file of files) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source).not.toMatch(/calculateTimeForecast|calculateLumpSumForecast|development_prelims_items/);
    }
  });

  it('keeps P01/P02 v1 snapshots cost-only and P03 v2 Revenue snapshots intact', () => {
    const v1 = normalizeServerCvrSnapshot(
      buildServerCvrSnapshotFixture({
        schemaVersion: 1,
        committed: 2364873,
        revenue: 0,
      })
    );
    expect(v1.schemaVersion).toBe(1);
    expect(v1.totals.forecastRevenue).toBeNull();
    expect(v1.totals.grossProfit).toBeNull();

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
