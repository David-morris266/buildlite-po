import { listCostCodes as fetchServerCostCodes } from '../api';

import { DEFAULT_COMMERCIAL_FAMILY, DEFAULT_COMMERCIAL_HEAD } from '../cvr/commercialReportingHierarchy';

import {

  getReportingGroup,

  HIERARCHY_MODE_THREE_LEVEL,

  HIERARCHY_MODE_TWO_LEVEL,

  migrateImportedCostCodeRecords,

} from './costCodeHierarchy';

import { getActiveFamilyNames, getActiveHeadNames, getActiveTradeNames } from './commercialStructureStore';

import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';

import { notifyMasterDataChanged } from './masterDataEvents';



export const COST_CODE_MASTER_KEY = 'buildlite_cost_codes_master_v1';



function emptyStore() {

  return { costCodes: [], seededFromServer: false, updatedAt: null, migrationVersion: 0 };

}



export function getCostCodeMasterStore() {

  const stored = readAdminStore(COST_CODE_MASTER_KEY, {});

  return {

    ...emptyStore(),

    ...stored,

    costCodes: stored.costCodes || [],

  };

}



function saveStore(store) {

  const next = { ...store, updatedAt: new Date().toISOString() };

  writeAdminStore(COST_CODE_MASTER_KEY, next);

  notifyMasterDataChanged('cost-codes');

  return next;

}



function isTwoLevelRecord(record = {}) {

  if (record.hierarchyMode === HIERARCHY_MODE_TWO_LEVEL) return true;

  if (record.hierarchyMode === HIERARCHY_MODE_THREE_LEVEL) return false;

  if (record.importMetadata?.hierarchyMode === HIERARCHY_MODE_TWO_LEVEL) return true;

  return !String(record.commercialFamily || '').trim() && Boolean(getReportingGroup(record));

}



function resolveHierarchyDefaults(record = {}) {

  const heads = getActiveHeadNames();

  const commercialHead = heads.includes(record.commercialHead)

    ? record.commercialHead

    : heads[0] || DEFAULT_COMMERCIAL_HEAD;



  const familyInput = String(record.commercialFamily || '').trim();

  const twoLevel = isTwoLevelRecord(record);



  let commercialFamily = '';

  if (!twoLevel) {

    const families = getActiveFamilyNames(commercialHead);

    commercialFamily = families.includes(familyInput)

      ? familyInput

      : familyInput || families[0] || DEFAULT_COMMERCIAL_FAMILY;

  }



  const reportingGroup = getReportingGroup(record);

  const trades = getActiveTradeNames(commercialHead, commercialFamily);

  const trade = trades.includes(reportingGroup)

    ? reportingGroup

    : reportingGroup || trades[0] || record.description || record.code || 'General';



  return {

    commercialHead,

    commercialFamily,

    trade,

    reportingGroup: trade,

    hierarchyMode: twoLevel ? HIERARCHY_MODE_TWO_LEVEL : HIERARCHY_MODE_THREE_LEVEL,

  };

}



function normaliseCostCodeRecord(record) {

  const hierarchy = resolveHierarchyDefaults(record);

  const reportingGroup = hierarchy.reportingGroup || hierarchy.trade;



  return {

    id: record.id || newAdminId('ccm'),

    code: String(record.code || '').trim(),

    description: String(record.description || '').trim(),

    commercialHead: hierarchy.commercialHead,

    commercialFamily: hierarchy.commercialFamily,

    trade: hierarchy.trade,

    reportingGroup,

    hierarchyMode: record.hierarchyMode || hierarchy.hierarchyMode,

    reportingOrder: Number.isFinite(Number(record.reportingOrder))

      ? Number(record.reportingOrder)

      : 0,

    active: record.active !== false,

    defaultVatTreatment: record.defaultVatTreatment || 'Standard',

    defaultOrderType: record.defaultOrderType || 'S',

    allowBudget: record.allowBudget !== false,

    allowPurchaseOrders: record.allowPurchaseOrders !== false,

    allowLedgerImport: record.allowLedgerImport !== false,

    allowForecastAdjustment: record.allowForecastAdjustment !== false,

    notes: String(record.notes || ''),

    importMetadata: record.importMetadata || null,

    createdAt: record.createdAt || new Date().toISOString(),

    updatedAt: new Date().toISOString(),

  };

}



