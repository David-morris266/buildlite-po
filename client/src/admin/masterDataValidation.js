import {
  buildMasterCodeLookup,
  countLiveCvrHierarchyUsage,
  countLivePoHierarchyUsage,
  extractCostCodeFromReference,
  isLivePurchaseOrder,
  readCvrStoreSnapshot,
} from './masterDataUsage';
import {isCostCodeServerAuthorityEnabled} from './costCodeAuthority';
import {getCommercialStructure} from './commercialStructureStore';
import {listCostCodeMasterRecords} from './costCodeMasterStore';

function issue(id, severity, title, detail, records = []) {
  return { id, severity, title, detail, count: records.length, affectedRecords: records.map(({ id: recordId, code }) => ({ id: recordId, code })) };
}

export function findDuplicateCostCodes(records = []) {
  const seen = new Map();
  const duplicates = [];

  for (const record of records) {
    const key = String(record.code || '').trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push(record);
    } else {
      seen.set(key, record);
    }
  }

  return duplicates;
}

export function findInactiveCostCodesInUse({
  records = [],
  purchaseOrders = [],
  cvrSnapshot = readCvrStoreSnapshot(),
} = {}) {
  const inactiveCodes = new Set(
    records.filter((item) => item.active === false).map((item) => item.code.toLowerCase())
  );
  if (!inactiveCodes.size) return [];

  const matches = new Set();
  const lookup = buildMasterCodeLookup(records);

  for (const po of purchaseOrders) {
    if (!isLivePurchaseOrder(po)) continue;
    const code = extractCostCodeFromReference(
      po.costRef?.costCode || po.costCode || ''
    ).toLowerCase();
    if (inactiveCodes.has(code)) matches.add(code);
  }

  for (const development of Object.values(cvrSnapshot)) {
    if (!development || typeof development !== 'object') continue;
    for (const period of Object.values(development)) {
      if (!period || typeof period !== 'object') continue;
      for (const centre of period.costCentres || []) {
        const code = String(centre.costCode || centre.code || '').trim().toLowerCase();
        if (inactiveCodes.has(code)) matches.add(code);
        const master = lookup.get(code);
        if (master && master.active === false) matches.add(code);
      }
    }
  }

  return [...matches].map((code) => lookup.get(code) || { code });
}

function hasLegacyHierarchyEvidence(record = {}) {
  return [record.commercialHead, record.commercialFamily, record.reportingGroup, record.trade]
    .some((value) => String(value || '').trim());
}

export function classifyCostCodeHierarchy(records = [], structure = { heads: [], families: [], reportingGroups: [] }) {
  const heads = new Map((structure.heads || []).map((item) => [item.id, item]));
  const families = new Map((structure.families || []).map((item) => [item.id, item]));
  const groups = new Map((structure.reportingGroups || []).map((item) => [item.id, item]));
  const result = { unallocated: [], unresolvedLegacy: [], invalidAssignments: [], valid: [] };
  for (const record of records) {
    const hasStableIdentity = Boolean(record.commercialHeadId || record.commercialFamilyId || record.reportingGroupId);
    if (!hasStableIdentity) {
      result[hasLegacyHierarchyEvidence(record) ? 'unresolvedLegacy' : 'unallocated'].push(record);
      continue;
    }
    const head = heads.get(record.commercialHeadId);
    const family = record.commercialFamilyId ? families.get(record.commercialFamilyId) : null;
    const group = groups.get(record.reportingGroupId);
    const valid = Boolean(
      head && head.active !== false && !head.archived &&
      (!record.commercialFamilyId || (family && family.active !== false && !family.archived && family.headId === head.id)) &&
      group && group.active !== false && !group.archived && group.headId === head.id &&
      (group.familyId || null) === (record.commercialFamilyId || null)
    );
    result[valid ? 'valid' : 'invalidAssignments'].push(record);
  }
  return result;
}

const legacyStructure=()=>isCostCodeServerAuthorityEnabled()?{heads:[],families:[],reportingGroups:[]}:getCommercialStructure();
const legacyRecords=()=>isCostCodeServerAuthorityEnabled()?[]:listCostCodeMasterRecords();

export function findUnusedTrades(structure = {reportingGroups:[]}, records = []) {
  const used=new Set(records.map(x=>x.reportingGroupId).filter(Boolean));return (structure.reportingGroups||[]).filter(x=>x.active!==false&&!used.has(x.id)).map(x=>({trade:x.name}));
}

export function findUnusedCommercialFamilies(
  structure = {heads:[],families:[]},
  records = []
) {
  const usedFamilyKeys = new Set(
    records.map((item) => item.commercialFamilyId).filter(Boolean)
  );

  const unused = [];
  for (const family of structure.families.filter((item) => item.active!==false&&!item.archived)) {
    const head = structure.heads.find((item) => item.id === family.headId && !item.archived);
    if (!head) continue;
    if (!usedFamilyKeys.has(family.id) && family.name !== 'General') {
      unused.push({ head: head.name, family: family.name });
    }
  }
  return unused;
}

