import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api.js', () => ({
  listCostCodes: vi.fn(async () => [
    { code: '1000', trade: 'Brickwork', element: 'External Walls', is_active: true },
  ]),
}));

import { getCompanySettings, saveCompanySettings } from './companyStore';
import {
  addCommercialFamily,
  addCommercialHead,
  getCommercialStructure,
  getActiveHeadNames,
} from './commercialStructureStore';
import {
  addCostCodeMasterRecord,
  ensureCostCodeMasterSeeded,
  listCostCodeMasterRecords,
  searchCostCodeMasterRecords,
  updateCostCodeMasterRecord,
} from './costCodeMasterStore';
import {
  getCommercialBehaviourSettings,
  saveCommercialBehaviour,
} from './commercialBehaviourStore';
import {
  countLivePoHierarchyUsage,
  extractCostCodeFromReference,
} from './masterDataUsage';
import {
  buildReportingStructurePreview,
  runMasterDataValidation,
} from './masterDataValidation';
import { addClient, listClients } from './clientStore';
import { isAdminView, ADMIN_VIEWS } from './masterDataService';

describe('companyStore', () => {
  beforeEach(() => storage.clear());

  it('persists company settings', () => {
    const saved = saveCompanySettings({
      companyName: 'BuildLite Homes Ltd',
      tradingName: 'BuildLite',
      currency: 'GBP',
      defaultCvrPeriod: 'Monthly',
      vatRate: 20,
      defaultRetentionPercent: 5,
      defaultForecastBehaviour: 'Committed',
      registeredOffice: '1 High Street',
      website: 'https://buildlite.example',
      numberingPrefixes: {
        purchaseOrder: 'PO-',
        variationOrder: 'VO-',
        salesPlot: 'SP-',
      },
    });

    expect(saved.companyName).toBe('BuildLite Homes Ltd');
    expect(getCompanySettings().tradingName).toBe('BuildLite');
    expect(getCompanySettings().numberingPrefixes.purchaseOrder).toBe('PO-');
    expect(getCompanySettings().numberingPrefixes.variationOrder).toBe('VO-');
    expect(getCompanySettings().vatRate).toBe(20);
    expect(getCompanySettings().registeredOffice).toBe('1 High Street');
  });
});

describe('commercialStructureStore', () => {
  beforeEach(() => storage.clear());

  it('initialises Doc 46 default hierarchy', () => {
    const structure = getCommercialStructure();
    expect(structure.heads.length).toBeGreaterThan(0);
    expect(structure.families.length).toBeGreaterThan(0);
    expect(structure.trades.length).toBeGreaterThan(0);
    expect(getActiveHeadNames()).toContain('Land');
  });

  it('persists added commercial heads and families', () => {
    const headResult = addCommercialHead('Custom Head');
    expect(headResult.ok).toBe(true);

    const head = getCommercialStructure().heads.find((item) => item.name === 'Custom Head');
    const familyResult = addCommercialFamily(head.id, 'Custom Family');
    expect(familyResult.ok).toBe(true);

    const families = getCommercialStructure().families.filter((item) => item.headId === head.id);
    expect(families.some((item) => item.name === 'Custom Family')).toBe(true);
  });
});

describe('costCodeMasterStore', () => {
  beforeEach(() => storage.clear());

  it('seeds from legacy server cost codes and supports updates', async () => {
    await ensureCostCodeMasterSeeded();
    const records = listCostCodeMasterRecords();
    expect(records.length).toBeGreaterThan(0);

    const created = addCostCodeMasterRecord({
      code: 'BRK',
      description: 'Brickwork',
      commercialHead: 'House Build',
      commercialFamily: 'General',
      trade: 'Brickwork',
    });
    expect(created.ok).toBe(true);

    const updated = updateCostCodeMasterRecord(created.record.id, {
      description: 'Brickwork package',
      defaultOrderType: 'S',
      reportingOrder: 10,
      allowBudget: true,
      allowPurchaseOrders: true,
    });
    expect(updated.ok).toBe(true);
    expect(updated.record.description).toBe('Brickwork package');
    expect(updated.record.reportingOrder).toBe(10);
  });

  it('searches cost codes across hierarchy fields', async () => {
    await ensureCostCodeMasterSeeded();
    addCostCodeMasterRecord({
      code: 'ROOF-01',
      description: 'Roof coverings',
      commercialHead: 'House Build',
      commercialFamily: 'Roofing',
      trade: 'Roof',
    });

    const matches = searchCostCodeMasterRecords('roof');
    expect(matches.some((item) => item.code === 'ROOF-01')).toBe(true);
  });
});

describe('commercialBehaviourStore', () => {
  beforeEach(() => storage.clear());

  it('persists per-head commercial behaviour settings', () => {
    getCommercialStructure();
    const result = saveCommercialBehaviour('House Build', {
      forecastSource: 'Budget',
      includeOnExecutiveSummary: true,
    });
    expect(result.ok).toBe(true);
    expect(getCommercialBehaviourSettings().behaviours['House Build'].forecastSource).toBe('Budget');
  });
});

describe('master data validation and usage', () => {
  beforeEach(() => storage.clear());

  it('extracts cost code keys from PO references', () => {
    expect(extractCostCodeFromReference('1000 — Brickwork — Walls')).toBe('1000');
  });

  it('counts live PO hierarchy usage from master records', async () => {
    await ensureCostCodeMasterSeeded();
    addCostCodeMasterRecord({
      code: 'BRK',
      description: 'Brickwork',
      commercialHead: 'House Build',
      commercialFamily: 'General',
      trade: 'Brickwork',
    });

    const counts = countLivePoHierarchyUsage([
      { costRef: { costCode: 'BRK — Brickwork — Walls' }, archived: false },
      { costRef: { costCode: 'BRK — Brickwork — Walls' }, archived: true },
    ]);

    expect(counts.heads['House Build']).toBe(1);
  });

  it('builds reporting preview and validation report', async () => {
    getCommercialStructure();
    await ensureCostCodeMasterSeeded();

    const preview = buildReportingStructurePreview();
    expect(preview.length).toBeGreaterThan(0);

    const validation = runMasterDataValidation({ purchaseOrders: [] });
    expect(validation).toHaveProperty('issues');
    expect(validation).toHaveProperty('healthy');
  });
});

describe('clientStore', () => {
  beforeEach(() => storage.clear());

  it('persists client records', () => {
    const result = addClient({
      name: 'Riverside Developments',
      address: '1 High Street',
      contact: 'Jane Smith',
    });
    expect(result.ok).toBe(true);
    expect(listClients()).toHaveLength(1);
  });
});

describe('admin navigation helpers', () => {
  it('recognises administration views', () => {
    expect(ADMIN_VIEWS).toContain('company');
    expect(ADMIN_VIEWS).toContain('commercial-structure');
    expect(ADMIN_VIEWS).toContain('commercial-behaviour');
    expect(ADMIN_VIEWS).toContain('reporting-preview');
    expect(ADMIN_VIEWS).toContain('setup-data-import');
    expect(ADMIN_VIEWS).toContain('setup-assistant');
    expect(isAdminView('suppliers')).toBe(true);
    expect(isAdminView('unknown')).toBe(false);
  });
});
