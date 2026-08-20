/**
 * BL-019A/B/C — Development-level revenue persistence (Doc 48).
 * Plot commercial data lives in Plot Master; strategy and settings live here.
 *
 * BL-032A: when VITE_REVENUE_SERVER_AUTHORITY is ON, this module reads/writes
 * the server cache only. No localStorage fallback and no dual-write.
 */

import { emptyRevenueStrategy, normalizeHouseTypePricingMap, normalizeRevenueStrategy } from './revenueStrategy';
import { isRevenueServerAuthorityEnabled } from './revenueAuthority';
import { requireCachedRevenueSettings } from './revenueSettingsServerCache';
import { putServerRevenueSettings } from './revenueSettingsServerMutations';

export const REVENUE_STORAGE_KEY = 'buildlite_revenue_v1';

function readStore() {
  try {
    const raw = localStorage.getItem(REVENUE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  localStorage.setItem(REVENUE_STORAGE_KEY, JSON.stringify(store));
}

export function emptyRevenueRecord() {
  return {
    revenueStrategy: emptyRevenueStrategy(),
    houseTypePricing: {},
    revenueAdjustments: [],
    recognitionSettings: {},
    recognitionPolicy: 'completion',
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 3,
    },
  };
}

function normalizeRevenueRecord(record = {}) {
  const empty = emptyRevenueRecord();
  const version = Number(record.metadata?.version) || 2;

  return {
    revenueStrategy: normalizeRevenueStrategy(record.revenueStrategy || empty.revenueStrategy),
    houseTypePricing: normalizeHouseTypePricingMap(record.houseTypePricing || {}),
    revenueAdjustments: Array.isArray(record.revenueAdjustments)
      ? record.revenueAdjustments
      : [],
    recognitionSettings:
      record.recognitionSettings && typeof record.recognitionSettings === 'object'
        ? record.recognitionSettings
        : {},
    recognitionPolicy: record.recognitionPolicy === 'exchange' ? 'exchange' : 'completion',
    metadata: {
      ...empty.metadata,
      ...(record.metadata || {}),
      version: version < 3 ? 3 : version,
      updatedAt: new Date().toISOString(),
    },
  };
}

function fromCachedSettings(cached) {
  return {
    id: cached.id || null,
    exists: cached.exists !== false && Boolean(cached.id),
    version: Number.isInteger(Number(cached.version)) ? Number(cached.version) : 0,
    recognitionPolicy: cached.recognitionPolicy === 'exchange' ? 'exchange' : 'completion',
    revenueStrategy: normalizeRevenueStrategy(cached.revenueStrategy || emptyRevenueStrategy()),
    houseTypePricing: normalizeHouseTypePricingMap(cached.houseTypePricing || {}),
    revenueAdjustments: Array.isArray(cached.revenueAdjustments) ? cached.revenueAdjustments : [],
    recognitionSettings:
      cached.recognitionSettings && typeof cached.recognitionSettings === 'object'
        ? cached.recognitionSettings
        : {},
    metadata: {
      version: 3,
      createdAt: cached.createdAt || cached.metadata?.createdAt || null,
      updatedAt: cached.updatedAt || cached.metadata?.updatedAt || null,
    },
  };
}

export function getRevenueRecord(developmentId) {
  if (isRevenueServerAuthorityEnabled()) {
    if (!developmentId) return emptyRevenueRecord();
    return fromCachedSettings(requireCachedRevenueSettings(developmentId));
  }

  if (!developmentId) return emptyRevenueRecord();

  const store = readStore();
  return store[developmentId]
    ? normalizeRevenueRecord(store[developmentId])
    : emptyRevenueRecord();
}

export function saveRevenueRecord(developmentId, record) {
  if (isRevenueServerAuthorityEnabled()) {
    if (!developmentId) {
      return Promise.resolve({ ok: false, errors: ['Development id is required.'] });
    }
    try {
      const cached = requireCachedRevenueSettings(developmentId);
      const next = normalizeRevenueRecord(record);
      return putServerRevenueSettings(developmentId, {
        version: cached.version,
        recognitionPolicy: next.recognitionPolicy || cached.recognitionPolicy || 'completion',
        revenueStrategy: next.revenueStrategy,
        houseTypePricing: next.houseTypePricing,
        revenueAdjustments: next.revenueAdjustments,
        recognitionSettings: next.recognitionSettings,
      });
    } catch (error) {
      return Promise.resolve({ ok: false, errors: [error?.message || 'Revenue settings are not ready.'] });
    }
  }

  if (!developmentId) return { ok: false, errors: ['Development id is required.'] };

  const next = normalizeRevenueRecord(record);
  const store = readStore();
  store[developmentId] = next;
  writeStore(store);

  return { ok: true, record: next };
}