export function runMasterDataValidation({
  purchaseOrders = [],
  records = legacyRecords(),
  structure = legacyStructure(),
  cvrSnapshot = readCvrStoreSnapshot(),
} = {}) {
  const duplicateCodes = findDuplicateCostCodes(records);
  const hierarchy = classifyCostCodeHierarchy(records, structure);
  const inactiveInUse = findInactiveCostCodesInUse({
    records,
    purchaseOrders,
    cvrSnapshot,
  });
  const unusedTrades = findUnusedTrades(structure, records);
  const unusedFamilies = findUnusedCommercialFamilies(structure, records);

  const issues = [];

  if (hierarchy.unresolvedLegacy.length) {
    issues.push(
      issue(
        'unresolved-hierarchy',
        'warning',
        'Hierarchy requires review',
        'Cost Codes with legacy commercial hierarchy information that has not yet been linked to the tenant Commercial Structure.',
        hierarchy.unresolvedLegacy
      )
    );
  }

  if (hierarchy.invalidAssignments.length) {
    issues.push(
      issue(
        'invalid-hierarchy',
        'warning',
        'Inactive or invalid hierarchy assignment',
        'Cost Codes linked to an archived, inactive or mismatched Commercial Head, Family or Reporting Group.',
        hierarchy.invalidAssignments
      )
    );
  }

  if (duplicateCodes.length) {
    issues.push(
      issue(
        'duplicate-codes',
        'error',
        'Duplicate Cost Codes',
        'Multiple master records share the same cost code.',
        duplicateCodes
      )
    );
  }

  if (inactiveInUse.length) {
    issues.push(
      issue(
        'inactive-in-use',
        'warning',
        'Inactive Cost Codes in use',
        'Inactive master cost codes are referenced by live purchase orders or CVR cost centres.',
        inactiveInUse
      )
    );
  }

  if (unusedTrades.length) {
    issues.push(
      issue(
        'unused-trades',
        'info',
        'Unused Trades',
        'Active trades with no linked master cost codes.',
        unusedTrades
      )
    );
  }

  if (unusedFamilies.length) {
    issues.push(
      issue(
        'unused-families',
        'info',
        'Unused Commercial Families',
        'Active commercial families with no linked master cost codes.',
        unusedFamilies
      )
    );
  }

  return {
    healthy: issues.every((item) => item.severity === 'info'),
    issues,
    details: {
      duplicateCodes,
      hierarchy,
      inactiveInUse,
      unusedTrades,
      unusedFamilies,
    },
    usage: {
      purchaseOrders: countLivePoHierarchyUsage(purchaseOrders, records),
      cvrCostCentres: countLiveCvrHierarchyUsage(cvrSnapshot),
    },
  };
}

export function buildReportingStructurePreview(
  structure = legacyStructure(),
  records = legacyRecords()
) {
  const heads = structure.heads
    .filter((item) => item.active!==false&&!item.archived)
    .sort((a, b) => (a.displayOrder??a.sortOrder) - (b.displayOrder??b.sortOrder));

  return heads.map((head) => {
    const buildReportingGroup = (group, familyId = null) => {
      const costCodes = records
        .filter(
          (item) =>
            item.commercialHeadId === head.id &&
            (item.commercialFamilyId || null) === familyId &&
            item.reportingGroupId === group.id &&
            item.active !== false
        )
        .sort((a, b) => (a.reportingOrder ?? 0) - (b.reportingOrder ?? 0) || a.code.localeCompare(b.code));

      return {
        id: group.id,
        name: group.name,
        costCodeCount: costCodes.length,
        costCodes: costCodes.map((item) => ({
          code: item.code,
          description: item.description,
        })),
      };
    };
    const directReportingGroups = (structure.reportingGroups || structure.trades || [])
      .filter((item) => item.headId === head.id && item.familyId == null && item.active !== false && !item.archived)
      .sort((a, b) => (a.displayOrder ?? a.sortOrder) - (b.displayOrder ?? b.sortOrder))
      .map((group) => buildReportingGroup(group));
    const families = structure.families
      .filter((item) => item.headId === head.id && item.active!==false&&!item.archived)
      .sort((a, b) => (a.displayOrder??a.sortOrder) - (b.displayOrder??b.sortOrder))
      .map((family) => {
        const trades = (structure.reportingGroups||structure.trades||[])
          .filter((item) => item.familyId === family.id && item.active!==false&&!item.archived)
          .sort((a, b) => (a.displayOrder??a.sortOrder) - (b.displayOrder??b.sortOrder))
          .map((trade) => buildReportingGroup(trade, family.id));

        return {
          id: family.id,
          name: family.name,
          trades,
          costCodeCount: trades.reduce((sum, item) => sum + item.costCodeCount, 0),
        };
      });

    return {
      id: head.id,
      name: head.name,
      directReportingGroups,
      families,
      costCodeCount:
        directReportingGroups.reduce((sum, item) => sum + item.costCodeCount, 0) +
        families.reduce((sum, item) => sum + item.costCodeCount, 0),
    };
  });
}
