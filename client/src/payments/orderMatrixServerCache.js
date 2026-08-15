/**
 * BL-029B — In-memory server Order Matrix cache (shadow infrastructure).
 *
 * localStorage (orderMatrixStore) remains runtime authority until BL-029D.
 * When VITE_MATRIX_SERVER_AUTHORITY=true, read helpers use this cache only.
 */

import { listMatricesForDevelopment, OrderMatrixApiError } from '../api/orderMatrices';
import { normalizeServerOrderMatrix, normalizeServerOrderMatrixList } from './orderMatrixServerMapper';

export class OrderMatrixCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'OrderMatrixCacheError';
    this.code = code;
    this.status = status;
  }
}

const cacheByDevelopment = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error) {
  if (error instanceof OrderMatrixCacheError) return error;
  if (error instanceof OrderMatrixApiError) {
    return new OrderMatrixCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new OrderMatrixCacheError(error?.message || 'Order Matrix server request failed', {
    code: 'NETWORK_ERROR',
  });
}

function indexMatrices(developmentId, matrices) {
  cacheByDevelopment.set(developmentId, matrices);
}

export function getOrderMatricesLoadState(developmentId) {
  return loadStateByDevelopment.get(developmentId) || 'idle';
}

export function getOrderMatricesLoadError(developmentId) {
  return loadErrorByDevelopment.get(developmentId) || null;
}

export function listCachedOrderMatricesByDevelopment(developmentId) {
  return cacheByDevelopment.get(developmentId) || [];
}

export function getCachedOrderMatrixByOrderKey(developmentId, orderKey) {
  if (!orderKey) return null;
  return (
    listCachedOrderMatricesByDevelopment(developmentId).find(
      (matrix) => matrix.orderKey === orderKey
    ) || null
  );
}

export function getCachedOrderMatrixByPackageUuid(developmentId, packageUuid) {
  if (!packageUuid) return null;
  return (
    listCachedOrderMatricesByDevelopment(developmentId).find(
      (matrix) => matrix.packageUuid === packageUuid
    ) || null
  );
}

export function getOrderMatrixFinancialReadiness(developmentId) {
  const loadState = getOrderMatricesLoadState(developmentId);
  if (loadState === 'loaded') {
    return { ready: true, loadState, error: null };
  }
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return {
      ready: false,
      loadState,
      error: getOrderMatricesLoadError(developmentId),
      reason: 'error',
    };
  }
  return { ready: false, loadState, error: null, reason: 'idle' };
}

async function fetchAndIndex(developmentId) {
  const documents = await listMatricesForDevelopment(developmentId);
  const matrices = normalizeServerOrderMatrixList(documents);
  indexMatrices(developmentId, matrices);
  return matrices;
}

export async function refreshMatricesForDevelopment(developmentId) {
  if (!developmentId) return [];
  loadStateByDevelopment.set(developmentId, 'loading');
  loadErrorByDevelopment.set(developmentId, null);

  try {
    const matrices = await fetchAndIndex(developmentId);
    loadStateByDevelopment.set(developmentId, 'loaded');
    return matrices;
  } catch (error) {
    const wrapped = wrapApiError(error);
    loadStateByDevelopment.set(developmentId, 'error');
    loadErrorByDevelopment.set(developmentId, wrapped);
    throw wrapped;
  }
}

export async function ensureMatricesReadyForDevelopment(developmentId) {
  if (!developmentId) {
    return [];
  }

  if (loadPromiseByDevelopment.has(developmentId)) {
    return loadPromiseByDevelopment.get(developmentId);
  }

  if (getOrderMatricesLoadState(developmentId) === 'loaded') {
    return listCachedOrderMatricesByDevelopment(developmentId);
  }

  const promise = (async () => {
    loadStateByDevelopment.set(developmentId, 'loading');
    loadErrorByDevelopment.set(developmentId, null);

    try {
      const matrices = await fetchAndIndex(developmentId);
      loadStateByDevelopment.set(developmentId, 'loaded');
      return matrices;
    } catch (error) {
      const wrapped = wrapApiError(error);
      loadStateByDevelopment.set(developmentId, 'error');
      loadErrorByDevelopment.set(developmentId, wrapped);
      throw wrapped;
    } finally {
      loadPromiseByDevelopment.delete(developmentId);
    }
  })();

  loadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

/** Test/helper seed — does not call the API. */
export function patchCachedOrderMatrix(developmentId, document) {
  if (!developmentId || !document) return;
  const normalized = normalizeServerOrderMatrix(document);
  if (!normalized) return;

  const existing = listCachedOrderMatricesByDevelopment(developmentId);
  const index = existing.findIndex(
    (item) =>
      item.orderKey === normalized.orderKey ||
      (normalized.packageUuid && item.packageUuid === normalized.packageUuid)
  );
  const next =
    index === -1
      ? [...existing, normalized]
      : existing.map((item, itemIndex) => (itemIndex === index ? normalized : item));

  indexMatrices(developmentId, next);
  if (getOrderMatricesLoadState(developmentId) !== 'loaded') {
    loadStateByDevelopment.set(developmentId, 'loaded');
    loadErrorByDevelopment.set(developmentId, null);
  }
}

export function __resetOrderMatrixServerCacheForTests() {
  cacheByDevelopment.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
