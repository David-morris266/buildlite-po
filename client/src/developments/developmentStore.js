/**
 * BL-009A.01 — Development persistence (localStorage until server model exists).
 */

const STORAGE_KEY = 'buildlite_developments_v1';

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

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function listDevelopments() {
  return readAll().sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
}

export function getDevelopment(id) {
  return readAll().find((item) => item.id === id) || null;
}

export function createDevelopment(payload) {
  const now = new Date().toISOString();
  const development = {
    id: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    jobNumber: String(payload.jobNumber || '').trim(),
    developmentName: String(payload.developmentName || '').trim(),
    client: String(payload.client || '').trim(),
    location: String(payload.location || '').trim(),
    address: String(payload.address || '').trim(),
    postcode: String(payload.postcode || '').trim(),
    startDate: payload.startDate || '',
    targetCompletion: payload.targetCompletion || '',
    status: payload.status || 'planning',
    plotCount: 0,
    packageCount: 0,
    purchaseOrderCount: 0,
    certificateCount: 0,
    plotMaster: {
      plots: [],
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  const items = readAll();
  items.push(development);
  writeAll(items);
  return development;
}

export function updateDevelopment(id, patch) {
  const items = readAll();
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;

  items[index] = {
    ...items[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeAll(items);
  return items[index];
}

export function getDevelopmentStatusMeta(statusValue) {
  return (
    DEVELOPMENT_STATUSES.find((item) => item.value === statusValue) ||
    DEVELOPMENT_STATUSES[0]
  );
}
