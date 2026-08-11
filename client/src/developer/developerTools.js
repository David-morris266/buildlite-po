/**
 * Developer Tools — reset BuildLite demonstration data (localStorage / sessionStorage).
 * Central registry for demo data keys. Add future buildlite_* keys here only.
 */

import {
  importLocalDevelopments,
  loadDevelopments,
} from '../developments/developmentStore';

export const BUILDLITE_VERSION = '0.12.0-dev';

/** Injected at build time from git branch; falls back for local dev. */
export const BUILDLITE_BRANCH =
  typeof __BUILDLITE_BRANCH__ !== 'undefined' ? __BUILDLITE_BRANCH__ : 'buildlite-V1-1';

export const BUILDLITE_STORAGE_PREFIX = 'buildlite_';

/**
 * Known BuildLite demo keys (documentation + explicit fallback).
 * Prefix sweep removes any buildlite_* keys not listed here.
 */
export const KNOWN_BUILDLITE_DEMO_KEYS = [
  'buildlite_developments_v1',
  'buildlite_po_development_refs_v1',
  'buildlite_subcontract_packages_v1',
  'buildlite_order_matrices_v1',
  'buildlite_purchase_ledgers_v1',
  'buildlite_cvr_v1',
  'buildlite_setup_draft',
  'buildlite_setup_dismissed',
  'buildlite_company_settings_v1',
  'buildlite_commercial_structure_v1',
  'buildlite_cost_codes_master_v1',
  'buildlite_clients_master_v1',
  'buildlite_users_master_v1',
  'buildlite_approval_settings_v1',
  'buildlite_commercial_events_v1',
];

/** Keys that must survive a demo reset (auth, preferences — not buildlite_* commercial data). */
export const PRESERVED_LOCAL_STORAGE_KEYS = ['userEmail', 'userName'];

const API_BASE = (
  import.meta.env.VITE_API_URL || 'http://localhost:3001'
).replace(/\/+$/, '');

function buildApiUrl(path) {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Clears server-side demo data via development-only API.
 * POST /api/developer/reset (404 in production).
 */
export async function resetServerDemoData() {
  const response = await fetch(buildApiUrl('/api/developer/reset'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status === 404) {
    throw new Error(
      'Server reset is only available when the API is running in development mode.'
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || response.statusText || 'Server reset failed.');
  }

  const data = await response.json();
  if (!data?.success) {
    throw new Error(data?.message || 'Server reset failed.');
  }

  return data;
}

/**
 * Full clean-slate reset: server demo data, then browser storage.
 */
export async function resetBuildLiteDemoDataFull() {
  const server = await resetServerDemoData();
  const client = resetBuildLiteDemoData();

  return {
    ok: client.ok,
    server,
    client,
  };
}

function listPrefixedKeys(storage, prefix = BUILDLITE_STORAGE_PREFIX) {
  const keys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
}

function removeKeysFromStorage(storage, keys) {
  const removed = [];
  for (const key of keys) {
    if (storage.getItem(key) !== null) {
      storage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}

function collectKeysToRemove(storage) {
  const keys = new Set([
    ...listPrefixedKeys(storage),
    ...KNOWN_BUILDLITE_DEMO_KEYS.filter((key) => storage.getItem(key) !== null),
  ]);
  return [...keys];
}

/**
 * One-time import of local buildlite_developments_v1 records into Postgres.
 * Preserves exact dev-* ids. Does not delete localStorage rollback copy.
 */
export async function importLocalDevelopmentsFromBackup(options = {}) {
  await loadDevelopments();
  return importLocalDevelopments(options);
}

export function verifyBuildLiteDemoDataCleared() {
  const remainingLocal = listPrefixedKeys(localStorage);
  const remainingSession = listPrefixedKeys(sessionStorage);

  const checks = [
    {
      id: 'developments',
      label: 'No Developments',
      pass: !localStorage.getItem('buildlite_developments_v1'),
    },
    {
      id: 'plot-master',
      label: 'No Plot Master',
      pass: isDevelopmentPlotDataEmpty(),
    },
    {
      id: 'purchase-orders',
      label: 'No Purchase Orders',
      pass: !localStorage.getItem('buildlite_po_development_refs_v1'),
    },
    {
      id: 'packages',
      label: 'No Packages',
      pass: !localStorage.getItem('buildlite_subcontract_packages_v1'),
    },
    {
      id: 'certificates',
      label: 'No Certificates',
      pass: isCertificateDataEmpty(),
    },
    {
      id: 'ledger',
      label: 'No Ledger Transactions',
      pass: isLedgerDataEmpty(),
    },
    {
      id: 'cvr',
      label: 'No CVRs',
      pass: !localStorage.getItem('buildlite_cvr_v1'),
    },
    {
      id: 'import-profiles',
      label: 'No Import Profiles',
      pass: isLedgerProfilesEmpty(),
    },
    {
      id: 'no-prefix-local',
      label: 'No remaining buildlite_ localStorage keys',
      pass: remainingLocal.length === 0,
    },
    {
      id: 'no-prefix-session',
      label: 'No remaining buildlite_ sessionStorage keys',
      pass: remainingSession.length === 0,
    },
  ];

  return {
    allPassed: checks.every((check) => check.pass),
    checks,
    remainingKeys: {
      localStorage: remainingLocal,
      sessionStorage: remainingSession,
    },
  };
}

function isDevelopmentPlotDataEmpty() {
  try {
    const raw = localStorage.getItem('buildlite_developments_v1');
    if (!raw) return true;
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || !items.length) return true;
    return items.every(
      (item) => !item?.plotMaster?.plots?.length
    );
  } catch {
    return true;
  }
}

function isCertificateDataEmpty() {
  try {
    const raw = localStorage.getItem('buildlite_subcontract_packages_v1');
    if (!raw) return true;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return true;
    return !Object.values(data).some(
      (record) => Array.isArray(record?.certificates) && record.certificates.length
    );
  } catch {
    return true;
  }
}

function isLedgerDataEmpty() {
  try {
    const raw = localStorage.getItem('buildlite_purchase_ledgers_v1');
    if (!raw) return true;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return true;
    return !Object.values(data).some(
      (record) => Array.isArray(record?.transactions) && record.transactions.length
    );
  } catch {
    return true;
  }
}

function isLedgerProfilesEmpty() {
  try {
    const raw = localStorage.getItem('buildlite_purchase_ledgers_v1');
    if (!raw) return true;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return true;
    return !Object.values(data).some(
      (record) => Array.isArray(record?.importProfiles) && record.importProfiles.length
    );
  } catch {
    return true;
  }
}

/**
 * Permanently removes all BuildLite demonstration / commercial data from browser storage.
 * Does not remove userEmail, userName, theme, or other non-buildlite_* keys.
 */
export function resetBuildLiteDemoData() {
  const removedLocal = removeKeysFromStorage(
    localStorage,
    collectKeysToRemove(localStorage)
  );
  const removedSession = removeKeysFromStorage(
    sessionStorage,
    collectKeysToRemove(sessionStorage)
  );

  for (const key of PRESERVED_LOCAL_STORAGE_KEYS) {
    if (!localStorage.getItem(key)) continue;
    // Intentionally preserved — no action.
  }

  const verification = verifyBuildLiteDemoDataCleared();

  return {
    ok: verification.allPassed,
    removed: {
      localStorage: removedLocal,
      sessionStorage: removedSession,
    },
    verification,
  };
}
