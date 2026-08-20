/**
 * In-memory development revenue settings API mock for client tests (BL-032A).
 */

export class RevenueSettingsApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Revenue settings API request failed');
    this.name = 'RevenueSettingsApiError';
    this.status = status;
    this.body = body;
  }
}

const store = {
  byDevelopment: new Map(),
  getDelayMs: 0,
  getShouldReject: false,
  getRejectError: null,
  putShouldReject: false,
  putRejectError: null,
  getCallCount: 0,
  putCallCount: 0,
  lastPutPayload: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay() {
  if (!store.getDelayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, store.getDelayMs));
}

export function buildServerRevenueSettingsFixture(overrides = {}) {
  return {
    id: overrides.id ?? null,
    developmentId: overrides.developmentId || 'dev-rev',
    exists: overrides.exists ?? Boolean(overrides.id),
    recognitionPolicy: overrides.recognitionPolicy || 'completion',
    revenueStrategy: overrides.revenueStrategy || {
      openMarket: { ratePerFt2: 350, effectiveDate: '' },
      affordableHousing: {
        affordableRent: 58,
        sharedOwnership: 72,
        firstHomes: 70,
        additionality: 65,
        discountMarketSale: 70,
        other: 100,
      },
      garagePremiums: { none: 0, single: 12500, double: 22500 },
      updatedAt: null,
    },
    houseTypePricing: overrides.houseTypePricing || {},
    revenueAdjustments: overrides.revenueAdjustments || [],
    recognitionSettings: overrides.recognitionSettings || {},
    version: overrides.version ?? 0,
    createdAt: overrides.createdAt || null,
    updatedAt: overrides.updatedAt || null,
    createdBy: overrides.createdBy ?? null,
    updatedBy: overrides.updatedBy ?? null,
    metadata: {
      version: 3,
      createdAt: overrides.createdAt || null,
      updatedAt: overrides.updatedAt || null,
    },
  };
}

function unsavedDocument(developmentId) {
  return buildServerRevenueSettingsFixture({
    developmentId,
    exists: false,
    id: null,
    version: 0,
  });
}

export function resetRevenueSettingsApiStore() {
  store.byDevelopment.clear();
  store.getDelayMs = 0;
  store.getShouldReject = false;
  store.getRejectError = null;
  store.putShouldReject = false;
  store.putRejectError = null;
  store.getCallCount = 0;
  store.putCallCount = 0;
  store.lastPutPayload = null;
}

export function seedMockRevenueSettings(developmentId, document) {
  store.byDevelopment.set(developmentId, clone(document));
}

export function setRevenueSettingsGetDelay(ms) {
  store.getDelayMs = ms;
}

export function setRevenueSettingsGetReject(error) {
  store.getShouldReject = true;
  store.getRejectError =
    error ||
    new RevenueSettingsApiError('Unable to load revenue settings.', { status: 500 });
}

export function setRevenueSettingsPutReject(error) {
  store.putShouldReject = true;
  store.putRejectError =
    error ||
    new RevenueSettingsApiError('Unable to save revenue settings.', { status: 500 });
}

export function getRevenueSettingsCallCounts() {
  return {
    get: store.getCallCount,
    put: store.putCallCount,
    total: store.getCallCount + store.putCallCount,
    lastPutPayload: store.lastPutPayload,
  };
}

export async function getRevenueSettingsForDevelopment(developmentId) {
  store.getCallCount += 1;
  await delay();
  if (store.getShouldReject) {
    throw store.getRejectError;
  }
  const existing = store.byDevelopment.get(developmentId);
  return clone(existing || unsavedDocument(developmentId));
}

export async function putRevenueSettingsForDevelopment(developmentId, payload = {}) {
  store.putCallCount += 1;
  store.lastPutPayload = clone(payload);
  if (store.putShouldReject) {
    throw store.putRejectError;
  }

  const existing = store.byDevelopment.get(developmentId) || unsavedDocument(developmentId);
  const expectedVersion = Number(payload.version);
  const currentVersion = existing.exists ? existing.version : 0;
  if (expectedVersion !== currentVersion) {
    throw new RevenueSettingsApiError('Revenue settings version conflict.', {
      status: 409,
      body: {
        message: 'Revenue settings version conflict.',
        settings: clone(existing),
      },
    });
  }

  const next = {
    ...existing,
    ...payload,
    id: existing.id || `rev-settings-${developmentId}`,
    developmentId,
    exists: true,
    version: currentVersion + 1,
    recognitionPolicy: payload.recognitionPolicy || existing.recognitionPolicy || 'completion',
    revenueStrategy: payload.revenueStrategy || existing.revenueStrategy,
    houseTypePricing: payload.houseTypePricing || existing.houseTypePricing,
    revenueAdjustments: payload.revenueAdjustments || existing.revenueAdjustments || [],
    recognitionSettings: payload.recognitionSettings || existing.recognitionSettings || {},
    updatedAt: new Date().toISOString(),
    createdAt: existing.createdAt || new Date().toISOString(),
    metadata: {
      version: 3,
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
  store.byDevelopment.set(developmentId, clone(next));
  return clone(next);
}
