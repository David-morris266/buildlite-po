/**
 * BL-011C.01 — Subcontract Package metadata (localStorage until server model exists).
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

export function ensurePackageRecord(orderKey, order = {}) {
  const all = readAll();
  if (all[orderKey]) {
    const record = all[orderKey];
    let changed = false;

    for (const field of ['developmentId', 'developmentNumber', 'developmentName']) {
      if (!record[field] && order[field]) {
        record[field] = order[field];
        changed = true;
      }
    }

    if (changed) {
      record.updatedAt = new Date().toISOString();
      all[orderKey] = record;
      writeAll(all);
    }

    return record;
  }

  const now = new Date().toISOString();
  all[orderKey] = {
    orderKey,
    jobId: order.jobId,
    supplierId: order.supplierId,
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
