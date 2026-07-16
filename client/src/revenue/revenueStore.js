/**
 * BL-019A/B/C — Development-level revenue persistence (Doc 48).
 * Plot commercial data lives in Plot Master; strategy and settings live here.
 */

import { emptyRevenueStrategy, normalizeHouseTypePricingMap, normalizeRevenueStrategy } from './revenueStrategy';

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
    metadata: {
      ...empty.metadata,
      ...(record.metadata || {}),
      version: version < 3 ? 3 : version,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function getRevenueRecord(developmentId) {
  if (!developmentId) return emptyRevenueRecord();

  const store = readStore();
  return store[developmentId]
    ? normalizeRevenueRecord(store[developmentId])
    : emptyRevenueRecord();
}

export function saveRevenueRecord(developmentId, record) {
  if (!developmentId) return { ok: false, errors: ['Development id is required.'] };

  const next = normalizeRevenueRecord(record);
  const store = readStore();
  store[developmentId] = next;
  writeStore(store);

  return { ok: true, record: next };
}
