/**
 * BL-033D.x.2A.2 — Admin Cost Codes authority adapter.
 *
 * OFF: existing localStorage master (costCodeMasterStore).
 * ON: server cache/API only. No localStorage fallback or dual-write.
 * Commercial Structure catalog remains browser-local for dropdowns.
 */

import { isCostCodeServerAuthorityEnabled } from './costCodeAuthority';
import {
  addCostCodeMasterRecord,
  ensureCostCodeMasterSeeded,
  listCostCodeMasterRecords,
  searchCostCodeMasterRecords,
  toCostCodeSelectShape,
  updateCostCodeMasterRecord,
} from './costCodeMasterStore';
import {
  CostCodeCacheError,
  ensureCostCodesReady,
  getCachedCostCodes,
  getCostCodeLoadError,
  getCostCodeLoadState,
  refreshCostCodes,
} from './costCodeServerCache';
import {
  createCostCodeOnServer,
  setCostCodeActiveOnServer,
  updateCostCodeOnServer,
} from './costCodeServerMutations';

export function looksLikeDisplayLabel(value) {
  return /[—]/.test(value) || / – /.test(value) || / - /.test(value);
}

export function isAdminCostCodeServerAuthority() {
  return isCostCodeServerAuthorityEnabled();
}

export async function ensureAdminCostCodesReady() {
  if (isCostCodeServerAuthorityEnabled()) {
    return ensureCostCodesReady();
  }
  return ensureCostCodeMasterSeeded();
}

export async function retryAdminCostCodes() {
  if (!isCostCodeServerAuthorityEnabled()) {
    return ensureCostCodeMasterSeeded();
  }
  return refreshCostCodes();
}

export function getAdminCostCodeReadiness() {
  if (!isCostCodeServerAuthorityEnabled()) {
    return { ready: true, loadState: 'loaded', error: null };
  }
  const loadState = getCostCodeLoadState();
  if (loadState === 'loaded') return { ready: true, loadState, error: null };
  if (loadState === 'error') {
    return { ready: false, loadState, error: getCostCodeLoadError() };
  }
  return { ready: false, loadState: loadState || 'idle', error: null };
}

/**
 * Returns records, or null when server authority is unresolved.
 * Callers must not treat null as a genuine empty master.
 */
export function listAdminCostCodeRecords({ activeOnly = false } = {}) {
  if (isCostCodeServerAuthorityEnabled()) {
    const rows = getCachedCostCodes();
    if (rows == null) return null;
    return activeOnly ? rows.filter((item) => item.active !== false) : rows;
  }
  return listCostCodeMasterRecords({ activeOnly });
}

export function searchAdminCostCodeRecords(query, records) {
  if (records == null) return null;
  const needle = String(query || '').trim().toLowerCase();
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

function serverPayloadFromForm(form = {}) {
  const reportingGroup = String(form.reportingGroup || form.trade || '').trim();
  const commercialFamily = String(form.commercialFamily || '').trim();
  return {
    description: String(form.description || '').trim(),
    commercialHead: String(form.commercialHead || '').trim(),
    commercialFamily,
    reportingGroup,
    trade: reportingGroup,
    hierarchyMode: commercialFamily ? 'three-level' : 'two-level',
    reportingOrder: Number(form.reportingOrder) || 0,
    defaultVatTreatment: form.defaultVatTreatment || 'Standard',
    defaultOrderType: form.defaultOrderType || 'S',
    allowBudget: form.allowBudget !== false,
    allowPurchaseOrders: form.allowPurchaseOrders !== false,
    allowLedgerImport: form.allowLedgerImport !== false,
    allowForecastAdjustment: form.allowForecastAdjustment !== false,
    notes: form.notes || '',
    importMetadata: form.importMetadata || null,
  };
}

function metadataChanged(previous, next) {
  if (!previous) return true;
  const keys = [
    'description',
    'commercialHead',
    'commercialFamily',
    'reportingGroup',
    'trade',
    'reportingOrder',
    'defaultVatTreatment',
    'defaultOrderType',
    'allowBudget',
    'allowPurchaseOrders',
    'allowLedgerImport',
    'allowForecastAdjustment',
    'notes',
  ];
  return keys.some((key) => String(previous[key] ?? '') !== String(next[key] ?? ''));
}

function fail(status, errors, extras = {}) {
  return { ok: false, status, errors: Array.isArray(errors) ? errors : [errors], ...extras };
}

export async function saveAdminCostCode({ isNew, id, form = {}, previous = null } = {}) {
  if (!isCostCodeServerAuthorityEnabled()) {
    const result = isNew
      ? addCostCodeMasterRecord(form)
      : updateCostCodeMasterRecord(id, form);
    return result.ok
      ? { ok: true, record: result.record }
      : fail(400, result.errors || ['Could not save cost code.']);
  }

  const code = String(form.code || '').trim();
  if (isNew) {
    if (!code) return fail(400, ['code is required.']);
    if (looksLikeDisplayLabel(code)) {
      return fail(400, ['code must be the customer cost-code identity, not a display label.']);
    }
    const created = await createCostCodeOnServer({
      code,
      ...serverPayloadFromForm(form),
      active: form.active !== false,
    });
    if (!created.ok) {
      return fail(created.status || 0, created.errors, { record: created.costCode });
    }
    return { ok: true, record: created.costCode };
  }

  if (form.code != null && String(form.code).trim() && previous?.code && String(form.code).trim() !== previous.code) {
    return fail(400, ['code cannot be changed after creation.']);
  }

  let record = previous;
  const payload = {
    ...serverPayloadFromForm(form),
    version: form.version ?? previous?.version,
  };
  if (!previous || metadataChanged(previous, { ...previous, ...form, ...payload })) {
    const updated = await updateCostCodeOnServer(id, payload);
    if (!updated.ok) {
      return fail(updated.status || 0, updated.errors, {
        record: updated.costCode,
        conflict: updated.status === 409,
      });
    }
    record = updated.costCode;
  }

  const desiredActive = form.active !== false;
  if (record && record.active !== desiredActive) {
    const activeResult = await setCostCodeActiveOnServer(id, {
      active: desiredActive,
      version: record.version,
    });
    if (!activeResult.ok) {
      return fail(activeResult.status || 0, activeResult.errors, {
        record: activeResult.costCode || record,
        conflict: activeResult.status === 409,
        partial: true,
        message: 'Cost code metadata saved, but active state could not be updated.',
      });
    }
    record = activeResult.costCode;
  }

  return { ok: true, record };
}

export function selectOptionsFromAdminRecords(records) {
  return (records || []).filter((item) => item.active !== false).map(toCostCodeSelectShape);
}

export { CostCodeCacheError, searchCostCodeMasterRecords };
