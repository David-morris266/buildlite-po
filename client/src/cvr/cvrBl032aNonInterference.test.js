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
  });

  it('keeps CVR Summary revenue/profit placeholders', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'cvrSummaryHelpers.js'),
      'utf8'
    );
    expect(source).toContain("hint: 'Revenue Engine not yet available'");
    expect(source).toContain("key: 'forecastRevenue'");
    expect(source).toContain("value: '—'");
  });
});
