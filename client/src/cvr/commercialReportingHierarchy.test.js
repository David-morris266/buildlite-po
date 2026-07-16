import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { addCostCentre, listCostCentres } from './costCentreStore';
import { createOrOpenDraftPeriod } from './cvrPeriodStore';
import {
  COMMERCIAL_FAMILIES,
  COMMERCIAL_HEADS,
  assertUniqueCostCodeKeys,
  buildHierarchyKeyMap,
  deriveHierarchyFromLegacy,
  migrateCostCentreHierarchy,
  normaliseCommercialFamily,
  normaliseCommercialHead,
  validateCostCentreHierarchy,
} from './commercialReportingHierarchy';
import { buildCommercialCostSummary } from './cvrSummaryHelpers';
import { buildCvrModel } from './cvrEngine';

const DEV_ID = 'dev-hierarchy-test';

describe('commercialReportingHierarchy defaults', () => {
  it('defines Doc 46 commercial heads and families', () => {
    expect(COMMERCIAL_HEADS).toContain('Land');
    expect(COMMERCIAL_HEADS).toContain('House Build');
    expect(COMMERCIAL_HEADS).toContain('Infrastructure & Utilities');
    expect(COMMERCIAL_FAMILIES).toContain('Acquisition');
    expect(COMMERCIAL_FAMILIES).toContain('General');
  });
});

describe('migrateCostCentreHierarchy', () => {
  it('retains explicit hierarchy fields when already present', () => {
    const migrated = migrateCostCentreHierarchy({
      commercialHead: 'Land',
      commercialFamily: 'Acquisition',
      trade: 'Land acquisition',
      description: 'Ignored when trade exists',
    });

    expect(migrated.commercialHead).toBe('Land');
    expect(migrated.commercialFamily).toBe('Acquisition');
    expect(migrated.trade).toBe('Land acquisition');
  });

  it('migrates legacy commercialFamily values to head and family', () => {
    const migrated = migrateCostCentreHierarchy({
      commercialFamily: 'Subcontract',
      description: 'Brickwork package',
      costCodeLabel: 'BRK — Brickwork',
    });

    expect(migrated.commercialHead).toBe('House Build');
    expect(migrated.commercialFamily).toBe('General');
    expect(migrated.trade).toBe('Brickwork package');
  });

  it('defaults missing hierarchy to Other / General / description', () => {
    const migrated = migrateCostCentreHierarchy({
      description: 'Miscellaneous allowance',
      costCodeLabel: 'MISC — Allowance',
    });

    expect(migrated.commercialHead).toBe('Other');
    expect(migrated.commercialFamily).toBe('General');
    expect(migrated.trade).toBe('Miscellaneous allowance');
  });

  it('maps legacy Land family to Land head', () => {
    const legacy = deriveHierarchyFromLegacy({
      commercialFamily: 'Land',
      description: 'Site purchase',
    });

    expect(legacy.commercialHead).toBe('Land');
    expect(legacy.commercialFamily).toBe('Acquisition');
    expect(legacy.trade).toBe('Site purchase');
  });
});

describe('validateCostCentreHierarchy', () => {
  it('ensures every cost code resolves to one head, family and trade', () => {
    const result = validateCostCentreHierarchy({
      commercialFamily: 'Materials',
      description: 'Steel frame',
      costCodeLabel: 'STL — Steel',
    });

    expect(result.valid).toBe(true);
    expect(result.hierarchy.commercialHead).toBe('House Build');
    expect(result.hierarchy.commercialFamily).toBe('General');
    expect(result.hierarchy.trade).toBe('Steel frame');
  });

  it('corrects invalid family assignments to the head default', () => {
    const result = validateCostCentreHierarchy({
      commercialHead: 'Land',
      commercialFamily: 'Roofing',
      trade: 'Roof tiles',
    });

    expect(result.valid).toBe(true);
    expect(result.hierarchy.commercialHead).toBe('Land');
    expect(result.hierarchy.commercialFamily).toBe('Acquisition');
  });
});

describe('assertUniqueCostCodeKeys', () => {
  it('flags duplicate active cost code keys', () => {
    const result = assertUniqueCostCodeKeys([
      { costCodeKey: 'brickwork', active: true },
      { costCodeKey: 'brickwork', active: true },
      { costCodeKey: 'land', active: true },
    ]);

    expect(result.valid).toBe(false);
    expect(result.duplicates).toContain('brickwork');
  });
});

