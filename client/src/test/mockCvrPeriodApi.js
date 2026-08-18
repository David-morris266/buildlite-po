/**
 * In-memory CVR period API mock for client tests (BL-031B).
 */

const store = {
  periodsByDevelopment: new Map(),
  inputsByPeriod: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  inputListShouldReject: false,
  inputListRejectError: null,
  listCallCount: 0,
  getCallCount: 0,
  inputListCallCount: 0,
};

export class CvrPeriodApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'CVR period API request failed');
    this.name = 'CvrPeriodApiError';
    this.status = status;
    this.body = body;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay() {
  if (!store.listDelayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, store.listDelayMs));
}

function listForDevelopment(developmentId) {
  return store.periodsByDevelopment.get(developmentId) || [];
}

export function resetCvrPeriodApiStore() {
  store.periodsByDevelopment.clear();
  store.inputsByPeriod.clear();
  store.listDelayMs = 0;
  store.listShouldReject = false;
  store.listRejectError = null;
  store.inputListShouldReject = false;
  store.inputListRejectError = null;
  store.listCallCount = 0;
  store.getCallCount = 0;
  store.inputListCallCount = 0;
}

export function seedMockCvrPeriod(developmentId, period) {
  const existing = listForDevelopment(developmentId);
  const next = existing.filter((item) => item.id !== period.id);
  next.push(clone(period));
  store.periodsByDevelopment.set(developmentId, next);
  return clone(period);
}

export function seedMockCvrInputs(periodId, inputs) {
  store.inputsByPeriod.set(periodId, clone(inputs || []));
}

export function setCvrPeriodListDelay(ms) {
  store.listDelayMs = Number(ms) || 0;
}

export function setCvrPeriodListReject(error = null) {
  store.listShouldReject = true;
  store.listRejectError =
    error ||
    new CvrPeriodApiError('Unable to load CVR periods.', { status: 500 });
}

export function setCvrInputListReject(error = null) {
  store.inputListShouldReject = true;
  store.inputListRejectError =
    error ||
    new CvrPeriodApiError('Unable to load CVR cost-code inputs.', { status: 500 });
}

export function getCvrPeriodListCallCount() {
  return store.listCallCount;
}

export function getCvrPeriodGetCallCount() {
  return store.getCallCount;
}

export function getCvrInputListCallCount() {
  return store.inputListCallCount;
}

export function buildServerCvrPeriodFixture(overrides = {}) {
  return {
    id: overrides.id || '11111111-2222-4333-8444-555555555555',
    developmentId: overrides.developmentId || 'dev-cvr-b',
    periodKey: overrides.periodKey || 'P01',
    periodLabel: overrides.periodLabel || 'P01',
    reportingMonth: overrides.reportingMonth || '2026-01-01',
    status: overrides.status || 'draft',
    version: overrides.version ?? 1,
    commentary: {
      keyCommercialIssues: 'Delay',
      commercialOpportunities: '',
      financialRisks: '',
      actionsBeforeNextCvr: '',
      ...(overrides.commentary || {}),
    },
    createdAt: overrides.createdAt || '2026-01-02T10:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-01-02T10:00:00.000Z',
    createdBy: overrides.createdBy || 'QS',
    updatedBy: overrides.updatedBy || 'QS',
    submittedAt: overrides.submittedAt || null,
    submittedBy: overrides.submittedBy || null,
    approvedAt: overrides.approvedAt || null,
    approvedBy: overrides.approvedBy || null,
    auditHistory: overrides.auditHistory || [],
    snapshot: null,
    snapshotDeferred: true,
  };
}

export function buildServerCvrInputFixture(overrides = {}) {
  return {
    id: overrides.id || 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    periodId: overrides.periodId || '11111111-2222-4333-8444-555555555555',
    costCodeKey: overrides.costCodeKey || '5231',
    costCodeLabel: overrides.costCodeLabel || '5231 — Cleaning',
    description: overrides.description || '',
    commercialHead: overrides.commercialHead || 'Subcontract',
    commercialFamily: overrides.commercialFamily || '',
    trade: overrides.trade || '',
    originalBudget: overrides.originalBudget ?? 10000,
    currentBudget: overrides.currentBudget ?? 11000,
    commercialAdjustment: overrides.commercialAdjustment ?? 0,
    adjustmentReason: overrides.adjustmentReason || '',
    manualAccrual: overrides.manualAccrual ?? 400,
    notes: overrides.notes || 'QS overlay',
    active: overrides.active !== false,
    displayMetadata: overrides.displayMetadata || {},
    adjustmentHistory: overrides.adjustmentHistory || [],
    version: overrides.version ?? 1,
    createdAt: overrides.createdAt || '2026-01-02T10:00:00.000Z',
    updatedAt: overrides.updatedAt || '2026-01-02T10:00:00.000Z',
    createdBy: overrides.createdBy || 'QS',
    updatedBy: overrides.updatedBy || 'QS',
  };
}

export async function listCvrPeriodsForDevelopment(developmentId) {
  store.listCallCount += 1;
  await delay();
  if (store.listShouldReject) throw store.listRejectError;
  return clone(listForDevelopment(developmentId));
}

export async function getCvrPeriodById(developmentId, periodId) {
  store.getCallCount += 1;
  await delay();
  if (store.listShouldReject) throw store.listRejectError;
  const found = listForDevelopment(developmentId).find((item) => item.id === periodId);
  if (!found) {
    throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  }
  return clone(found);
}

export async function listCvrPeriodInputs(developmentId, periodId) {
  store.inputListCallCount += 1;
  await delay();
  if (store.inputListShouldReject) throw store.inputListRejectError;
  return clone(store.inputsByPeriod.get(periodId) || []);
}

export async function createCvrPeriodForDevelopment() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function patchCvrPeriodForDevelopment() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function submitCvrPeriodForDevelopment() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function rejectCvrPeriodForDevelopment() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function approveCvrPeriodForDevelopment() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function createCvrPeriodInput() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function upsertCvrPeriodInputs() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}

export async function patchCvrPeriodInput() {
  throw new CvrPeriodApiError('CVR mutations are not wired in BL-031B.', { status: 501 });
}
