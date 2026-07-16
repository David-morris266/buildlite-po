import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import {
  buildCommercialStructureKpis,
  buildCommercialStructureTreeModel,
  buildImportMetadata,
  detectImportHierarchyMapping,
  explainHeadCountDelta,
  formatFamilyDisplay,
  HIERARCHY_MODE_TWO_LEVEL,
  inferDefaultHierarchyMode,
  migrateImportedCostCodeRecord,
  resolveCostCodeReportingPath,
} from './costCodeHierarchy';
import { getCommercialStructure } from './commercialStructureStore';
import { buildCommercialCostSummary } from '../cvr/cvrSummaryHelpers';

describe('costCodeHierarchy', () => {
  beforeEach(() => storage.clear());

  it('detects absent commercial family mapping', () => {
    const detection = detectImportHierarchyMapping([
      'costCode',
      'commercialHead',
      'trade',
      'description',
    ]);
    expect(detection.commercialFamilyAbsent).toBe(true);
    expect(inferDefaultHierarchyMode(detection)).toBe(HIERARCHY_MODE_TWO_LEVEL);
  });

  it('resolves two-level reporting paths without default families', () => {
    const resolved = resolveCostCodeReportingPath(
      { commercialHead: 'Land', trade: 'Vendor', description: 'Land Cost' },
      { hierarchyMode: HIERARCHY_MODE_TWO_LEVEL, activeHeads: new Set(['land']) }
    );
    expect(resolved.commercialFamily).toBe('');
    expect(resolved.reportingGroup).toBe('Vendor');
  });

  it('formats empty family as em dash in previews', () => {
    expect(formatFamilyDisplay('')).toBe('—');
    expect(formatFamilyDisplay('Superstructure')).toBe('Superstructure');
  });

  it('builds two-level commercial structure tree nodes from cost codes', () => {
    getCommercialStructure();
    const tree = buildCommercialStructureTreeModel(
      [
        { id: '1', code: '1100', description: 'Land Cost', commercialHead: 'Land', commercialFamily: '', trade: 'Vendor' },
        { id: '2', code: '1110', description: 'VAT on Land Purchase', commercialHead: 'Land', commercialFamily: '', trade: 'GOV' },
      ],
      getCommercialStructure()
    );

    const land = tree.find((item) => item.name === 'Land');
    expect(land?.families).toEqual([]);
    expect(land?.reportingGroups.map((item) => item.name).sort()).toEqual(['GOV', 'Vendor']);
  });

  it('builds three-level tree nodes when families are present', () => {
    getCommercialStructure();
    const tree = buildCommercialStructureTreeModel(
      [
        {
          id: '1',
          code: '5205',
          description: 'Brickwork',
          commercialHead: 'House Build',
          commercialFamily: 'Superstructure',
          trade: 'Brickwork',
        },
      ],
      getCommercialStructure()
    );

    const houseBuild = tree.find((item) => item.name === 'House Build');
    expect(houseBuild?.families.some((item) => item.name === 'Superstructure')).toBe(true);
  });

  it('clears system-generated families during targeted migration', () => {
    const migrated = migrateImportedCostCodeRecord({
      code: '1100',
      commercialHead: 'Land',
      commercialFamily: 'Acquisition',
      trade: 'Vendor',
      importMetadata: buildImportMetadata({
        hierarchyMode: HIERARCHY_MODE_TWO_LEVEL,
        hadFamilyMapping: false,
        systemGeneratedFamily: true,
      }),
    });

    expect(migrated.commercialFamily).toBe('');
    expect(migrated.hierarchyMode).toBe(HIERARCHY_MODE_TWO_LEVEL);
    expect(migrated.importMetadata.systemGeneratedFamilyCleared).toBe(true);
  });

  it('preserves manually assigned families during migration', () => {
    const preserved = migrateImportedCostCodeRecord({
      code: '5205',
      commercialHead: 'House Build',
      commercialFamily: 'Superstructure',
      trade: 'Brickwork',
      importMetadata: {
        hierarchyMode: 'three-level',
        hadFamilyMapping: true,
        familyManuallyChanged: true,
      },
    });

    expect(preserved.commercialFamily).toBe('Superstructure');
  });

  it('reconciles commercial cost summary totals with optional families', () => {
    const centres = [
      { costCodeKey: '1100', commercialHead: 'Land', commercialFamily: '', trade: 'Vendor' },
      { costCodeKey: '1110', commercialHead: 'Land', commercialFamily: '', trade: 'GOV' },
    ];
    const rows = [
      { costCodeKey: '1100', currentBudget: 100, finalForecast: 90, variance: -10 },
      { costCodeKey: '1110', currentBudget: 50, finalForecast: 45, variance: -5 },
    ];

    const summary = buildCommercialCostSummary(rows, centres, {
      currentBudget: 150,
      finalForecast: 135,
      variance: -15,
    });

    expect(summary.available).toBe(true);
    expect(summary.totals.reconciles).toBe(true);
    expect(summary.items[0]?.trades).toContain('Vendor');
  });

  it('counts only in-use hierarchy nodes for KPI cards', () => {
    getCommercialStructure();
    const costCodes = [
      { code: '1100', commercialHead: 'Land', commercialFamily: '', trade: 'Vendor' },
      { code: '1110', commercialHead: 'Land', commercialFamily: '', trade: 'GOV' },
      { code: '1170', commercialHead: 'Fees', commercialFamily: '', trade: 'Consultant' },
    ];
    const kpis = buildCommercialStructureKpis(costCodes, getCommercialStructure());

    expect(kpis.headsInUse).toBe(2);
    expect(kpis.familiesInUse).toBe(0);
    expect(kpis.reportingGroupsInUse).toBe(3);
    expect(kpis.costCodes).toBe(3);
    expect(kpis.catalogueFamilies).toBeGreaterThan(0);
    expect(kpis.families.activeLabel).toBe('None');
    expect(kpis.families.suffix).toBe('Active');
    expect(kpis.families.availableLabel).toContain('Available');
  });

  it('explains import head count delta when catalogue heads are matched', () => {
    const explanation = explainHeadCountDelta({
      headsInUse: 9,
      headsCreated: 8,
      headsMatched: 1,
    });

    expect(explanation.headsInUse).toBe(9);
    expect(explanation.message).toContain('8');
    expect(explanation.message).toContain('1');
  });
});
