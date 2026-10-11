import { describe, expect, it } from 'vitest';
import { buildCostCodeCompleteness, completenessCommercialHeads, filterUnrepresentedCostCodes, representedCostCodeKeys } from './cvrCostCodeCompleteness';

const master = [
  { code: '1000', description: 'Budgeted', commercialHead: 'Build', active: true },
  { code: ' 2000 ', description: 'Fact only', commercialHead: 'Build', active: true },
  { code: '3000', description: 'Zero overlay', commercialHead: 'Professional Fees', active: true },
  { code: '4000', description: 'Rendering', commercialHead: 'Build', commercialFamily: 'External finishes', active: true },
  { code: '5000', description: 'Archived', commercialHead: 'Selling', active: false },
  { code: '6000', description: 'No hierarchy', active: true },
];

describe('CVR Cost Code completeness', () => {
  it('excludes budget, fact-only and explicit zero-overlay membership using normalised identity', () => {
    const represented = representedCostCodeKeys({
      rows: [{ costCodeKey: '1000' }, { costCodeKey: ' 2 0 0 0 ', id: 'auto-2000' }],
      inputs: [{ costCodeKey: '3000', currentBudget: null, commercialAdjustment: 0 }],
    });
    const result = buildCostCodeCompleteness(master, represented);
    expect(result.activeCount).toBe(5);
    expect(result.representedCount).toBe(3);
    expect(result.unrepresented.map((item) => item.code)).toEqual(['4000', '6000']);
  });

  it('searches descriptions and filters by Commercial Head', () => {
    const items = buildCostCodeCompleteness(master, ['1000', '2000', '3000']).unrepresented;
    expect(filterUnrepresentedCostCodes(items, { query: 'render' }).map((item) => item.code)).toEqual(['4000']);
    expect(filterUnrepresentedCostCodes(items, { commercialHead: 'Build' }).map((item) => item.code)).toEqual(['4000']);
    expect(completenessCommercialHeads(items)).toEqual(['Build', 'Unclassified']);
  });
});
