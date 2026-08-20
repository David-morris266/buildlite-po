import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildServerCvrSnapshotFixture } from '../test/mockCvrPeriodApi';
import { normalizeServerCvrSnapshot } from './cvrSnapshotMapper';

describe('BL-032A CVR non-interference', () => {
  it('keeps snapshot schema v1 and cost-only totals', () => {
    const mapped = normalizeServerCvrSnapshot(
      buildServerCvrSnapshotFixture({
        schemaVersion: 1,
        committed: 2364873,
        revenue: 0,
      })
    );
    expect(mapped.schemaVersion).toBe(1);
    expect(mapped.totals.committed).toBe(2364873);
    expect(mapped.totals.revenue).toBeUndefined();
    expect(mapped.totals.forecastRevenue).toBeNull();
    expect(mapped.totals.grossProfit).toBeNull();
  });

  it('keeps the cost engine free of live Revenue formulas', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const engine = readFileSync(join(dir, 'cvrEngine.js'), 'utf8');
    const helpers = readFileSync(join(dir, 'cvrSummaryHelpers.js'), 'utf8');
    expect(engine).not.toMatch(/buildRevenueSummary|getPricedPlots|getRevenuePricingContext/);
    expect(helpers).toContain("key: 'forecastRevenue'");
    expect(helpers).not.toContain("hint: 'Revenue Engine not yet available'");
  });
});
