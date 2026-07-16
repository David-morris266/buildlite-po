/**
 * BL-019B — Revenue categories administration store.
 */

import { newAdminId, readAdminStore, writeAdminStore } from './adminStorage';
import { notifyMasterDataChanged } from './masterDataEvents';

export const REVENUE_CATEGORY_STORE_KEY = 'buildlite_revenue_categories_v1';

const DEFAULT_CATEGORIES = [
  'Open Market',
  'Affordable Housing',
  'Shared Ownership',
  'First Homes',
  'Commercial',
  'Land Disposal',
  'Other',
];

export function getRevenueCategoryStore() {
  const stored = readAdminStore(REVENUE_CATEGORY_STORE_KEY, null);
  if (stored?.categories?.length) return stored;
  return {
    categories: DEFAULT_CATEGORIES.map((name, index) => ({
      id: newAdminId('revcat'),
      name,
      sortOrder: index,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    updatedAt: new Date().toISOString(),
  };
}

function saveStore(store) {
  const next = { ...store, updatedAt: new Date().toISOString() };
  writeAdminStore(REVENUE_CATEGORY_STORE_KEY, next);
  notifyMasterDataChanged('revenue-categories');
  return next;
}

export function ensureRevenueCategories() {
  const store = getRevenueCategoryStore();
  if (readAdminStore(REVENUE_CATEGORY_STORE_KEY, null)?.categories?.length) {
    return store;
  }
  return saveStore(store);
}

export function listRevenueCategoryNames() {
  ensureRevenueCategories();
  return getRevenueCategoryStore()
    .categories.filter((item) => item.active !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((item) => item.name);
}

export function getDefaultRevenueCategory() {
  const names = listRevenueCategoryNames();
  return names.includes('Open Market') ? 'Open Market' : names[0] || 'Open Market';
}

export function isValidRevenueCategory(name) {
  return listRevenueCategoryNames().includes(String(name || '').trim());
}

export function normalizeRevenueCategory(name) {
  const label = String(name || '').trim();
  if (isValidRevenueCategory(label)) return label;
  return getDefaultRevenueCategory();
}
