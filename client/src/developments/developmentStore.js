/**
 * BL-027A.2 — Development persistence (Postgres authority via /api/developments).
 *
 * buildlite_developments_v1 remains a read-only rollback/import source only.
 */

import {
  createDevelopment as apiCreateDevelopment,
  DevelopmentApiError,
  getDevelopment as apiGetDevelopment,
  listDevelopments as apiListDevelopments,
  updateDevelopment as apiUpdateDevelopment,
} from '../api/developments';
import {
  hasImportBeenAttempted,
  markImportAttempted,
  readLocalDevelopmentsBackup,
} from './developmentLocalBackup';

export const DEVELOPMENT_STATUSES = [
  { value: 'planning', label: 'Planning', modifier: 'planning' },
  {
    value: 'pre-construction',
    label: 'Pre-Construction',
    modifier: 'pre-construction',
  },
  { value: 'live', label: 'Live', modifier: 'live' },
  { value: 'complete', label: 'Complete', modifier: 'complete' },
];

export const VERSION_CONFLICT_MESSAGE =
  'This development was updated by another user. Refresh the development and try again.';

export class DevelopmentStoreError extends Error {
  constructor(message, { code = 'ERROR', status = 0, development = null } = {}) {
    super(message);
    this.name = 'DevelopmentStoreError';
    this.code = code;
    this.status = status;
    this.development = development;
  }
}

let cache = [];
let loadState = 'idle';
let loadError = null;
let loadPromise = null;

function sortDevelopments(items) {
  return [...items].sort(
    (a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)
  );
}

function upsertCache(development) {
  if (!development?.id) return;
  const index = cache.findIndex((item) => item.id === development.id);
  if (index >= 0) {
    cache[index] = development;
  } else {
    cache.push(development);
  }
  cache = sortDevelopments(cache);
}

export function getDevelopmentsLoadState() {
  return { loadState, loadError };
}

export function listDevelopments() {
  return sortDevelopments(cache);
}

export function getDevelopment(id) {
  if (!id) return null;
  return cache.find((item) => item.id === id) || null;
}

export async function loadDevelopments() {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    loadState = 'loading';
    loadError = null;
    try {
      cache = sortDevelopments(await apiListDevelopments());
      loadState = 'loaded';
      return listDevelopments();
    } catch (error) {
      loadState = 'error';
      loadError = error;
      throw wrapApiError(error);
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

function wrapApiError(error) {
  if (error instanceof DevelopmentStoreError) return error;
  if (error instanceof DevelopmentApiError) {
    return new DevelopmentStoreError(error.message, {
      code: error.status === 409 ? 'VERSION_CONFLICT' : 'API_ERROR',
      status: error.status,
      development: error.body?.development || null,
    });
  }
  return new DevelopmentStoreError(error?.message || 'Development server request failed', {
    code: 'NETWORK_ERROR',
  });
}

export async function importLocalDevelopments(options = {}) {
  const { force = false } = options;
  const localRecords = readLocalDevelopmentsBackup();
  if (!localRecords.length) {
    return { ok: true, imported: 0, skipped: 0, reason: 'no-local-data' };
  }

  if (!force && hasImportBeenAttempted()) {
    return { ok: true, imported: 0, skipped: localRecords.length, reason: 'already-attempted' };
  }

  const serverRecords = await apiListDevelopments();
  if (!force && serverRecords.length > 0) {
    return { ok: true, imported: 0, skipped: localRecords.length, reason: 'server-not-empty' };
  }

  let imported = 0;
  let skipped = 0;

  for (const record of localRecords) {
    if (!record?.id) {
      skipped += 1;
      continue;
    }

    try {
      const created = await apiCreateDevelopment(record);
      upsertCache(created);
      imported += 1;
    } catch (error) {
      if (error instanceof DevelopmentApiError && error.status === 409) {
        skipped += 1;
        continue;
      }
      throw wrapApiError(error);
    }
  }

  markImportAttempted();
  await loadDevelopments();
  return { ok: true, imported, skipped, reason: 'import-complete' };
}

export async function ensureDevelopmentsReady(options = {}) {
  const { attemptImport = true } = options;

  if (loadState === 'loaded' && cache.length) {
    return listDevelopments();
  }

  await loadDevelopments();

  if (attemptImport && cache.length === 0 && readLocalDevelopmentsBackup().length > 0) {
    await importLocalDevelopments();
  }

  return listDevelopments();
}

export async function refreshDevelopment(id) {
  const development = await apiGetDevelopment(id);
  upsertCache(development);
  return development;
}

export async function createDevelopment(payload) {
  try {
    const development = await apiCreateDevelopment(payload);
    upsertCache(development);
    return development;
  } catch (error) {
    throw wrapApiError(error);
  }
}

export async function updateDevelopment(id, patch = {}) {
  const existing = getDevelopment(id);
  if (!existing) {
    throw new DevelopmentStoreError('Development not found.', { code: 'NOT_FOUND', status: 404 });
  }

  const version = patch.version ?? existing.version;
  if (version == null) {
    throw new DevelopmentStoreError('Development version is required for update.', {
      code: 'MISSING_VERSION',
    });
  }

  const body = { ...patch, version };
  delete body.id;

  try {
    const development = await apiUpdateDevelopment(id, body);
    upsertCache(development);
    return development;
  } catch (error) {
    const wrapped = wrapApiError(error);
    if (wrapped.code === 'VERSION_CONFLICT') {
      throw new DevelopmentStoreError(VERSION_CONFLICT_MESSAGE, {
        code: 'VERSION_CONFLICT',
        status: 409,
        development: error.body?.development || null,
      });
    }
    throw wrapped;
  }
}

export function getDevelopmentStatusMeta(statusValue) {
  return (
    DEVELOPMENT_STATUSES.find((item) => item.value === statusValue) ||
    DEVELOPMENT_STATUSES[0]
  );
}

export function __setDevelopmentsCacheForTests(items = []) {
  cache = sortDevelopments(items);
  loadState = 'loaded';
  loadError = null;
  loadPromise = null;
}

export function __resetDevelopmentsStoreForTests() {
  cache = [];
  loadState = 'idle';
  loadError = null;
  loadPromise = null;
}
