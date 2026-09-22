import { describe, expect, it } from 'vitest';
import { commercialHeadCostCodeDiscovery } from './commercialHeadCostCodeDiscovery';

const structure = { heads: [{ id: 'selling', name: 'Sales & Marketing', buildliteCategory: 'SELLING_COSTS', active: true }, { id: 'prelims', name: 'Preliminaries', buildliteCategory: 'PRELIMINARIES', active: true }], families: [], reportingGroups: [{ id: 'office', headId: 'selling', name: 'Sales Offices', active: true }] };
const costCodes = [{ id: 'a', code: '6170', commercialHeadId: 'selling', reportingGroupId: 'office', active: true }, { id: 'b', code: '2100', commercialHeadId: 'prelims', active: true }, { id: 'c', code: 'OLD', commercialHeadId: 'selling', active: false }, { id: 'd', code: 'NONE', commercialHeadId: null, active: true }];

describe('Commercial Head Cost Code discovery', () => {
  it('joins category to stable active Head membership without inference', () => {
    const result = commercialHeadCostCodeDiscovery({ structure, costCodes, category: 'SELLING_COSTS' });
    expect(result.state).toBe('ready');
    expect(result.headLabel).toBe('Sales & Marketing');
    expect(result.suggested.map((row) => row.id)).toEqual(['a']);
    expect(result.suggested[0].hierarchyContext).toBe('Sales & Marketing → Sales Offices');
    expect(result.all.map((row) => row.id)).toEqual(['a', 'b', 'd']);
  });
  it('uses the same authority contract for Preliminaries', () => {
    const result = commercialHeadCostCodeDiscovery({ structure, costCodes, category: 'PRELIMINARIES' });
    expect(result.headLabel).toBe('Preliminaries');
    expect(result.suggested.map((row) => row.id)).toEqual(['b']);
  });
  it('retains an out-of-Head current mapping without counting it as suggested', () => {
    const result = commercialHeadCostCodeDiscovery({ structure, costCodes, category: 'SELLING_COSTS', currentCostCodeId: 'b' });
    expect(result.suggestedCount).toBe(1);
    expect(result.suggested.map((row) => row.id)).toEqual(['b', 'a']);
    expect(result.currentOutsideSuggestedHead).toBe(true);
  });
  it('fails closed for missing, archived and ambiguous category authority', () => {
    const missing = commercialHeadCostCodeDiscovery({ structure, costCodes, category: 'HOUSE_BUILD', currentCostCodeId: 'b' });
    expect(missing.state).toBe('missing');
    expect(missing.suggested.map((row) => row.id)).toEqual(['b']);
    expect(commercialHeadCostCodeDiscovery({ structure: { ...structure, heads: [{ id: 'x', buildliteCategory: 'SELLING_COSTS', active: false }] }, costCodes, category: 'SELLING_COSTS' }).state).toBe('archived');
    expect(commercialHeadCostCodeDiscovery({ structure: { ...structure, heads: [...structure.heads, { id: 'x', buildliteCategory: 'SELLING_COSTS', active: true }] }, costCodes, category: 'SELLING_COSTS' }).state).toBe('ambiguous');
  });
  it('returns an exact Hawthorn-shaped 18-code Selling Costs membership', () => {
    const sellingRows = Array.from({ length: 18 }, (_, index) => ({ id: `selling-${index}`, code: String(6100 + index * 10), commercialHeadId: 'selling', active: true }));
    const otherRows = Array.from({ length: 192 }, (_, index) => ({ id: `other-${index}`, code: `O-${index}`, commercialHeadId: 'prelims', active: true }));
    const result = commercialHeadCostCodeDiscovery({ structure, costCodes: [...sellingRows, ...otherRows], category: 'SELLING_COSTS' });
    expect(result.suggestedCount).toBe(18);
    expect(result.suggested).toHaveLength(18);
    expect(result.all).toHaveLength(210);
  });
  it('reflects live Head rename and Cost Code moves without persisted discovery state', () => {
    const renamed = { ...structure, heads: structure.heads.map((head) => head.id === 'selling' ? { ...head, name: 'Customer Sales' } : head) };
    const moved = costCodes.map((code) => code.id === 'a' ? { ...code, commercialHeadId: 'prelims' } : code);
    expect(commercialHeadCostCodeDiscovery({ structure: renamed, costCodes, category: 'SELLING_COSTS' }).headLabel).toBe('Customer Sales');
    expect(commercialHeadCostCodeDiscovery({ structure, costCodes: moved, category: 'SELLING_COSTS' }).suggested).toEqual([]);
  });
});
