/**
 * BL-033D.x.2A.1 — In-memory tenant Cost Code Master cache.
 *
 * When VITE_COST_CODE_SERVER_AUTHORITY=true, reads use this cache.
 * No localStorage fallback. Failed/unresolved GET is not an empty master.
 */

import { CostCodeApiError, listServerCostCodes } from '../api/costCodes';
import { isCostCodeServerAuthorityEnabled } from './costCodeAuthority';
import { normalizeServerCostCode, normalizeServerCostCodeList } from './costCodeServerMapper';

export class CostCodeCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'CostCodeCacheError';
    this.code = code;
    this.status = status;
  }
}

let documents = null;
let loadState = 'idle';
let loadError = null;
let loadPromise = null;

function wrapApiError(error, fallbackMessage) {
  if (error instanceof CostCodeCacheError) return error;
  if (error instanceof CostCodeApiError) {
    return new CostCodeCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new CostCodeCacheError(error?.message || fallbackMessage, {
    code: 'NETWORK_ERROR',
  });
}

function readinessOf() {
  if (loadState === 'loaded') return { ready: true, loadState, error: null };
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return { ready: false, loadState, error: loadError, reason: 'error' };
  }
  return { ready: false, loadState: loadState || 'idle', error: null, reason: 'idle' };
}

export function getCostCodeLoadState() {
  return loadState;
}

export function getCostCodeLoadError() {
  return loadError;
}

export function getCostCodeReadiness() {
  return readinessOf();
}

export function getCachedCostCodes() {
  if (loadState !== 'loaded' || documents == null) return null;
  return documents;
}

export function replaceCachedCostCodes(rows) {
  documents = Array.isArray(rows) ? rows.map(normalizeServerCostCode).filter(Boolean) : [];
  loadState = 'loaded';
  loadError = null;
  return documents;
}

export function replaceCachedCostCode(document) {
  const mapped = normalizeServerCostCode(document);
  if (!mapped || loadState !== 'loaded' || documents == null) return mapped;
  const index = documents.findIndex((item) => item.id === mapped.id);
  if (index >= 0) {
    documents = [...documents];
    documents[index] = mapped;
  } else {
    documents = [...documents, mapped];
  }
  return mapped;
}

async function loadCostCodes() {
  loadState = 'loading';
  loadError = null;
  try {
    const payload = await listServerCostCodes();
    const mapped = normalizeServerCostCodeList(payload);
    if (mapped == null) {
      throw new CostCodeCacheError('Cost code master response was empty.', { code: 'EMPTY' });
    }
    return replaceCachedCostCodes(mapped);
  } catch (error) {
    documents = null;
    const wrapped = wrapApiError(error, 'Failed to load cost codes.');
    loadState = 'error';
    loadError = wrapped;
    throw wrapped;
  }
}

export function ensureCostCodesReady() {
  if (!isCostCodeServerAuthorityEnabled()) {
    return Promise.reject(
      new CostCodeCacheError('Cost code server authority is off.', { code: 'AUTHORITY_OFF' })
    );
  }
  if (loadState === 'loaded') {
    return Promise.resolve(getCachedCostCodes());
  }
  if (loadPromise) return loadPromise;
  const pending = loadCostCodes().finally(() => {
    loadPromise = null;
  });
  loadPromise = pending;
  return pending;
}

export function refreshCostCodes() {
  documents = null;
  loadState = 'idle';
  loadError = null;
  loadPromise = null;
  return ensureCostCodesReady();
}

export function requireCachedCostCodes() {
  const readiness = getCostCodeReadiness();
  if (!readiness.ready) {
    throw new CostCodeCacheError(
      readiness.reason === 'error'
        ? readiness.error?.message || 'Cost code master failed to load.'
        : 'Cost code master has not loaded yet.',
      { code: 'UNRESOLVED' }
    );
  }
  return getCachedCostCodes();
}

export function __resetCostCodeServerCacheForTests() {
  documents = null;
  loadState = 'idle';
  loadError = null;
  loadPromise = null;
}
