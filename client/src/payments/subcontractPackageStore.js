/**
 * BL-011C.01 — Subcontract Package local container (certificates/activity only).
 * BL-027B.2 — Package identity authority moved to Postgres; this key is transitional.
 */

const STORAGE_KEY = 'buildlite_subcontract_packages_v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function mergePoNumbers(existing = [], incoming = []) {
  const next = [...existing];
  for (const poNumber of incoming) {
    if (poNumber && !next.includes(poNumber)) {
      next.push(poNumber);
    }
  }
  return next;
}

export function ensurePackageRecord(orderKey, order = {}) {
  const all = readAll();
  const now = new Date().toISOString();

  if (all[orderKey]) {
    const record = all[orderKey];
    let changed = false;

    for (const field of [
      'scopeId',
      'costCode',
      'developmentId',
      'developmentNumber',
      'developmentName',
      'projectLabel',
      'supplierLabel',
      'supplierId',
    ]) {
      if (!record[field] && order[field]) {
        record[field] = order[field];
        changed = true;
      }
    }

    const mergedPoNumbers = mergePoNumbers(record.poNumbers, order.poNumbers);
    if (mergedPoNumbers.length !== (record.poNumbers || []).length) {
      record.poNumbers = mergedPoNumbers;
      changed = true;
    }

    if (changed) {
      record.updatedAt = now;
      all[orderKey] = record;
      writeAll(all);
    }

    return record;
  }

  all[orderKey] = {
    orderKey,
    scopeId: order.scopeId || order.jobId || '',
    jobId: order.scopeId || order.jobId || '',
    supplierId: order.supplierId,
    costCode: order.costCode || '',
    poNumbers: order.poNumbers || [],
    projectLabel: order.projectLabel,
    supplierLabel: order.supplierLabel,
    developmentId: order.developmentId || '',
    developmentNumber: order.developmentNumber || '',
    developmentName: order.developmentName || '',
    createdAt: now,
    updatedAt: now,
    activity: [],
  };
  writeAll(all);
  return all[orderKey];
}

export function getPackageRecord(orderKey) {
  return readAll()[orderKey] || null;
}

export function appendPackageActivity(orderKey, entry) {
  const all = readAll();
  const record = all[orderKey];
  if (!record) return null;

  const activity = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: entry.label,
    when: entry.when || new Date().toISOString(),
    modifier: entry.modifier || 'default',
  };

  record.activity = [activity, ...(record.activity || [])].slice(0, 30);
  record.updatedAt = activity.when;
  all[orderKey] = record;
  writeAll(all);
  return activity;
}

export function recordMatrixSaved(orderKey, { isFirstSave = false } = {}) {
  ensurePackageRecord(orderKey);
  appendPackageActivity(orderKey, {
    label: isFirstSave ? 'Order Matrix created' : 'Order Matrix updated',
    modifier: 'matrix',
  });
}
