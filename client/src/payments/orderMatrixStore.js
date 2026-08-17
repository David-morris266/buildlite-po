/**
 * BL-011B.01 / BL-029B / BL-029D — Order Matrix persistence facade.
 *
 * Runtime authority remains localStorage while VITE_MATRIX_SERVER_AUTHORITY is OFF.
 * When ON, reads resolve from the server cache with no localStorage fallback.
 * Live writes use persistOrderMatrix (server PUT). saveOrderMatrix remains the
 * localStorage helper and is a no-op write while authority is ON.
 */

import { parseSubcontractOrderKey } from './packageKeyMigration';
import { isOrderMatrixServerAuthorityEnabled } from './orderMatrixAuthority';
import {
  getCachedOrderMatrixByOrderKey,
  getOrderMatrixFinancialReadiness,
} from './orderMatrixServerCache';

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

export function resolveMatrixDevelopmentId(orderOrKey, developmentId = null) {
  if (developmentId) return developmentId;
  if (orderOrKey && typeof orderOrKey === 'object') {
    return (
      orderOrKey.developmentId ||
      orderOrKey.scopeId ||
      orderOrKey.jobId ||
      parseSubcontractOrderKey(orderOrKey.orderKey)?.developmentId ||
      null
    );
  }
  return parseSubcontractOrderKey(orderOrKey)?.developmentId || null;
}

/**
 * Distinguish idle/loading/error from genuine matrix absence.
 *
 * @returns {{
 *   ready: boolean,
 *   present: boolean,
 *   matrix: object|null,
 *   loadState: string,
 *   error: Error|null,
 *   reason?: string
 * }}
 */
export function resolveOrderMatrixForPackage(orderOrKey, developmentId = null) {
  const orderKey =
    typeof orderOrKey === 'string' ? orderOrKey : orderOrKey?.orderKey || null;

  if (!isOrderMatrixServerAuthorityEnabled()) {
    const matrix = orderKey ? readAll()[orderKey] || null : null;
    return {
      ready: true,
      present: Boolean(matrix),
      matrix,
      loadState: 'local',
      error: null,
    };
  }

  const resolvedDevelopmentId = resolveMatrixDevelopmentId(orderOrKey, developmentId);
  if (!orderKey || !resolvedDevelopmentId) {
    return {
      ready: false,
      present: false,
      matrix: null,
      loadState: 'idle',
      error: null,
      reason: 'idle',
    };
  }

  const readiness = getOrderMatrixFinancialReadiness(resolvedDevelopmentId);
  if (!readiness.ready) {
    return {
      ready: false,
      present: false,
      matrix: null,
      loadState: readiness.loadState,
      error: readiness.error || null,
      reason: readiness.reason,
    };
  }

  const matrix = getCachedOrderMatrixByOrderKey(resolvedDevelopmentId, orderKey);
  return {
    ready: true,
    present: Boolean(matrix),
    matrix,
    loadState: 'loaded',
    error: null,
  };
}

export function hasOrderMatrix(orderKey) {
  if (!isOrderMatrixServerAuthorityEnabled()) {
    return Boolean(readAll()[orderKey]);
  }
  const resolved = resolveOrderMatrixForPackage(orderKey);
  return resolved.ready && resolved.present;
}

export function loadOrderMatrix(orderKey) {
  if (!isOrderMatrixServerAuthorityEnabled()) {
    return readAll()[orderKey] || null;
  }
  return resolveOrderMatrixForPackage(orderKey).matrix;
}

export function saveOrderMatrix(orderKey, matrix) {
  if (isOrderMatrixServerAuthorityEnabled()) {
    return {
      ...matrix,
      orderKey,
      updatedAt: new Date().toISOString(),
    };
  }

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
  if (isOrderMatrixServerAuthorityEnabled()) {
    return;
  }

  const all = readAll();
  delete all[orderKey];
  writeAll(all);
}

export function listOrderMatrixKeys() {
  if (!isOrderMatrixServerAuthorityEnabled()) {
    return Object.keys(readAll());
  }
  return [];
}
