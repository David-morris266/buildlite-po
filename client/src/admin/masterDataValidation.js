import { getActiveHeadNames, getCommercialStructure } from './commercialStructureStore';
import { listCostCodeMasterRecords } from './costCodeMasterStore';
import {
  buildMasterCodeLookup,
  countLiveCvrHierarchyUsage,
  countLivePoHierarchyUsage,
  extractCostCodeFromReference,
  isLivePurchaseOrder,
  readCvrStoreSnapshot,
} from './masterDataUsage';

function issue(id, severity, title, detail, count = 0) {
  return { id, severity, title, detail, count };
}

export function findDuplicateCostCodes(records = listCostCodeMasterRecords()) {
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
  records = listCostCodeMasterRecords(),
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

export function findMissingCommercialHeadAssignments(records = listCostCodeMasterRecords()) {
  const activeHeads = new Set(getActiveHeadNames().map((item) => item.toLowerCase()));
  return records.filter((record) => {
    const head = String(record.commercialHead || '').trim();
    return !head || !activeHeads.has(head.toLowerCase());
  });
}

export function findMissingTradeAssignments(
  records = listCostCodeMasterRecords(),
  structure = getCommercialStructure()
) {
  const tradeKeys = new Set(
    structure.trades
      .filter((item) => !item.archived)
      .map((item) => {
        const family = structure.families.find((familyItem) => familyItem.id === item.familyId);
        const head = structure.heads.find((headItem) => headItem.id === family?.headId);
        return `${head?.name || ''}::${family?.name || ''}::${item.name}`.toLowerCase();
      })
  );

  return records.filter((record) => {
    const key = `${record.commercialHead}::${record.commercialFamily}::${record.trade}`.toLowerCase();
    return !tradeKeys.has(key);
  });
}

export function findUnusedTrades(structure = getCommercialStructure(), records = listCostCodeMasterRecords()) {
  const usedTradeKeys = new Set(
    records.map(
      (item) => `${item.commercialHead}::${item.commercialFamily}::${item.trade}`.toLowerCase()
    )
  );

  const unused = [];
  for (const trade of structure.trades.filter((item) => !item.archived)) {
    const family = structure.families.find((item) => item.id === trade.familyId && !item.archived);
    if (!family) continue;
    const head = structure.heads.find((item) => item.id === family.headId && !item.archived);
    if (!head) continue;
    const key = `${head.name}::${family.name}::${trade.name}`.toLowerCase();
    if (!usedTradeKeys.has(key) && trade.name !== 'General') {
      unused.push({ head: head.name, family: family.name, trade: trade.name });
    }
  }
  return unused;
}

export function findUnusedCommercialFamilies(
  structure = getCommercialStructure(),
  records = listCostCodeMasterRecords()
) {
  const usedFamilyKeys = new Set(
    records.map((item) => `${item.commercialHead}::${item.commercialFamily}`.toLowerCase())
  );

  const unused = [];
  for (const family of structure.families.filter((item) => !item.archived)) {
    const head = structure.heads.find((item) => item.id === family.headId && !item.archived);
    if (!head) continue;
    const key = `${head.name}::${family.name}`.toLowerCase();
    if (!usedFamilyKeys.has(key) && family.name !== 'General') {
      unused.push({ head: head.name, family: family.name });
    }
  }
  return unused;
}

export function runMasterDataValidation({
  purchaseOrders = [],
  records = listCostCodeMasterRecords(),
  structure = getCommercialStructure(),
  cvrSnapshot = readCvrStoreSnapshot(),
} = {}) {
  const duplicateCodes = findDuplicateCostCodes(records);
  const missingHeads = findMissingCommercialHeadAssignments(records);
  const missingTrades = findMissingTradeAssignments(records, structure);
  const inactiveInUse = findInactiveCostCodesInUse({
    records,
    purchaseOrders,
    cvrSnapshot,
  });
  const unusedTrades = findUnusedTrades(structure, records);
  const unusedFamilies = findUnusedCommercialFamilies(structure, records);

  const issues = [];

  if (missingHeads.length) {
    issues.push(
      issue(
        'missing-head',
        'error',
        'Missing Commercial Head',
        'Cost codes without a valid active Commercial Head assignment.',
        missingHeads.length
      )
    );
  }

  if (missingTrades.length) {
    issues.push(
      issue(
        'missing-trade',
        'warning',
        'Missing Trade',
        'Cost codes referencing trades that are not in the active commercial structure.',
        missingTrades.length
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
        duplicateCodes.length
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
        inactiveInUse.length
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
        unusedTrades.length
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
        unusedFamilies.length
      )
    );
  }

  return {
    healthy: issues.every((item) => item.severity === 'info'),
    issues,
    details: {
      duplicateCodes,
      missingHeads,
      missingTrades,
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
  structure = getCommercialStructure(),
  records = listCostCodeMasterRecords()
) {
  const heads = structure.heads
    .filter((item) => !item.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return heads.map((head) => {
    const families = structure.families
      .filter((item) => item.headId === head.id && !item.archived)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((family) => {
        const trades = structure.trades
          .filter((item) => item.familyId === family.id && !item.archived)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((trade) => {
            const costCodes = records
              .filter(
                (item) =>
                  item.commercialHead === head.name &&
                  item.commercialFamily === family.name &&
                  item.trade === trade.name &&
                  item.active !== false
              )
              .sort((a, b) => (a.reportingOrder ?? 0) - (b.reportingOrder ?? 0) || a.code.localeCompare(b.code));

            return {
              id: trade.id,
              name: trade.name,
              costCodeCount: costCodes.length,
              costCodes: costCodes.map((item) => ({
                code: item.code,
                description: item.description,
              })),
            };
          });

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
      families,
      costCodeCount: families.reduce((sum, item) => sum + item.costCodeCount, 0),
    };
  });
}
