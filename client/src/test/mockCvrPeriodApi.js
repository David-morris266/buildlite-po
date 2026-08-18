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
  mutationShouldReject: false,
  mutationRejectError: null,
  seq: 0,
  listCallCount: 0,
  getCallCount: 0,
  inputListCallCount: 0,
  createCallCount: 0,
  patchCallCount: 0,
  submitCallCount: 0,
  rejectCallCount: 0,
  approveCallCount: 0,
  createInputCallCount: 0,
  upsertInputsCallCount: 0,
  patchInputCallCount: 0,
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
  store.mutationShouldReject = false;
  store.mutationRejectError = null;
  store.seq = 0;
  store.listCallCount = 0;
  store.getCallCount = 0;
  store.inputListCallCount = 0;
  store.createCallCount = 0;
  store.patchCallCount = 0;
  store.submitCallCount = 0;
  store.rejectCallCount = 0;
  store.approveCallCount = 0;
  store.createInputCallCount = 0;
  store.upsertInputsCallCount = 0;
  store.patchInputCallCount = 0;
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

export function getCvrMutationCallCounts() {
  return {
    create: store.createCallCount,
    patch: store.patchCallCount,
    submit: store.submitCallCount,
    reject: store.rejectCallCount,
    approve: store.approveCallCount,
    createInput: store.createInputCallCount,
    upsertInputs: store.upsertInputsCallCount,
    patchInput: store.patchInputCallCount,
    total:
      store.createCallCount +
      store.patchCallCount +
      store.submitCallCount +
      store.rejectCallCount +
      store.approveCallCount +
      store.createInputCallCount +
      store.upsertInputsCallCount +
      store.patchInputCallCount,
  };
}

export function setCvrMutationReject(error = null) {
  store.mutationShouldReject = true;
  store.mutationRejectError =
    error ||
    new CvrPeriodApiError('CVR period version conflict.', {
      status: 409,
      body: { message: 'CVR period version conflict.' },
    });
}

function newMockId() {
  store.seq += 1;
  return `11111111-2222-4333-8444-${String(store.seq).padStart(12, '0')}`;
}

function emptyCommentary() {
  return {
    keyCommercialIssues: '',
    commercialOpportunities: '',
    financialRisks: '',
    actionsBeforeNextCvr: '',
  };
}

function savePeriod(developmentId, period) {
  const existing = listForDevelopment(developmentId).filter((item) => item.id !== period.id);
  existing.push(period);
  store.periodsByDevelopment.set(developmentId, existing);
  return clone(period);
}

function findPeriod(developmentId, periodId) {
  return listForDevelopment(developmentId).find((item) => item.id === periodId) || null;
}

function isOpenStatus(status) {
  return status === 'draft' || status === 'submitted';
}

function assertMutationAllowed() {
  if (store.mutationShouldReject) throw store.mutationRejectError;
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

export async function createCvrPeriodForDevelopment(developmentId, payload = {}) {
  store.createCallCount += 1;
  assertMutationAllowed();
  const open = listForDevelopment(developmentId).find((item) => isOpenStatus(item.status));
  if (open) {
    throw new CvrPeriodApiError(
      `Period ${open.periodKey} is still ${open.status}. Complete it before creating another.`,
      { status: 409, body: { message: 'Open period exists', period: clone(open) } }
    );
  }
  const periodKey = String(payload.periodKey || `P${String(listForDevelopment(developmentId).length + 1).padStart(2, '0')}`).toUpperCase();
  if (listForDevelopment(developmentId).some((item) => item.periodKey === periodKey)) {
    throw new CvrPeriodApiError('A CVR period with this key already exists.', { status: 409 });
  }
  const now = '2026-04-01T10:00:00.000Z';
  const period = buildServerCvrPeriodFixture({
    id: newMockId(),
    developmentId,
    periodKey,
    periodLabel: payload.periodLabel || periodKey,
    reportingMonth: payload.reportingMonth || null,
    status: 'draft',
    version: 1,
    commentary: { ...emptyCommentary(), ...(payload.commentary || {}) },
    createdAt: now,
    updatedAt: now,
    createdBy: payload.createdBy || payload.actor || 'migration',
    updatedBy: payload.actor || payload.createdBy || 'migration',
    submittedAt: null,
    submittedBy: null,
    approvedAt: null,
    approvedBy: null,
    auditHistory: [{ action: 'created', actor: payload.actor || null, at: now }],
  });
  return savePeriod(developmentId, period);
}

export async function patchCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  store.patchCallCount += 1;
  assertMutationAllowed();
  const existing = findPeriod(developmentId, periodId);
  if (!existing) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (existing.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', { status: 409 });
  }
  if (payload.version != null && Number(payload.version) !== existing.version) {
    throw new CvrPeriodApiError('CVR period version conflict.', {
      status: 409,
      body: { message: 'CVR period version conflict.', period: clone(existing) },
    });
  }
  const next = {
    ...existing,
    periodLabel: payload.periodLabel ?? existing.periodLabel,
    reportingMonth:
      payload.reportingMonth !== undefined ? payload.reportingMonth : existing.reportingMonth,
    commentary: payload.commentary
      ? { ...emptyCommentary(), ...payload.commentary }
      : existing.commentary,
    version: existing.version + 1,
    updatedBy: payload.actor || existing.updatedBy,
  };
  return savePeriod(developmentId, next);
}

