import { countCostCodeHierarchyUsage, listCostCodeMasterRecords } from './costCodeMasterStore';

const CVR_STORAGE_KEY = 'buildlite_cvr_v1';

function emptyUsageCounts() {
  return { heads: {}, families: {}, trades: {} };
}

function incrementCount(bucket, key) {
  if (!key) return;
  bucket[key] = (bucket[key] || 0) + 1;
}

export function extractCostCodeFromReference(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const [code] = raw.split(' — ');
  return String(code || raw).trim();
}

export function buildMasterCodeLookup(records = listCostCodeMasterRecords()) {
  const lookup = new Map();
  for (const record of records) {
    lookup.set(String(record.code || '').trim().toLowerCase(), record);
  }
  return lookup;
}

function resolveHierarchyFromCostCode(costCodeValue, lookup) {
  const code = extractCostCodeFromReference(costCodeValue).toLowerCase();
  const master = lookup.get(code);
  if (!master) return null;
  return {
    commercialHead: master.commercialHead,
    commercialFamily: master.commercialFamily,
    trade: master.trade,
  };
}

function addHierarchyToCounts(counts, hierarchy) {
  if (!hierarchy) return;
  incrementCount(counts.heads, hierarchy.commercialHead);
  incrementCount(
    counts.families,
    `${hierarchy.commercialHead}::${hierarchy.commercialFamily}`
  );
  incrementCount(
    counts.trades,
    `${hierarchy.commercialHead}::${hierarchy.commercialFamily}::${hierarchy.trade}`
  );
}

export function readCvrStoreSnapshot() {
  try {
    const raw = localStorage.getItem(CVR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function countLiveCvrHierarchyUsage(snapshot = readCvrStoreSnapshot()) {
  const counts = emptyUsageCounts();

  for (const development of Object.values(snapshot)) {
    if (!development || typeof development !== 'object') continue;
    for (const period of Object.values(development)) {
      if (!period || typeof period !== 'object') continue;
      const centres = Array.isArray(period.costCentres) ? period.costCentres : [];
      for (const centre of centres) {
        if (!centre) continue;
        addHierarchyToCounts(counts, {
          commercialHead: centre.commercialHead,
          commercialFamily: centre.commercialFamily,
          trade: centre.trade,
        });
      }
    }
  }

  return counts;
}

export function isLivePurchaseOrder(po = {}) {
  return po.archived !== true && po.isArchived !== true;
}

export function countLivePoHierarchyUsage(
  purchaseOrders = [],
  records = listCostCodeMasterRecords()
) {
  const counts = emptyUsageCounts();
  const lookup = buildMasterCodeLookup(records);

  for (const po of purchaseOrders) {
    if (!isLivePurchaseOrder(po)) continue;
    const costCodeValue =
      po.costRef?.costCode || po.costCode || po.costRef?.code || '';
    const hierarchy = resolveHierarchyFromCostCode(costCodeValue, lookup);
    if (hierarchy) {
      addHierarchyToCounts(counts, hierarchy);
      continue;
    }

    const directHead = po.commercialHead || po.costRef?.commercialHead;
    const directFamily = po.commercialFamily || po.costRef?.commercialFamily;
    const directTrade = po.trade || po.costRef?.trade;
    if (directHead) {
      addHierarchyToCounts(counts, {
        commercialHead: directHead,
        commercialFamily: directFamily || 'General',
        trade: directTrade || 'General',
      });
    }
  }

  return counts;
}

function mergeUsageCounts(...sources) {
  const merged = emptyUsageCounts();
  for (const source of sources) {
    for (const [key, value] of Object.entries(source.heads || {})) {
      merged.heads[key] = (merged.heads[key] || 0) + value;
    }
    for (const [key, value] of Object.entries(source.families || {})) {
      merged.families[key] = (merged.families[key] || 0) + value;
    }
    for (const [key, value] of Object.entries(source.trades || {})) {
      merged.trades[key] = (merged.trades[key] || 0) + value;
    }
  }
  return merged;
}

export function getCombinedHierarchyUsage({
  purchaseOrders = [],
  costCodeCounts = null,
  cvrCounts = null,
} = {}) {
  const masterCounts = costCodeCounts || countCostCodeHierarchyUsage();
  const poCounts = countLivePoHierarchyUsage(purchaseOrders);
  const liveCvrCounts = cvrCounts || countLiveCvrHierarchyUsage();

  return {
    costCodes: masterCounts,
    purchaseOrders: poCounts,
    cvrCostCentres: liveCvrCounts,
    combined: mergeUsageCounts(masterCounts, poCounts, liveCvrCounts),
  };
}

export function getHierarchyUsageSummary({
  headName,
  familyName = null,
  tradeName = null,
  usage = null,
} = {}) {
  const data = usage || getCombinedHierarchyUsage();

  if (tradeName != null) {
    const tradeKey = `${headName}::${familyName ?? ''}::${tradeName}`;
    return {
      costCodes: data.costCodes.trades[tradeKey] || 0,
      purchaseOrders: data.purchaseOrders.trades[tradeKey] || 0,
      cvrCostCentres: data.cvrCostCentres.trades[tradeKey] || 0,
      total: data.combined.trades[tradeKey] || 0,
    };
  }

  if (familyName != null && familyName !== '') {
    const familyKey = `${headName}::${familyName}`;
    return {
      costCodes: data.costCodes.families[familyKey] || 0,
      purchaseOrders: data.purchaseOrders.families[familyKey] || 0,
      cvrCostCentres: data.cvrCostCentres.families[familyKey] || 0,
      total: data.combined.families[familyKey] || 0,
    };
  }

  return {
    costCodes: data.costCodes.heads[headName] || 0,
    purchaseOrders: data.purchaseOrders.heads[headName] || 0,
    cvrCostCentres: data.cvrCostCentres.heads[headName] || 0,
    total: data.combined.heads[headName] || 0,
  };
}