describe('cost centre store migration on read', () => {
  beforeEach(() => storage.clear());

  it('migrates persisted legacy centres without losing budgets', () => {
    storage.set(
      'buildlite_cvr_v1',
      JSON.stringify({
        [DEV_ID]: {
          activePeriodKey: 'P01',
          periods: {
            P01: {
              periodKey: 'P01',
              status: 'draft',
              costCentres: [
                {
                  id: 'cc-legacy',
                  costCodeKey: 'land',
                  costCodeLabel: 'LAND — Land Costs',
                  description: 'Land acquisition',
                  commercialFamily: 'Land',
                  currentBudget: 500000,
                  originalBudget: 500000,
                  active: true,
                },
              ],
            },
          },
        },
      })
    );

    const centres = listCostCentres(DEV_ID, 'P01');
    expect(centres).toHaveLength(1);
    expect(centres[0].commercialHead).toBe('Land');
    expect(centres[0].commercialFamily).toBe('Acquisition');
    expect(centres[0].trade).toBe('Land acquisition');
    expect(centres[0].currentBudget).toBe(500000);
  });

  it('assigns hierarchy when adding new cost codes', () => {
    createOrOpenDraftPeriod(DEV_ID);
    const { costCentre } = addCostCentre(
      DEV_ID,
      {
        costCodeKey: 'brickwork',
        costCodeLabel: 'BRK — Brickwork',
        description: 'Brickwork package',
        commercialFamily: 'Subcontract',
        currentBudget: 100000,
      },
      'P01'
    );

    expect(costCentre.commercialHead).toBe('House Build');
    expect(costCentre.commercialFamily).toBe('General');
    expect(costCentre.trade).toBe('Brickwork package');
  });
});

describe('reporting aggregation by commercial head', () => {
  beforeEach(() => storage.clear());

  it('aggregates CVR rows by commercial head and reconciles totals', () => {
    createOrOpenDraftPeriod(DEV_ID);
    addCostCentre(
      DEV_ID,
      {
        costCodeKey: 'brickwork',
        costCodeLabel: 'BRK — Brickwork',
        description: 'Brickwork package',
        commercialFamily: 'Subcontract',
        currentBudget: 100000,
      },
      'P01'
    );
    addCostCentre(
      DEV_ID,
      {
        costCodeKey: 'land',
        costCodeLabel: 'LAND — Land Costs',
        description: 'Land acquisition',
        commercialFamily: 'Land',
        currentBudget: 500000,
      },
      'P01'
    );

    const model = buildCvrModel(DEV_ID, { periodKey: 'P01' });
    const centres = listCostCentres(DEV_ID, 'P01');
    const summary = buildCommercialCostSummary(model.rows, centres, model.totals);

    expect(summary.items.some((item) => item.head === 'Land')).toBe(true);
    expect(summary.items.some((item) => item.head === 'House Build')).toBe(true);
    expect(summary.totals.reconciles).toBe(true);
    expect(summary.totals.budgetLabel).toBe('£600,000.00');
  });

  it('exposes nested families for future drill-down', () => {
    createOrOpenDraftPeriod(DEV_ID);
    addCostCentre(
      DEV_ID,
      {
        costCodeKey: 'land',
        costCodeLabel: 'LAND — Land Costs',
        description: 'Land acquisition',
        commercialFamily: 'Land',
        currentBudget: 500000,
      },
      'P01'
    );

    const centres = listCostCentres(DEV_ID, 'P01');
    const hierarchyMap = buildHierarchyKeyMap(centres);
    const landItem = buildCommercialCostSummary(
      buildCvrModel(DEV_ID, { periodKey: 'P01' }).rows,
      centres,
      buildCvrModel(DEV_ID, { periodKey: 'P01' }).totals
    ).items.find((item) => item.head === 'Land');

    expect(hierarchyMap.get('land')?.commercialHead).toBe('Land');
    expect(landItem?.drillDownLevel).toBe('head');
    expect(landItem?.families).toContain('Acquisition');
  });
});

describe('legacy compatibility', () => {
  it('normalises historical summary aliases to reporting heads', () => {
    expect(normaliseCommercialHead('Direct Cost')).toBe('House Build');
    expect(normaliseCommercialHead('Professional Fees')).toBe('Professional Fees');
    expect(normaliseCommercialFamily('Subcontract', 'House Build')).toBe('General');
  });
});