export async function submitCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  store.submitCallCount += 1;
  assertMutationAllowed();
  const existing = findPeriod(developmentId, periodId);
  if (!existing) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (existing.status !== 'draft') {
    throw new CvrPeriodApiError('CVR period must be draft to submit.', { status: 409 });
  }
  const next = {
    ...existing,
    status: 'submitted',
    version: existing.version + 1,
    submittedAt: '2026-04-01T11:00:00.000Z',
    submittedBy: payload.actor || 'migration',
    updatedBy: payload.actor || existing.updatedBy,
  };
  return savePeriod(developmentId, next);
}

export async function rejectCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  store.rejectCallCount += 1;
  assertMutationAllowed();
  if (!String(payload.comment || '').trim()) {
    throw new CvrPeriodApiError('A rejection comment is required.', { status: 400 });
  }
  const existing = findPeriod(developmentId, periodId);
  if (!existing) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (existing.status !== 'submitted') {
    throw new CvrPeriodApiError('CVR period must be submitted to reject.', { status: 409 });
  }
  const next = {
    ...existing,
    status: 'draft',
    version: existing.version + 1,
    submittedAt: null,
    submittedBy: null,
    updatedBy: payload.actor || existing.updatedBy,
  };
  return savePeriod(developmentId, next);
}

export async function approveCvrPeriodForDevelopment(developmentId, periodId, payload = {}) {
  store.approveCallCount += 1;
  assertMutationAllowed();
  const existing = findPeriod(developmentId, periodId);
  if (!existing) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (existing.status !== 'submitted') {
    throw new CvrPeriodApiError('CVR period must be submitted to approve.', { status: 409 });
  }
  const next = {
    ...existing,
    status: 'locked',
    version: existing.version + 1,
    approvedAt: '2026-04-01T12:00:00.000Z',
    approvedBy: payload.actor || 'migration',
    updatedBy: payload.actor || existing.updatedBy,
    snapshot: null,
    snapshotDeferred: true,
  };
  return savePeriod(developmentId, next);
}

function saveInput(periodId, input) {
  const existing = (store.inputsByPeriod.get(periodId) || []).filter((item) => item.id !== input.id);
  existing.push(input);
  store.inputsByPeriod.set(periodId, existing);
  return clone(input);
}

export async function createCvrPeriodInput(developmentId, periodId, payload = {}) {
  store.createInputCallCount += 1;
  assertMutationAllowed();
  const period = findPeriod(developmentId, periodId);
  if (!period) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (period.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', { status: 409 });
  }
  const input = buildServerCvrInputFixture({
    id: newMockId(),
    periodId,
    ...payload,
    version: 1,
    createdBy: payload.createdBy || payload.actor || 'migration',
    updatedBy: payload.actor || payload.createdBy || 'migration',
  });
  return saveInput(periodId, input);
}

export async function upsertCvrPeriodInputs(developmentId, periodId, payload = {}) {
  store.upsertInputsCallCount += 1;
  assertMutationAllowed();
  const period = findPeriod(developmentId, periodId);
  if (!period) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (period.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', { status: 409 });
  }
  const items = Array.isArray(payload.inputs) ? payload.inputs : [];
  const existing = store.inputsByPeriod.get(periodId) || [];
  const byKey = new Map(existing.map((item) => [item.costCodeKey, item]));
  const results = [];
  for (const item of items) {
    const current = byKey.get(item.costCodeKey);
    if (!current) {
      const created = buildServerCvrInputFixture({
        id: newMockId(),
        periodId,
        ...item,
        version: 1,
      });
      byKey.set(created.costCodeKey, created);
      results.push(created);
      continue;
    }
    if (item.version == null || Number(item.version) !== current.version) {
      throw new CvrPeriodApiError('Cost-code input version conflict.', {
        status: 409,
        body: { message: 'Cost-code input version conflict.', input: clone(current) },
      });
    }
    const updated = {
      ...current,
      ...item,
      id: current.id,
      periodId,
      version: current.version + 1,
    };
    byKey.set(updated.costCodeKey, updated);
    results.push(updated);
  }
  store.inputsByPeriod.set(periodId, [...byKey.values()]);
  return { inputs: clone(results) };
}

export async function patchCvrPeriodInput(developmentId, periodId, inputId, payload = {}) {
  store.patchInputCallCount += 1;
  assertMutationAllowed();
  const period = findPeriod(developmentId, periodId);
  if (!period) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (period.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', { status: 409 });
  }
  const existing = (store.inputsByPeriod.get(periodId) || []).find((item) => item.id === inputId);
  if (!existing) throw new CvrPeriodApiError('CVR cost-code input not found.', { status: 404 });
  if (payload.version != null && Number(payload.version) !== existing.version) {
    throw new CvrPeriodApiError('Cost-code input version conflict.', {
      status: 409,
      body: { message: 'Cost-code input version conflict.', input: clone(existing) },
    });
  }
  const next = { ...existing, ...payload, id: inputId, periodId, version: existing.version + 1 };
  return saveInput(periodId, next);
}
