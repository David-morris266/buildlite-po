/**
 * BL-028B.1 — In-memory server Commercial Event cache (shadow infrastructure).
 *
 * localStorage (commercialEventStore) remains runtime authority until BL-028B.3.
 * When VITE_CE_SERVER_AUTHORITY=true, financial helpers read from this cache.
 */

import { listCommercialEvents as apiListCommercialEvents } from '../api/commercialEvents';
import { CommercialEventApiError } from '../api/commercialEvents';
import {
  normalizeServerCommercialEvent,
  normalizeServerCommercialEventList,
} from './commercialEventServerMapper';
import { notifyCommercialChanged } from '../commercial/commercialEvents';

export class CommercialEventCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'CommercialEventCacheError';
    this.code = code;
    this.status = status;
  }
}

const cacheByDevelopment = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error) {
  if (error instanceof CommercialEventCacheError) return error;
  if (error instanceof CommercialEventApiError) {
    return new CommercialEventCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new CommercialEventCacheError(error?.message || 'Commercial Event server request failed', {
    code: 'NETWORK_ERROR',
  });
}

function indexEvents(developmentId, events) {
  cacheByDevelopment.set(developmentId, events);
}

export function getCommercialEventsLoadState(developmentId) {
  return loadStateByDevelopment.get(developmentId) || 'idle';
}

export function getCommercialEventsLoadError(developmentId) {
  return loadErrorByDevelopment.get(developmentId) || null;
}

export function listCachedCommercialEventsByDevelopment(developmentId) {
  return cacheByDevelopment.get(developmentId) || [];
}

export function listCachedCommercialEventsByPackage(developmentId, orderKey) {
  return listCachedCommercialEventsByDevelopment(developmentId).filter(
    (event) => event.packageId === orderKey
  );
}

export function getCachedCommercialEventById(developmentId, eventId) {
  return (
    listCachedCommercialEventsByDevelopment(developmentId).find(
      (event) => event.id === eventId
    ) || null
  );
}

export function getCommercialEventFinancialReadiness(developmentId) {
  const loadState = getCommercialEventsLoadState(developmentId);
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
      error: getCommercialEventsLoadError(developmentId),
      reason: 'error',
    };
  }
  return { ready: false, loadState, error: null, reason: 'idle' };
}

async function fetchAndIndex(developmentId) {
  const documents = await apiListCommercialEvents({ developmentId });
  const events = normalizeServerCommercialEventList(documents);
  indexEvents(developmentId, events);
  return events;
}

export async function loadCommercialEventsForDevelopment(developmentId) {
  const events = await fetchAndIndex(developmentId);
  loadStateByDevelopment.set(developmentId, 'loaded');
  loadErrorByDevelopment.set(developmentId, null);
  return events;
}

export async function refreshCommercialEventsForDevelopment(developmentId) {
  if (!developmentId) return [];
  loadStateByDevelopment.set(developmentId, 'loading');
  loadErrorByDevelopment.set(developmentId, null);

  try {
    const events = await fetchAndIndex(developmentId);
    loadStateByDevelopment.set(developmentId, 'loaded');
    return events;
  } catch (error) {
    const wrapped = wrapApiError(error);
    loadStateByDevelopment.set(developmentId, 'error');
    loadErrorByDevelopment.set(developmentId, wrapped);
    throw wrapped;
  }
}

export async function ensureCommercialEventsReadyForDevelopment(developmentId) {
  if (!developmentId) {
    return [];
  }

  if (loadPromiseByDevelopment.has(developmentId)) {
    return loadPromiseByDevelopment.get(developmentId);
  }

  const promise = (async () => {
    loadStateByDevelopment.set(developmentId, 'loading');
    loadErrorByDevelopment.set(developmentId, null);

    try {
      const events = await fetchAndIndex(developmentId);
      loadStateByDevelopment.set(developmentId, 'loaded');
      return events;
    } catch (error) {
      loadStateByDevelopment.set(developmentId, 'error');
      loadErrorByDevelopment.set(developmentId, wrapApiError(error));
      throw wrapApiError(error);
    } finally {
      loadPromiseByDevelopment.delete(developmentId);
    }
  })();

  loadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

/**
 * Patch a single event in cache after a future server mutation (BL-028B.3).
 */
export function patchCachedCommercialEvent(developmentId, event, detail = {}) {
  if (!developmentId || !event?.id) return;
  const existing = listCachedCommercialEventsByDevelopment(developmentId);
  const normalized = normalizeServerCommercialEvent(event);
  if (!normalized) return;

  const index = existing.findIndex((item) => item.id === normalized.id);
  const next =
    index === -1
      ? [...existing, normalized]
      : existing.map((item) => (item.id === normalized.id ? normalized : item));

  indexEvents(developmentId, next);
  notifyCommercialChanged({
    developmentId,
    eventId: normalized.id,
    source: 'server-cache',
    ...detail,
  });
}

export function __resetCommercialEventServerCacheForTests() {
  cacheByDevelopment.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
