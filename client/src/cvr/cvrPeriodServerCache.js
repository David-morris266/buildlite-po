/**
 * BL-031B — In-memory CVR period/input cache (development-scoped).
 *
 * When VITE_CVR_SERVER_AUTHORITY=true, reads use this cache.
 * Mutations are not applied here in BL-031B. No localStorage fallback.
 */

import {
  CvrPeriodApiError,
  listCvrPeriodInputs,
  listCvrPeriodsForDevelopment,
} from '../api/cvrPeriods';
import {
  normalizeServerCvrCostCodeInputList,
  normalizeServerCvrPeriodList,
} from './cvrPeriodServerMapper';

export class CvrPeriodCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'CvrPeriodCacheError';
    this.code = code;
    this.status = status;
  }
}

const periodsByDevelopment = new Map();
const periodLoadStateByDevelopment = new Map();
const periodLoadErrorByDevelopment = new Map();
const periodLoadPromiseByDevelopment = new Map();

const inputsByPeriod = new Map();
const inputLoadStateByPeriod = new Map();
const inputLoadErrorByPeriod = new Map();
const inputLoadPromiseByPeriod = new Map();
const periodDevelopmentById = new Map();

function wrapApiError(error, fallbackMessage) {
  if (error instanceof CvrPeriodCacheError) return error;
  if (error instanceof CvrPeriodApiError) {
    return new CvrPeriodCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new CvrPeriodCacheError(error?.message || fallbackMessage, {
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

export function getCvrPeriodLoadState(developmentId) {
  return periodLoadStateByDevelopment.get(developmentId) || 'idle';
}

export function getCvrPeriodLoadError(developmentId) {
  return periodLoadErrorByDevelopment.get(developmentId) || null;
}

export function getCvrPeriodReadiness(developmentId) {
  return readinessOf(
    getCvrPeriodLoadState(developmentId),
    getCvrPeriodLoadError(developmentId)
  );
}

export function getCachedCvrPeriods(developmentId) {
  return periodsByDevelopment.get(developmentId) || [];
}

export function getCachedCvrPeriodByKey(developmentId, periodKey) {
  if (!periodKey) return null;
  return (
    getCachedCvrPeriods(developmentId).find((item) => item.periodKey === periodKey) || null
  );
}

export function getCachedCvrPeriodById(periodId) {
  if (!periodId) return null;
  const developmentId = periodDevelopmentById.get(periodId);
  if (!developmentId) return null;
  return getCachedCvrPeriods(developmentId).find((item) => item.id === periodId) || null;
}

export function getCvrInputLoadState(periodId) {
  return inputLoadStateByPeriod.get(periodId) || 'idle';
}

export function getCvrInputLoadError(periodId) {
  return inputLoadErrorByPeriod.get(periodId) || null;
}

export function getCvrInputReadiness(periodId) {
  return readinessOf(getCvrInputLoadState(periodId), getCvrInputLoadError(periodId));
}

export function getCvrInputReadinessForPeriodKey(developmentId, periodKey) {
  const period = getCachedCvrPeriodByKey(developmentId, periodKey);
  if (!period?.id) {
    const periodReady = getCvrPeriodReadiness(developmentId);
    if (!periodReady.ready) return periodReady;
    return { ready: true, loadState: 'loaded', error: null, missingPeriod: true };
  }
  return getCvrInputReadiness(period.id);
}

export function getCachedCvrInputs(periodId) {
  return inputsByPeriod.get(periodId) || [];
}

export function getCachedCvrInputsForPeriodKey(developmentId, periodKey) {
  const period = getCachedCvrPeriodByKey(developmentId, periodKey);
  if (!period?.id) return [];
  return getCachedCvrInputs(period.id);
}

function indexPeriods(developmentId, periods) {
  periodsByDevelopment.set(developmentId, periods);
  for (const period of periods) {
    if (period?.id) periodDevelopmentById.set(period.id, developmentId);
  }
}

async function fetchPeriods(developmentId) {
  const documents = await listCvrPeriodsForDevelopment(developmentId);
  const periods = normalizeServerCvrPeriodList(documents);
  indexPeriods(developmentId, periods);
  return periods;
}

export async function refreshCvrPeriodsForDevelopment(developmentId) {
  if (!developmentId) return [];
  periodLoadStateByDevelopment.set(developmentId, 'loading');
  periodLoadErrorByDevelopment.set(developmentId, null);
  try {
    const periods = await fetchPeriods(developmentId);
    periodLoadStateByDevelopment.set(developmentId, 'loaded');
    return periods;
  } catch (error) {
    const wrapped = wrapApiError(error, 'Unable to load CVR data');
    periodLoadStateByDevelopment.set(developmentId, 'error');
    periodLoadErrorByDevelopment.set(developmentId, wrapped);
    throw wrapped;
  }
}

export function ensureCvrPeriodsReadyForDevelopment(developmentId) {
  if (!developmentId) {
    return Promise.reject(
      new CvrPeriodCacheError(
        'Unable to load CVR data because this development has no identity.',
        { code: 'MISSING_DEVELOPMENT_ID' }
      )
    );
  }

  if (periodLoadPromiseByDevelopment.has(developmentId)) {
    return periodLoadPromiseByDevelopment.get(developmentId);
  }

  if (getCvrPeriodLoadState(developmentId) === 'loaded') {
    return Promise.resolve(getCachedCvrPeriods(developmentId));
  }

  const promise = (async () => {
    periodLoadStateByDevelopment.set(developmentId, 'loading');
    periodLoadErrorByDevelopment.set(developmentId, null);
    try {
      const periods = await fetchPeriods(developmentId);
      periodLoadStateByDevelopment.set(developmentId, 'loaded');
      return periods;
    } catch (error) {
      const wrapped = wrapApiError(error, 'Unable to load CVR data');
      periodLoadStateByDevelopment.set(developmentId, 'error');
      periodLoadErrorByDevelopment.set(developmentId, wrapped);
      throw wrapped;
    } finally {
      periodLoadPromiseByDevelopment.delete(developmentId);
    }
  })();

  periodLoadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

async function fetchInputs(developmentId, periodId) {
  const documents = await listCvrPeriodInputs(developmentId, periodId);
  const inputs = normalizeServerCvrCostCodeInputList(documents);
  inputsByPeriod.set(periodId, inputs);
  const period = getCachedCvrPeriodById(periodId);
  if (period) period.costCentres = inputs;
  return inputs;
}

export async function refreshCvrInputsForPeriod(developmentId, periodId) {
  if (!periodId) return [];
  inputLoadStateByPeriod.set(periodId, 'loading');
  inputLoadErrorByPeriod.set(periodId, null);
  try {
    const inputs = await fetchInputs(developmentId, periodId);
    inputLoadStateByPeriod.set(periodId, 'loaded');
    return inputs;
  } catch (error) {
    const wrapped = wrapApiError(error, 'Unable to load CVR data');
    inputLoadStateByPeriod.set(periodId, 'error');
    inputLoadErrorByPeriod.set(periodId, wrapped);
    throw wrapped;
  }
}

export function ensureCvrInputsReadyForPeriod(developmentId, periodId) {
  if (!periodId) {
    return Promise.reject(
      new CvrPeriodCacheError(
        'Unable to load CVR cost-code inputs because this period has no identity.',
        { code: 'MISSING_PERIOD_ID' }
      )
    );
  }

  if (inputLoadPromiseByPeriod.has(periodId)) {
    return inputLoadPromiseByPeriod.get(periodId);
  }

  if (getCvrInputLoadState(periodId) === 'loaded') {
    return Promise.resolve(getCachedCvrInputs(periodId));
  }

  const promise = (async () => {
    inputLoadStateByPeriod.set(periodId, 'loading');
    inputLoadErrorByPeriod.set(periodId, null);
    try {
      const inputs = await fetchInputs(developmentId, periodId);
      inputLoadStateByPeriod.set(periodId, 'loaded');
      return inputs;
    } catch (error) {
      const wrapped = wrapApiError(error, 'Unable to load CVR data');
      inputLoadStateByPeriod.set(periodId, 'error');
      inputLoadErrorByPeriod.set(periodId, wrapped);
      throw wrapped;
    } finally {
      inputLoadPromiseByPeriod.delete(periodId);
    }
  })();

  inputLoadPromiseByPeriod.set(periodId, promise);
  return promise;
}

export async function ensureCvrPeriodAndInputsReady(developmentId, periodKey) {
  const periods = await ensureCvrPeriodsReadyForDevelopment(developmentId);
  const period = periodKey
    ? periods.find((item) => item.periodKey === periodKey)
    : periods[periods.length - 1];
  if (!period?.id) return { periods, inputs: [] };
  const inputs = await ensureCvrInputsReadyForPeriod(developmentId, period.id);
  return { periods, period, inputs };
}

export function replaceCachedCvrPeriods(developmentId, documents) {
  const periods = normalizeServerCvrPeriodList(documents);
  indexPeriods(developmentId, periods);
  periodLoadStateByDevelopment.set(developmentId, 'loaded');
  periodLoadErrorByDevelopment.set(developmentId, null);
  return periods;
}

export function replaceCachedCvrInputs(periodId, documents) {
  const inputs = normalizeServerCvrCostCodeInputList(documents);
  inputsByPeriod.set(periodId, inputs);
  inputLoadStateByPeriod.set(periodId, 'loaded');
  inputLoadErrorByPeriod.set(periodId, null);
  const period = getCachedCvrPeriodById(periodId);
  if (period) period.costCentres = inputs;
  return inputs;
}

export function __resetCvrPeriodServerCacheForTests() {
  periodsByDevelopment.clear();
  periodLoadStateByDevelopment.clear();
  periodLoadErrorByDevelopment.clear();
  periodLoadPromiseByDevelopment.clear();
  inputsByPeriod.clear();
  inputLoadStateByPeriod.clear();
  inputLoadErrorByPeriod.clear();
  inputLoadPromiseByPeriod.clear();
  periodDevelopmentById.clear();
}
