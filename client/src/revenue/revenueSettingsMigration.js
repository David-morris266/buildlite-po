/**
 * BL-032A — Controlled localStorage → server revenue settings migration.
 *
 * Manual/internal only. Never runs at startup. Never runs because the
 * authority flag is ON. Live UI must not call this.
 *
 * Preflight is read-only. Execute PUTs only after `{ confirm: true }`.
 * Does not delete localStorage. Does not touch plot commercial data.
 * Do not run against Test Site 1 / buildlite_clone in this slice.
 */

import {
  RevenueSettingsApiError,
  getRevenueSettingsForDevelopment,
  putRevenueSettingsForDevelopment,
} from '../api/revenueSettings';
import { REVENUE_STORAGE_KEY } from './revenueStore';
import { toServerRevenueSettingsPayload } from './revenueSettingsServerMapper';
import { normalizeHouseTypePricingMap, normalizeRevenueStrategy } from './revenueStrategy';

export const AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP = false;
export const REVENUE_SETTINGS_MIGRATION_INVOCATION = 'manual-only';

const CLASSIFICATION = {
  MATCH: 'MATCH',
  MISSING_SERVER: 'MISSING_SERVER',
  NO_LOCAL: 'NO_LOCAL',
  CONFLICT: 'CONFLICT',
};

function readLocalStore(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem?.(REVENUE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function listLocalRevenueDevelopmentIds(storage = globalThis.localStorage) {
  return Object.keys(readLocalStore(storage));
}

export function readLocalRevenueRecord(developmentId, storage = globalThis.localStorage) {
  const store = readLocalStore(storage);
  const record = store[developmentId];
  if (!record || typeof record !== 'object') return null;
  return {
    recognitionPolicy: record.recognitionPolicy === 'exchange' ? 'exchange' : 'completion',
    revenueStrategy: normalizeRevenueStrategy(record.revenueStrategy || {}),
    houseTypePricing: normalizeHouseTypePricingMap(record.houseTypePricing || {}),
    revenueAdjustments: Array.isArray(record.revenueAdjustments) ? record.revenueAdjustments : [],
    recognitionSettings:
      record.recognitionSettings && typeof record.recognitionSettings === 'object'
        ? record.recognitionSettings
        : {},
  };
}

function moneyEqual(left, right) {
  const a = left == null || left === '' ? null : Number(left);
  const b = right == null || right === '' ? null : Number(right);
  if ((a == null || Number.isNaN(a)) && (b == null || Number.isNaN(b))) return true;
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.round(a * 100) === Math.round(b * 100);
}

function strategyEqual(local, server) {
  return (
    moneyEqual(local?.openMarket?.ratePerFt2, server?.openMarket?.ratePerFt2) &&
    String(local?.openMarket?.effectiveDate || '') === String(server?.openMarket?.effectiveDate || '') &&
    JSON.stringify(local?.affordableHousing || {}) === JSON.stringify(server?.affordableHousing || {}) &&
    moneyEqual(local?.garagePremiums?.none, server?.garagePremiums?.none) &&
    moneyEqual(local?.garagePremiums?.single, server?.garagePremiums?.single) &&
    moneyEqual(local?.garagePremiums?.double, server?.garagePremiums?.double)
  );
}

function materialEqual(local, server) {
  if (!local || !server) return false;
  return (
    (local.recognitionPolicy || 'completion') === (server.recognitionPolicy || 'completion') &&
    strategyEqual(local.revenueStrategy, server.revenueStrategy) &&
    JSON.stringify(local.houseTypePricing || {}) === JSON.stringify(server.houseTypePricing || {}) &&
    JSON.stringify(local.revenueAdjustments || []) === JSON.stringify(server.revenueAdjustments || []) &&
    JSON.stringify(local.recognitionSettings || {}) === JSON.stringify(server.recognitionSettings || {})
  );
}

function apiErrorMessage(error) {
  if (error instanceof RevenueSettingsApiError) return error.message;
  return error?.message || 'Revenue settings request failed.';
}

export async function preflightRevenueSettingsMigration(developmentId, options = {}) {
  if (AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP) {
    throw new Error('Automatic revenue settings migration is forbidden.');
  }
  if (!developmentId) {
    return {
      ok: false,
      safeToExecute: false,
      errors: ['Development id is required.'],
    };
  }

  const storage = options.storage || globalThis.localStorage;
  const local = readLocalRevenueRecord(developmentId, storage);

  let server;
  try {
    server = await getRevenueSettingsForDevelopment(developmentId);
  } catch (error) {
    return {
      ok: false,
      safeToExecute: false,
      developmentId,
      classification: CLASSIFICATION.CONFLICT,
      errors: [apiErrorMessage(error)],
      localExists: Boolean(local),
      serverExists: false,
    };
  }

  if (!local) {
    return {
      ok: true,
      safeToExecute: false,
      alreadyMigrated: Boolean(server?.exists),
      developmentId,
      classification: CLASSIFICATION.NO_LOCAL,
      localExists: false,
      serverExists: Boolean(server?.exists),
      serverVersion: server?.version ?? 0,
      message: 'No local revenue settings to migrate. localStorage is unchanged.',
    };
  }

  if (server?.exists && materialEqual(local, server)) {
    return {
      ok: true,
      safeToExecute: true,
      alreadyMigrated: true,
      developmentId,
      classification: CLASSIFICATION.MATCH,
      localExists: true,
      serverExists: true,
      serverVersion: server.version,
      local,
      server,
    };
  }

  if (server?.exists && !materialEqual(local, server)) {
    return {
      ok: false,
      safeToExecute: false,
      alreadyMigrated: false,
      developmentId,
      classification: CLASSIFICATION.CONFLICT,
      localExists: true,
      serverExists: true,
      serverVersion: server.version,
      local,
      server,
      errors: ['Server revenue settings already exist and differ from localStorage.'],
    };
  }

  return {
    ok: true,
    safeToExecute: true,
    alreadyMigrated: false,
    developmentId,
    classification: CLASSIFICATION.MISSING_SERVER,
    localExists: true,
    serverExists: false,
    serverVersion: 0,
    local,
    server,
  };
}

export async function executeRevenueSettingsMigration(developmentId, options = {}) {
  if (AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP) {
    throw new Error('Automatic revenue settings migration is forbidden.');
  }
  if (options.confirm !== true) {
    return {
      ok: false,
      executed: false,
      errors: ['execute requires { confirm: true }.'],
    };
  }

  const preflight = await preflightRevenueSettingsMigration(developmentId, options);
  if (!preflight.safeToExecute) {
    return {
      ok: false,
      executed: false,
      complete: false,
      errors: preflight.errors || ['Preflight found conflicts or missing local data. Migration aborted.'],
      preflight,
    };
  }

  if (preflight.alreadyMigrated) {
    return {
      ok: true,
      executed: false,
      complete: true,
      alreadyMigrated: true,
      preflight,
    };
  }

  const payload = toServerRevenueSettingsPayload({
    version: 0,
    ...preflight.local,
  });

  try {
    const settings = await putRevenueSettingsForDevelopment(developmentId, payload);
    return {
      ok: true,
      executed: true,
      complete: true,
      alreadyMigrated: false,
      settings,
      preflight,
    };
  } catch (error) {
    return {
      ok: false,
      executed: true,
      complete: false,
      errors: [apiErrorMessage(error)],
      status: error?.status,
      preflight,
    };
  }
}