function runStoreMigration(store) {

  if (store.migrationVersion >= 1) return store;

  const migratedCodes = migrateImportedCostCodeRecords(store.costCodes || []).map(normaliseCostCodeRecord);

  return {

    ...store,

    costCodes: migratedCodes,

    migrationVersion: 1,

  };

}



export function ensureCostCodeMasterMigrated() {

  const store = getCostCodeMasterStore();

  const migrated = runStoreMigration(store);

  if (migrated.migrationVersion !== store.migrationVersion) {

    return saveStore(migrated);

  }

  return store;

}



export async function ensureCostCodeMasterSeeded() {

  ensureCostCodeMasterMigrated();

  const store = getCostCodeMasterStore();

  if (store.costCodes.length || store.seededFromServer) return store;



  try {

    const progressRaw = localStorage.getItem('buildlite_setup_progress_v1');

    if (progressRaw) {

      return saveStore({ ...store, seededFromServer: true });

    }

  } catch {

    /* continue to legacy seed */

  }



  try {

    const serverCodes = await fetchServerCostCodes('');

    const imported = (Array.isArray(serverCodes) ? serverCodes : [])

      .map((item) =>

        normaliseCostCodeRecord({

          code: item.code,

          description: item.element || item.subHeading || item.trade || item.code,

          trade: item.trade || item.element || 'General',

          commercialHead: DEFAULT_COMMERCIAL_HEAD,

          commercialFamily: DEFAULT_COMMERCIAL_FAMILY,

          hierarchyMode: HIERARCHY_MODE_THREE_LEVEL,

          active: item.is_active !== false,

        })

      )

      .filter((item) => item.code);



    return saveStore({

      ...store,

      costCodes: imported,

      seededFromServer: true,

    });

  } catch {

    return saveStore({ ...store, seededFromServer: true });

  }

}



export function listCostCodeMasterRecords({ activeOnly = false } = {}) {

  ensureCostCodeMasterMigrated();

  const store = getCostCodeMasterStore();

  const records = store.costCodes.map(normaliseCostCodeRecord);

  const sorted = [...records].sort(

    (a, b) =>

      (a.reportingOrder ?? 0) - (b.reportingOrder ?? 0) ||

      a.code.localeCompare(b.code)

  );

  return activeOnly ? sorted.filter((item) => item.active) : sorted;

}



export function searchCostCodeMasterRecords(query, { activeOnly = false } = {}) {

  const needle = String(query || '').trim().toLowerCase();

  const records = listCostCodeMasterRecords({ activeOnly });

  if (!needle) return records;



  return records.filter((record) => {

    const haystack = [

      record.code,

      record.description,

      record.trade,

      record.reportingGroup,

      record.commercialFamily,

      record.commercialHead,

      record.notes,

    ]

      .join(' ')

      .toLowerCase();

    return haystack.includes(needle);

  });

}



export function getCostCodeMasterRecord(id) {

  return listCostCodeMasterRecords().find((item) => item.id === id) || null;

}



export function validateCostCodeMasterPayload(payload = {}) {

  const errors = [];

  const code = String(payload.code || '').trim();

  const description = String(payload.description || '').trim();

  const commercialHead = String(payload.commercialHead || '').trim();

  const reportingGroup = getReportingGroup(payload);

  const commercialFamily = String(payload.commercialFamily || '').trim();



  if (!code) errors.push('Cost code is required.');

  if (!description) errors.push('Description is required.');

  if (!commercialHead) errors.push('Commercial Head is required.');

  if (!reportingGroup) errors.push('Reporting Group is required.');



  return {

    valid: errors.length === 0,

    errors,

    normalised: {

      code,

      description,

      commercialHead,

      commercialFamily,

      trade: reportingGroup,

      reportingGroup,

      hierarchyMode: commercialFamily ? HIERARCHY_MODE_THREE_LEVEL : HIERARCHY_MODE_TWO_LEVEL,

    },

  };

}



