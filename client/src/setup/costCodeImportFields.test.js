import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { getCommercialStructure } from '../admin/commercialStructureStore';
import {
  autoDetectCostCodeColumnMapping,
  buildCostCodeSourceColumnPreview,
  costCodeMappingToFieldByColumn,
  COST_CODE_IMPORT_FIELD_ORDER,
  COST_CODE_IMPORT_FIELDS,
} from './costCodeImportFields';
import {
  executeCostCodeImport,
  HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY,
  HIERARCHY_MODE_TWO_LEVEL,
  resolveCostCodeHierarchy,
  validateCostCodeImport,
} from './costCodeImportService';
import { listCostCodeMasterRecords } from '../admin/costCodeMasterStore';

describe('costCodeImportFields', () => {
  it('auto-maps common spreadsheet aliases including Cost Type as Reporting Group', () => {
    const headers = ['Cost Code', 'Cost Group', 'Cost Type', 'Description'];
    const mapping = autoDetectCostCodeColumnMapping(headers);
    const fieldByColumn = costCodeMappingToFieldByColumn(headers, mapping);

    expect(fieldByColumn).toEqual([
      'costCode',
      'commercialHead',
      'trade',
      'description',
    ]);
  });

  it('exposes reporting group mapping targets in field order', () => {
    expect(COST_CODE_IMPORT_FIELD_ORDER).toContain('reportingGroup');
    expect(COST_CODE_IMPORT_FIELDS.commercialHead.label).toBe('Commercial Head');
    expect(COST_CODE_IMPORT_FIELDS.commercialFamily.label).toBe('Commercial Family');
    expect(COST_CODE_IMPORT_FIELDS.trade.label).toBe('Reporting Group');
  });

  it('previews every detected workbook column', () => {
    const rows = [
      ['Cost Code', 'Cost Group', 'Cost Type', 'Description'],
      ['BRK', 'House Build', 'Brickwork', 'External brickwork'],
      ['ROOF', 'House Build', 'Roofing', 'Roof coverings'],
    ];

    const preview = buildCostCodeSourceColumnPreview(rows, 0, 5);
    expect(preview.headers).toEqual(['Cost Code', 'Cost Group', 'Cost Type', 'Description']);
    expect(preview.rows[0].cells).toEqual(['BRK', 'House Build', 'Brickwork', 'External brickwork']);
  });
});

describe('costCodeImportService hierarchy resolution', () => {
  beforeEach(() => storage.clear());

  it('defaults to two-level structure when commercial family is absent', () => {
    getCommercialStructure();
    const activeHeads = new Set(['land', 'house build']);
    const resolved = resolveCostCodeHierarchy(
      {
        commercialHead: 'House Build',
        commercialFamily: '',
        trade: 'Brickwork',
        description: 'External brickwork',
      },
      activeHeads,
      { hierarchyMode: HIERARCHY_MODE_TWO_LEVEL }
    );

    expect(resolved.commercialHead).toBe('House Build');
    expect(resolved.commercialFamily).toBe('');
    expect(resolved.reportingGroup).toBe('Brickwork');
  });

  it('supports three-level import when family column is mapped', () => {
    getCommercialStructure();
    const activeHeads = new Set(['house build']);
    const resolved = resolveCostCodeHierarchy(
      {
        commercialHead: 'House Build',
        commercialFamily: 'Superstructure',
        trade: 'Brickwork',
      },
      activeHeads,
      { hierarchyMode: 'three-level' }
    );

    expect(resolved.commercialFamily).toBe('Superstructure');
    expect(resolved.reportingGroup).toBe('Brickwork');
  });

  it('inserts default family only when explicitly selected', () => {
    getCommercialStructure();
    const resolved = resolveCostCodeHierarchy(
      {
        commercialHead: 'Land',
        trade: 'Vendor',
      },
      new Set(['land']),
      {
        hierarchyMode: HIERARCHY_MODE_THREE_LEVEL_DEFAULT_FAMILY,
        defaultFamilyName: 'Acquisition',
      }
    );

    expect(resolved.commercialFamily).toBe('Acquisition');
    expect(resolved.systemGeneratedFamily).toBe(true);
  });

  it('validates DMCC-style imports without artificial families', () => {
    getCommercialStructure();
    const headers = ['Cost Code', 'Cost Group', 'Cost Type', 'Description'];
    const mapping = autoDetectCostCodeColumnMapping(headers);
    const parsed = {
      headerRowIndex: 0,
      fieldByColumn: costCodeMappingToFieldByColumn(headers, mapping),
      rows: [
        headers,
        ['1100', 'Land', 'Vendor', 'Land Cost'],
        ['1110', 'Land', 'GOV', 'VAT on Land Purchase'],
        ['1170', 'Fees', 'Consultant', 'Planning Application & Supporting Fees'],
      ],
    };

    const result = validateCostCodeImport(parsed, { hierarchyMode: HIERARCHY_MODE_TWO_LEVEL });
    expect(result.summary.validCount).toBe(3);
    expect(result.validRows[0]).toMatchObject({
      commercialHead: 'Land',
      commercialFamily: '',
      reportingGroup: 'Vendor',
    });
    expect(result.validRows[1].reportingGroup).toBe('GOV');
    expect(result.validRows[2].commercialHead).toBe('Fees');
  });

  it('imports DMCC workbook rows without creating artificial families', () => {
    getCommercialStructure();
    const headers = ['Cost Code', 'Cost Group', 'Cost Type', 'Description'];
    const mapping = autoDetectCostCodeColumnMapping(headers);
    const parsed = {
      headerRowIndex: 0,
      fieldByColumn: costCodeMappingToFieldByColumn(headers, mapping),
      rows: [
        headers,
        ['1100', 'Land', 'Vendor', 'Land Cost'],
        ['1110', 'Land', 'GOV', 'VAT on Land Purchase'],
      ],
    };

    const validation = validateCostCodeImport(parsed, { hierarchyMode: HIERARCHY_MODE_TWO_LEVEL });
    const result = executeCostCodeImport(validation);

    expect(result.imported).toBe(2);
    expect(result.hierarchyMode).toBe(HIERARCHY_MODE_TWO_LEVEL);
    expect(result.familiesCreated).toBe(0);

    const records = listCostCodeMasterRecords();
    expect(records.find((item) => item.code === '1100')?.commercialFamily).toBe('');
    expect(records.find((item) => item.code === '1110')?.reportingGroup).toBe('GOV');
  });
});
