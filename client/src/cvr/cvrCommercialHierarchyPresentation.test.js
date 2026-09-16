import { describe, expect, it } from 'vitest';
import {
  buildCvrCommercialHierarchyPresentation,
  filterCvrRowsByHierarchyDescriptor,
  selectCvrCommercialHierarchy,
} from './cvrCommercialHierarchyPresentation';

const money = (costCodeKey, currentBudget, finalForecast, variance) => ({ costCodeKey, currentBudget, finalForecast, variance });
const head = (id, name) => ({ id, name, displayOrder: 1, active: true });
const group = (id, name) => ({ id, name, displayOrder: 1, active: true });
const evidence = (costCodeKey, resolutionState, extra = {}) => ({
  costCodeKey, resolutionState, head: null, family: null, reportingGroup: null,
  legacyEvidence: { commercialHead: null, commercialFamily: null, reportingGroup: null }, ...extra,
});
const authority = (state, costCodes) => ({ state, captured: state !== 'live', document: { costCodes } });

describe('CVR Commercial hierarchy presentation authority', () => {
  it('partitions every financial row once across tenant Heads and explicit exceptional states', () => {
    const rows = [
      money('A', 100, 110, -10), money('B', 200, 190, 10), money('C', 10, 10, 0),
      money('D', 20, 25, -5), money('E', 30, 30, 0), money('F', 40, 45, -5), money('G', 50, 55, -5),
    ];
    const document = [
      evidence('A', 'allocated', { head: head('h1', 'Tenant Custom'), reportingGroup: group('g1', 'Direct') }),
      evidence('B', 'allocated', { head: head('h2', 'Tenant Custom'), family: { id: 'f1', name: 'Family', active: true }, reportingGroup: group('g2', 'Nested') }),
      evidence('C', 'unallocated'), evidence('D', 'unresolved_legacy'),
      evidence('E', 'archived_assignment', { head: head('ha', 'Old') }),
      evidence('F', 'invalid_assignment'),
      evidence('HIERARCHY-ONLY', 'allocated', { head: head('h3', 'No money'), reportingGroup: group('g3', 'No money') }),
    ];
    const result = buildCvrCommercialHierarchyPresentation(rows, { status: 'draft', commercialHierarchy: authority('live', document) });
    expect(result.assignedRowCount).toBe(rows.length);
    expect(result.items.flatMap((item) => item.rows.map(({ row }) => row.costCodeKey)).sort()).toEqual(rows.map((row) => row.costCodeKey).sort());
    expect(result.items.some((item) => item.label === 'Other' || item.label === 'General')).toBe(false);
    expect(result.items.find((item) => item.headId === 'h1').families).toEqual([]);
    expect(result.items.find((item) => item.headId === 'h2').families[0].name).toBe('Family');
    expect(result.items.find((item) => item.label === 'Hierarchy needs review').resolutionStates).toEqual(['invalid_assignment', 'missing_cost_code']);
    expect(result.items.some((item) => item.label === 'No money')).toBe(false);
  });

  it('uses lifecycle-selected frozen evidence and makes historic compatibility explicit', () => {
    const live = authority('live', [evidence('A', 'allocated', { head: head('live', 'Live name'), reportingGroup: group('g', 'Group') })]);
    const frozen = authority('locked', [evidence('A', 'allocated', { head: head('frozen', 'Frozen name'), reportingGroup: group('g', 'Group') })]);
    expect(selectCvrCommercialHierarchy({ status: 'draft', commercialHierarchy: live })).toBe(live);
    expect(selectCvrCommercialHierarchy({ status: 'submitted', commercialHierarchy: { ...live, state: 'submitted' } }).state).toBe('submitted');
    expect(selectCvrCommercialHierarchy({ status: 'locked', commercialHierarchy: live, snapshot: { commercialHierarchy: frozen } })).toBe(frozen);
    const locked = buildCvrCommercialHierarchyPresentation([money('A', 1, 1, 0)], { status: 'locked', snapshot: { commercialHierarchy: frozen } });
    expect(locked.items[0].label).toBe('Frozen name');
    const nextDraft = buildCvrCommercialHierarchyPresentation([money('A', 1, 1, 0)], { status: 'draft', commercialHierarchy: live });
    expect(nextDraft.items[0].label).toBe('Live name');
    const historic = buildCvrCommercialHierarchyPresentation([money('A', 1, 1, 0)], { status: 'locked', snapshot: { commercialHierarchy: { state: 'legacy_not_captured', captured: false } } });
    expect(historic.items[0].label).toBe('Historic hierarchy not captured');
  });

  it('filters by exact captured membership, not duplicate labels or live recalculation', () => {
    const rows = [money('A', 1, 1, 0), money('B', 2, 2, 0)];
    const result = buildCvrCommercialHierarchyPresentation(rows, { status: 'submitted', commercialHierarchy: authority('submitted', [
      evidence('A', 'allocated', { head: head('h1', 'Duplicate'), reportingGroup: group('g1', 'One') }),
      evidence('B', 'allocated', { head: head('h2', 'Duplicate'), reportingGroup: group('g2', 'Two') }),
    ]) });
    expect(result.items).toHaveLength(2);
    expect(filterCvrRowsByHierarchyDescriptor(rows, result.items[0].filter).map((row) => row.costCodeKey)).toEqual(['A']);
    expect(filterCvrRowsByHierarchyDescriptor(rows, null)).toBe(rows);
  });
});
