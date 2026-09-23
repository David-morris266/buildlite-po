import { describe, expect, it } from 'vitest';
import { buildActiveDevelopmentGiaSummary, calculateCostPerFt2 } from './cvrGiaSummary';

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
    const snapshot = { sourceReadiness: { plotMaster: { value: [
      { id: 'frozen-1', status: 'Active', gia: 750 },
      { id: 'frozen-2', status: 'Active', gia: 950 },
    ] } } };
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot }).activePlotGiaFt2).toBe(1700);
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot: {} }).giaComplete).toBe(false);
    expect(buildActiveDevelopmentGiaSummary({ development: live, historic: true, snapshot: { ...snapshot, developmentId: 'another-development' } }).giaComplete).toBe(false);
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
