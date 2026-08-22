/**
 * In-memory Cost Code Master API mock for client tests (BL-033D.x.2A.1).
 */

export class CostCodeApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Cost code API request failed');
    this.name = 'CostCodeApiError';
    this.status = status;
    this.body = body;
  }
}

const store = {
  costCodes: [],
  getDelayMs: 0,
  getShouldReject: false,
  getRejectError: null,
  getCallCount: 0,
  postCallCount: 0,
  putCallCount: 0,
  activeCallCount: 0,
  lastWritePayload: null,
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay() {
  if (!store.getDelayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, store.getDelayMs));
}

export function buildServerCostCodeFixture(overrides = {}) {
  const code = overrides.code || '5231';
  const description = overrides.description || 'Cleaning';
  return {
    id: overrides.id || `cc-${code}`,
    code,
    description,
    label: overrides.label || `${code} — ${description}`,
    commercialHead: overrides.commercialHead || 'Preliminaries',
    commercialFamily: overrides.commercialFamily || '',
    reportingGroup: overrides.reportingGroup || 'Cleaning',
    trade: overrides.trade || overrides.reportingGroup || 'Cleaning',
    hierarchyMode: overrides.hierarchyMode || 'two-level',
    reportingOrder: overrides.reportingOrder ?? 0,
    defaultVatTreatment: overrides.defaultVatTreatment || 'Standard',
    defaultOrderType: overrides.defaultOrderType || 'S',
    allowBudget: overrides.allowBudget !== false,
    allowPurchaseOrders: overrides.allowPurchaseOrders !== false,
    allowLedgerImport: overrides.allowLedgerImport !== false,
    allowForecastAdjustment: overrides.allowForecastAdjustment !== false,
    notes: overrides.notes || '',
    importMetadata: overrides.importMetadata || null,
    active: overrides.active !== false,
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt || '2026-08-22T00:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-08-22T00:00:00.000Z',
    createdBy: overrides.createdBy ?? null,
    updatedBy: overrides.updatedBy ?? null,
  };
}

export function resetCostCodesApiStore() {
  store.costCodes = [];
  store.getDelayMs = 0;
  store.getShouldReject = false;
  store.getRejectError = null;
  store.getCallCount = 0;
  store.postCallCount = 0;
  store.putCallCount = 0;
  store.activeCallCount = 0;
  store.lastWritePayload = null;
}

export function seedMockCostCodes(rows = []) {
  store.costCodes = rows.map((row) => buildServerCostCodeFixture(row));
}

export function setCostCodesGetDelay(ms) {
  store.getDelayMs = Number(ms) || 0;
}

export function setCostCodesGetReject(error) {
  store.getShouldReject = true;
  store.getRejectError = error || new CostCodeApiError('Unable to load cost codes', { status: 500 });
}

export function getCostCodesCallCounts() {
  return {
    get: store.getCallCount,
    post: store.postCallCount,
    put: store.putCallCount,
    active: store.activeCallCount,
    total: store.getCallCount + store.postCallCount + store.putCallCount + store.activeCallCount,
    lastWritePayload: store.lastWritePayload,
  };
}

export async function listServerCostCodes() {
  store.getCallCount += 1;
  await delay();
  if (store.getShouldReject) {
    throw store.getRejectError;
  }
  return { costCodes: clone(store.costCodes) };
}

export async function getServerCostCode(id) {
  store.getCallCount += 1;
  await delay();
  if (store.getShouldReject) throw store.getRejectError;
  const found = store.costCodes.find((row) => row.id === id);
  if (!found) throw new CostCodeApiError('Cost code not found.', { status: 404 });
  return clone(found);
}

export async function createServerCostCode(payload = {}) {
  store.postCallCount += 1;
  store.lastWritePayload = payload;
  const code = String(payload.code || '').trim();
  if (/[—]/.test(code) || / – /.test(code) || / - /.test(code)) {
    throw new CostCodeApiError(
      'code must be the customer cost-code identity, not a display label.',
      { status: 400 }
    );
  }
  const duplicate = store.costCodes.some(
    (row) => String(row.code || '').trim().toLowerCase() === code.toLowerCase()
  );
  if (duplicate) {
    throw new CostCodeApiError('Cost code already exists.', { status: 409 });
  }
  const created = buildServerCostCodeFixture({
    ...payload,
    code,
    id: payload.id || `cc-new-${store.postCallCount}`,
    version: 1,
  });
  store.costCodes.push(created);
  return clone(created);
}

export async function updateServerCostCode(id, payload = {}) {
  store.putCallCount += 1;
  store.lastWritePayload = payload;
  const index = store.costCodes.findIndex((row) => row.id === id);
  if (index < 0) throw new CostCodeApiError('Cost code not found.', { status: 404 });
  const current = store.costCodes[index];
  if (payload.version != null && Number(payload.version) !== Number(current.version)) {
    throw new CostCodeApiError('Cost code version conflict.', {
      status: 409,
      body: { costCode: clone(current) },
    });
  }
  const next = buildServerCostCodeFixture({
    ...current,
    ...payload,
    id: current.id,
    code: current.code,
    version: current.version + 1,
  });
  store.costCodes[index] = next;
  return clone(next);
}

export async function setServerCostCodeActive(id, payload = {}) {
  store.activeCallCount += 1;
  store.lastWritePayload = payload;
  const index = store.costCodes.findIndex((row) => row.id === id);
  if (index < 0) throw new CostCodeApiError('Cost code not found.', { status: 404 });
  const current = store.costCodes[index];
  if (payload.version != null && Number(payload.version) !== Number(current.version)) {
    throw new CostCodeApiError('Cost code version conflict.', {
      status: 409,
      body: { costCode: clone(current) },
    });
  }
  const next = buildServerCostCodeFixture({
    ...current,
    active: payload.active,
    version: current.version + 1,
  });
  store.costCodes[index] = next;
  return clone(next);
}
