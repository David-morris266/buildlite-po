// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({ period: null, centres: [] }));

vi.mock('./costCentreStore', () => ({
  listCostCentres: () => fixtures.centres,
  getDevelopmentNotes: () => '',
  getPeriodData: () => fixtures.period,
  upsertAutoCostCentre: () => null,
}));
vi.mock('../api', () => ({ listPOs: () => [] }));
vi.mock('../certificates/certificateStore', () => ({ listCertificatesForDevelopment: () => [] }));
vi.mock('../commercial/commercialEvents', () => ({ listCommercialEvents: () => [] }));
vi.mock('../commercial/variationOrders', () => ({ listVariationOrders: () => [] }));
vi.mock('../ledger/ledgerStore', () => ({ listLedgerTransactions: () => [] }));

import { buildCvrModel, buildCvrRows } from './cvrEngine';

describe('Development Budget CVR consumption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.period = null;
    fixtures.centres = [
      { id: 'brick', costCodeKey: '4120', costCodeLabel: '4120 — Brickwork', originalBudget: 245000, currentBudget: 245000, commercialAdjustment: 15000, manualAccrual: 0 },
      { id: 'land', costCodeKey: '1100', costCodeLabel: '1100 — Land Cost', originalBudget: 1650000, currentBudget: 1650000, commercialAdjustment: 2500, manualAccrual: 7000 },
    ];
  });

  it('uses authoritative exact per-code budgets instead of legacy CVR budget fields', () => {
    const period = { budgetSource: { adopted: true, document: { positions: [{ costCode: '4120', description: 'Brickwork', originalPence: 10000000, currentPence: 11000000 }] } } };
    const rows = buildCvrRows('dev', { periodKey: 'P01', period });
    const row = rows.find(item => item.costCodeKey === '4120');
    const land = rows.find(item => item.costCodeKey === '1100');
    expect(row.originalBudget).toBe(100000);
    expect(row.currentBudget).toBe(110000);
    expect(row.commercialAdjustment).toBe(15000);
    expect(row.variance).toBe(110000 - row.finalForecast);
    expect(land.originalBudget).toBe(0);
    expect(land.currentBudget).toBe(0);
    expect(land.commercialAdjustment).toBe(2500);
    expect(land.manualAccrual).toBe(7000);
    expect(rows.reduce((sum, item) => sum + (item.originalBudget || 0), 0)).toBe(100000);
    expect(rows.reduce((sum, item) => sum + (item.currentBudget || 0), 0)).toBe(110000);
  });

  it('forwards the hydrated Draft period so Register calculations include Development Budget authority', () => {
    fixtures.centres = [{ id: 'forecast', costCodeKey: '4120', costCodeLabel: '4120 — Brickwork', originalBudget: 0, currentBudget: 0, commercialAdjustment: 5070449, manualAccrual: 0 }];
    fixtures.period = { periodKey: 'P02', status: 'draft', budgetSourceMode: 'development_budget', budgetSource: { state: 'live', adopted: true, document: { positions: [{ costCode: '4120', description: 'Brickwork', originalPence: 19000000, currentPence: 19700000 }] } } };
    const model = buildCvrModel('dev', { periodKey: 'P02' });
    expect(model.summary.currentBudget).toBe(197000);
    expect(model.summary.finalForecast).toBe(5267449);
    expect(model.summary.variance).toBe(-5070449);
  });

  it('preserves legacy CVR input-budget behaviour', () => {
    fixtures.centres = [{ id: 'legacy', costCodeKey: '4120', costCodeLabel: '4120 — Brickwork', originalBudget: 190000, currentBudget: 197000, commercialAdjustment: 5070449, manualAccrual: 0 }];
    fixtures.period = { periodKey: 'P02', status: 'draft', budgetSourceMode: 'legacy_cvr', budgetSource: { state: 'legacy_cvr', adopted: false } };
    const model = buildCvrModel('dev', { periodKey: 'P02' });
    expect(model.summary.currentBudget).toBe(197000);
    expect(model.summary.finalForecast).toBe(5267449);
    expect(model.summary.variance).toBe(-5070449);
  });
});
