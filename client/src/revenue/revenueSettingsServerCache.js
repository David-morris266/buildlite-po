/**
 * BL-032A — In-memory revenue settings cache (development-scoped).
 *
 * When VITE_REVENUE_SERVER_AUTHORITY=true, reads use this cache.
 * No localStorage fallback. Unresolved is not treated as empty defaults.
 */

import {
  RevenueSettingsApiError,
  getRevenueSettingsForDevelopment,
} from '../api/revenueSettings';
import { normalizeServerRevenueSettings } from './revenueSettingsServerMapper';

export class RevenueSettingsCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'RevenueSettingsCacheError';
    this.code = code;
    this.status = status;
  }
}

const settingsByDevelopment = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error, fallbackMessage) {
  if (error instanceof RevenueSettingsCacheError) return error;
  if (error instanceof RevenueSettingsApiError) {
    return new RevenueSettingsCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new RevenueSettingsCacheError(error?.message || fallbackMessage, {
    code: 'NETWORK_ERROR',
  });
}

function readinessOf(loadState, error) {
  if (loadState === 'loaded') return { ready: true, loadState, error: null };
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return { ready: false, loadState, error, reason: 'error' };
  }
  return { ready: false, loadState: loadState || 'idle', error: null, reason: 'idle' };
}

export function getRevenueSettingsLoadState(developmentId) {
  return loadStateByDevelopment.get(developmentId) || 'idle';
}

export function getRevenueSettingsLoadError(developmentId) {
  return loadErrorByDevelopment.get(developmentId) || null;
}

export function getRevenueSettingsReadiness(developmentId) {
  return readinessOf(
    getRevenueSettingsLoadState(developmentId),
    getRevenueSettingsLoadError(developmentId)
  );
}

export function getCachedRevenueSettings(developmentId) {
  return settingsByDevelopment.get(developmentId) || null;
}

export function replaceCachedRevenueSettings(developmentId, document) {
  const mapped = normalizeServerRevenueSettings(document, developmentId);
  if (!mapped) return null;
  settingsByDevelopment.set(developmentId, mapped);
  loadStateByDevelopment.set(developmentId, 'loaded');
  loadErrorByDevelopment.delete(developmentId);
  return mapped;
}

async function loadSettings(developmentId) {
  loadStateByDevelopment.set(developmentId, 'loading');
  loadErrorByDevelopment.delete(developmentId);
  try {
    const document = await getRevenueSettingsForDevelopment(developmentId);
    const mapped = replaceCachedRevenueSettings(developmentId, document);
    if (!mapped) {
      throw new RevenueSettingsCacheError('Revenue settings response was empty.', {
        code: 'EMPTY',
      });
    }
    return mapped;
  } catch (error) {
    settingsByDevelopment.delete(developmentId);
    const wrapped = wrapApiError(error, 'Failed to load revenue settings.');
    loadStateByDevelopment.set(developmentId, 'error');
    loadErrorByDevelopment.set(developmentId, wrapped);
    throw wrapped;
  }
}

export function ensureRevenueSettingsReady(developmentId) {
  if (!developmentId) {
    return Promise.reject(
      new RevenueSettingsCacheError('Development id is required.', { code: 'INVALID' })
    );
  }
  if (getRevenueSettingsLoadState(developmentId) === 'loaded') {
    return Promise.resolve(getCachedRevenueSettings(developmentId));
  }
  const inFlight = loadPromiseByDevelopment.get(developmentId);
  if (inFlight) return inFlight;

  const pending = loadSettings(developmentId).finally(() => {
    loadPromiseByDevelopment.delete(developmentId);
  });
  loadPromiseByDevelopment.set(developmentId, pending);
  return pending;
}

export function refreshRevenueSettings(developmentId) {
  if (!developmentId) {
    return Promise.reject(
      new RevenueSettingsCacheError('Development id is required.', { code: 'INVALID' })
    );
  }
  settingsByDevelopment.delete(developmentId);
  loadStateByDevelopment.set(developmentId, 'idle');
  loadErrorByDevelopment.delete(developmentId);
  loadPromiseByDevelopment.delete(developmentId);
  return ensureRevenueSettingsReady(developmentId);
}

export function requireCachedRevenueSettings(developmentId) {
  const readiness = getRevenueSettingsReadiness(developmentId);
  if (!readiness.ready) {
    throw new RevenueSettingsCacheError(
      readiness.reason === 'error'
        ? readiness.error?.message || 'Revenue settings failed to load.'
        : 'Revenue settings have not loaded yet.',
      { code: 'UNRESOLVED' }
    );
  }
  return getCachedRevenueSettings(developmentId);
}

export function __resetRevenueSettingsServerCacheForTests() {
  settingsByDevelopment.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
