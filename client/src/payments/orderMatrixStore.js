/**
 * BL-011B.01 — Order Matrix persistence (localStorage until server model exists).
 * No database schema changes.
 */

const STORAGE_KEY = 'buildlite_order_matrices_v1';

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

export function hasOrderMatrix(orderKey) {
  return Boolean(readAll()[orderKey]);
}

export function loadOrderMatrix(orderKey) {
  return readAll()[orderKey] || null;
}

export function saveOrderMatrix(orderKey, matrix) {
  const all = readAll();
  all[orderKey] = {
    ...matrix,
    orderKey,
    updatedAt: new Date().toISOString(),
  };
  writeAll(all);
  return all[orderKey];
}

export function deleteOrderMatrix(orderKey) {
  const all = readAll();
  delete all[orderKey];
  writeAll(all);
}

export function listOrderMatrixKeys() {
  return Object.keys(readAll());
}
