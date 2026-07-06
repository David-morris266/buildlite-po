/**
 * BL-009A.03A — Subcontract Package key format and legacy localStorage migration.
 *
 * Key format: {developmentId}::{supplierId}::{costCode}
 */

const PACKAGES_KEY = 'buildlite_subcontract_packages_v1';
const MATRICES_KEY = 'buildlite_order_matrices_v1';

function readStorage(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStorage(storageKey, data) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

export function normaliseCostCode(costCode) {
  const value = String(costCode || 'general').trim().toLowerCase();
  return value || 'general';
}

export function buildSubcontractOrderKey(developmentId, supplierId, costCode) {
  return `${String(developmentId)}::${String(supplierId)}::${normaliseCostCode(costCode)}`;
}

export function parseSubcontractOrderKey(orderKey) {
  const parts = String(orderKey || '').split('::');
  if (parts.length >= 3) {
    return {
      developmentId: parts[0],
      supplierId: parts[1],
      costCode: parts.slice(2).join('::'),
      legacy: false,
    };
  }
  if (parts.length === 2) {
    return {
      developmentId: parts[0],
      supplierId: parts[1],
      costCode: null,
      legacy: true,
    };
  }
  return null;
}

export function renameStorageKey(oldKey, newKey) {
  if (!oldKey || !newKey || oldKey === newKey) return false;

  let changed = false;

  for (const storageKey of [PACKAGES_KEY, MATRICES_KEY]) {
    const all = readStorage(storageKey);
    if (!all[oldKey]) continue;

    if (!all[newKey]) {
      all[newKey] = {
        ...all[oldKey],
        orderKey: newKey,
      };
    }

    delete all[oldKey];
    writeStorage(storageKey, all);
    changed = true;
  }

  return changed;
}

export function runPackageKeyMigration() {
  const packages = readStorage(PACKAGES_KEY);
  const keys = Object.keys(packages);

  for (const key of keys) {
    const parsed = parseSubcontractOrderKey(key);
    if (!parsed?.legacy) continue;

    const record = packages[key] || {};
    const developmentId = record.developmentId || parsed.developmentId;
    const costCode = record.costCode || 'general';
    const newKey = buildSubcontractOrderKey(
      developmentId,
      parsed.supplierId,
      costCode
    );

    if (newKey !== key) {
      renameStorageKey(key, newKey);
    }
  }
}
