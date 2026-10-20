import { describe, expect, it } from 'vitest';
import { buildActiveDevelopmentGiaSummary, calculateCostPerFt2 } from './cvrGiaSummary';
import { normalizeServerCvrSnapshot } from './cvrSnapshotMapper';

const development = (plots) => ({ id: 'dev-1', plotMaster: { plots } });

describe('CVR active Development GIA authority', () => {
  it('uses every active plot regardless of tenure and excludes inactive plots', () => {
    const result = buildActiveDevelopmentGiaSummary({ development: development([
      { id: '1', status: 'Active', tenureCode: 'OPEN_MARKET', gia: 750 },
      { id: '2', status: 'Active', tenureCode: 'AFFORDABLE_RENT', gia: 950 },
      { id: '3', status: 'Inactive', gia: 5000 },
    ]) });
    expect(result).toEqual({ activePlotCount: 2, activePlotGiaFt2: 1700, giaComplete: true, giaUnavailableReason: null });
    expect(calculateCostPerFt2(340000, result)).toBe(200);
  });

  it.each([null, 0, -1, 'bad'])('fails closed when active GIA is %s', (gia) => {
    const result = buildActiveDevelopmentGiaSummary({ development: development([
      { id: '1', status: 'Active', gia: 750 }, { id: '2', status: 'Active', gia },
    ]) });
    expect(result.giaComplete).toBe(false);
    expect(result.activePlotGiaFt2).toBeNull();
    expect(calculateCostPerFt2(100, result)).toBeNull();
  });

  it('uses frozen historic evidence and never falls back to live plots', () => {
    const live = development([{ id: 'live', status: 'Active', gia: 9999 }]);
    const snapshot = { giaEvidence: {
      captured: true, availabilityState: 'complete', activePlotCount: 2, totalActiveGia: 1700,
    } };
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot }).activePlotGiaFt2).toBe(1700);
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot: {} }).giaComplete).toBe(false);
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot: { ...snapshot, developmentId: 'another-development' } }).giaComplete).toBe(false);
  });

  it('fails historic values closed when captured GIA is incomplete', () => {
    const result = buildActiveDevelopmentGiaSummary({
      development: development([{ id: 'live', status: 'Active', gia: 9999 }]),
      historic: true,
      snapshot: { giaEvidence: { captured: true, availabilityState: 'incomplete', activePlotCount: 2, totalActiveGia: null } },
    });
    expect(result).toMatchObject({ activePlotCount: 2, activePlotGiaFt2: null, giaComplete: false });
  });

  it('round-trips authoritative server GIA through the snapshot mapper without live fallback', () => {
    const snapshot = normalizeServerCvrSnapshot({
      id: 'snapshot-1', developmentId: 'dev-1', schemaVersion: 3, rows: [], plots: [],
      giaEvidence: {
        captured: true, evidenceSchemaVersion: 1, availabilityState: 'complete',
        activePlotCount: 2, totalPlotCount: 2, activePlotGiaCount: 2,
        capturedValidActiveGia: 1770.3, totalActiveGia: 1770.3, plots: [],
      },
    });
    const summary = buildActiveDevelopmentGiaSummary({
      development: development([{ id: 'live', status: 'Active', gia: 9999 }]),
      historic: true,
      snapshot,
    });
    expect(summary).toEqual({ activePlotCount: 2, activePlotGiaFt2: 1770.3, giaComplete: true, giaUnavailableReason: null });
  });

  it('matches the Hawthorn-shaped 24 plot / 25,000 ft² fixture', () => {
    const plots = [
      ...Array.from({ length: 4 }, (_, i) => ({ id: `a${i}`, status: 'Active', gia: 750 })),
      ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, status: 'Active', gia: 950 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, status: 'Active', gia: 1050 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, status: 'Active', gia: 1350 })),
    ];
    expect(buildActiveDevelopmentGiaSummary({ development: development(plots) })).toMatchObject({ activePlotCount: 24, activePlotGiaFt2: 25000, giaComplete: true });
  });
});