export function addCostCodeMasterRecord(payload) {

  const validation = validateCostCodeMasterPayload(payload);

  if (!validation.valid) return { ok: false, errors: validation.errors };



  const store = getCostCodeMasterStore();

  if (store.costCodes.some((item) => item.code.toLowerCase() === validation.normalised.code.toLowerCase())) {

    return { ok: false, errors: ['Cost code already exists.'] };

  }



  const record = normaliseCostCodeRecord({

    ...payload,

    ...validation.normalised,

    importMetadata: payload.importMetadata || null,

  });

  return { ok: true, record, store: saveStore({ ...store, costCodes: [...store.costCodes, record] }) };

}



export function updateCostCodeMasterRecord(id, patch) {

  const store = getCostCodeMasterStore();

  const index = store.costCodes.findIndex((item) => item.id === id);

  if (index < 0) return { ok: false, errors: ['Cost code not found.'] };



  const merged = { ...store.costCodes[index], ...patch, id };

  const validation = validateCostCodeMasterPayload(merged);

  if (!validation.valid) return { ok: false, errors: validation.errors };



  const existingMeta = store.costCodes[index].importMetadata || {};

  const familyChanged =

    patch.commercialFamily !== undefined &&

    String(patch.commercialFamily || '').trim() !== String(store.costCodes[index].commercialFamily || '').trim();



  const nextRecord = normaliseCostCodeRecord({

    ...merged,

    ...validation.normalised,

    importMetadata: familyChanged

      ? { ...existingMeta, familyManuallyChanged: true }

      : existingMeta,

  });



  const costCodes = [...store.costCodes];

  costCodes[index] = nextRecord;

  return { ok: true, record: nextRecord, store: saveStore({ ...store, costCodes }) };

}



export function countCostCodeHierarchyUsage() {

  const counts = { heads: {}, families: {}, trades: {} };

  for (const record of listCostCodeMasterRecords()) {

    counts.heads[record.commercialHead] = (counts.heads[record.commercialHead] || 0) + 1;

    const familyKey = `${record.commercialHead}::${record.commercialFamily || ''}`;

    counts.families[familyKey] = (counts.families[familyKey] || 0) + 1;

    const tradeKey = `${record.commercialHead}::${record.commercialFamily || ''}::${record.trade}`;

    counts.trades[tradeKey] = (counts.trades[tradeKey] || 0) + 1;

  }

  return counts;

}



export function toCostCodeSelectShape(record) {

  const label = [record.code, record.reportingGroup || record.trade, record.description]

    .filter(Boolean)

    .join(' — ');

  return {

    id: record.id,

    code: record.code,

    subHeading: record.commercialFamily,

    trade: record.trade,

    reportingGroup: record.reportingGroup || record.trade,

    element: record.description,

    label,

    commercialHead: record.commercialHead,

    commercialFamily: record.commercialFamily,

    defaultVatTreatment: record.defaultVatTreatment,

    defaultOrderType: record.defaultOrderType,

    allowBudget: record.allowBudget,

    allowPurchaseOrders: record.allowPurchaseOrders,

    allowLedgerImport: record.allowLedgerImport,

    allowForecastAdjustment: record.allowForecastAdjustment,

    reportingOrder: record.reportingOrder,

    active: record.active,

  };

}



export async function listActiveCostCodesForSelect() {

  await ensureCostCodeMasterSeeded();

  return listCostCodeMasterRecords({ activeOnly: true }).map(toCostCodeSelectShape);

}

