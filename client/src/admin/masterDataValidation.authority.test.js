import { describe, expect, it } from 'vitest';
import { classifyCostCodeHierarchy, runMasterDataValidation } from './masterDataValidation';

const structure = {
  heads: [{ id: 'h1', active: true }, { id: 'h2', active: true }, { id: 'ha', active: false }],
  families: [{ id: 'f1', headId: 'h2', active: true }, { id: 'fa', headId: 'h2', active: false }],
  reportingGroups: [
    { id: 'g1', headId: 'h1', familyId: null, active: true },
    { id: 'g2', headId: 'h2', familyId: 'f1', active: true },
    { id: 'ga', headId: 'h2', familyId: 'f1', active: false },
  ],
};
const record = (code, patch = {}) => ({ id: `id-${code}`, code, active: true, ...patch });

describe('authoritative Cost Code hierarchy validation', () => {
  it('separates Unallocated, unresolved legacy, valid paths and inactive/invalid assignments', () => {
    const records = [
      record('UATC02'),
      record('LEGACY', { commercialHead: 'Legacy Head', trade: 'Legacy Group' }),
      record('TWO', { commercialHeadId: 'h1', reportingGroupId: 'g1' }),
      record('THREE', { commercialHeadId: 'h2', commercialFamilyId: 'f1', reportingGroupId: 'g2' }),
      record('ARCHIVED-HEAD', { commercialHeadId: 'ha', reportingGroupId: 'g1' }),
      record('ARCHIVED-FAMILY', { commercialHeadId: 'h2', commercialFamilyId: 'fa', reportingGroupId: 'g2' }),
      record('ARCHIVED-GROUP', { commercialHeadId: 'h2', commercialFamilyId: 'f1', reportingGroupId: 'ga' }),
      record('MISMATCH', { commercialHeadId: 'h1', commercialFamilyId: 'f1', reportingGroupId: 'g2' }),
    ];
    const result = classifyCostCodeHierarchy(records, structure);
    expect(result.unallocated.map(({ code }) => code)).toEqual(['UATC02']);
    expect(result.unresolvedLegacy.map(({ code }) => code)).toEqual(['LEGACY']);
    expect(result.valid.map(({ code }) => code)).toEqual(['TWO', 'THREE']);
    expect(result.invalidAssignments.map(({ code }) => code)).toEqual(['ARCHIVED-HEAD', 'ARCHIVED-FAMILY', 'ARCHIVED-GROUP', 'MISMATCH']);
  });

  it('reports one actionable legacy issue using Reporting Group terminology and stable identity', () => {
    const records = [record('UATC02'), record('LEGACY', { commercialHead: 'Old', trade: 'Old trade' })];
    const report = runMasterDataValidation({ records, structure, purchaseOrders: [], cvrSnapshot: {} });
    const legacy = report.issues.find(({ id }) => id === 'unresolved-hierarchy');
    expect(legacy).toMatchObject({ title: 'Hierarchy requires review', count: 1 });
    expect(legacy.affectedRecords).toEqual([{ id: 'id-LEGACY', code: 'LEGACY' }]);
    expect(JSON.stringify(report.issues)).not.toMatch(/Missing Trade/);
  });
});
