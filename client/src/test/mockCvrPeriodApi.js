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
  upsertShouldReject: false,
  upsertRejectError: null,
  lastUpsertPayload: null,
  lastCreatePayload: null,
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
  addMemberCallCount: 0,
  budgetImportCallCount: 0,
  lastAddMemberPayload: null,
  lastBudgetImportPayload: null,
  addMemberShouldReject: false,
  addMemberRejectError: null,
  budgetImportShouldReject: false,
  budgetImportRejectError: null,
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
  store.upsertShouldReject = false;
  store.upsertRejectError = null;
  store.lastUpsertPayload = null;
  store.lastCreatePayload = null;
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
  store.addMemberCallCount = 0;
  store.budgetImportCallCount = 0;
  store.lastAddMemberPayload = null;
  store.lastBudgetImportPayload = null;
  store.addMemberShouldReject = false;
  store.addMemberRejectError = null;
  store.budgetImportShouldReject = false;
  store.budgetImportRejectError = null;
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
    addMember: store.addMemberCallCount,
    budgetImport: store.budgetImportCallCount,
    total:
      store.createCallCount +
      store.patchCallCount +
      store.submitCallCount +
      store.rejectCallCount +
      store.approveCallCount +
      store.createInputCallCount +
      store.upsertInputsCallCount +
      store.patchInputCallCount +
      store.addMemberCallCount +
      store.budgetImportCallCount,
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

export function setCvrUpsertInputsReject(error = null) {
  store.upsertShouldReject = true;
  store.upsertRejectError =
    error ||
    new CvrPeriodApiError('Unable to copy CVR cost-code inputs.', {
      status: 500,
      body: { message: 'Unable to copy CVR cost-code inputs.' },
    });
}

export function getLastUpsertPayload() {
  return store.lastUpsertPayload ? clone(store.lastUpsertPayload) : null;
}

export function getLastCreatePayload() {
  return store.lastCreatePayload ? clone(store.lastCreatePayload) : null;
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
    reportingMonth: Object.prototype.hasOwnProperty.call(overrides, 'reportingMonth')
      ? overrides.reportingMonth
      : '2026-01-01',
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
    snapshot: overrides.snapshot === undefined ? null : overrides.snapshot,
    snapshotDeferred: overrides.snapshot
      ? false
      : overrides.snapshotDeferred !== false,
    snapshotNote: overrides.snapshotNote || null,
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

export function buildServerCvrSnapshotRowFixture(overrides = {}) {
  const history = Array.isArray(overrides.adjustmentHistory)
    ? overrides.adjustmentHistory
    : [
        {
          id: 'adj-5231-1',
          previousAdjustment: 0,
          newAdjustment: 500,
          reason: 'BL-031D UAT test adjustment',
          user: 'QS',
          date: '2026-04-01T09:00:00.000Z',
        },
      ];
  return {
    id: overrides.id || 'snap-row-5231',
    snapshotId: overrides.snapshotId || 'snap-p01',
    costCodeKey: overrides.costCodeKey || '5231',
    costCodeLabel: overrides.costCodeLabel || '5231 — Cleaning',
    description: overrides.description || 'Cleaning',
    commercialHead: overrides.commercialHead || 'Subcontract',
    commercialFamily: overrides.commercialFamily || '',
    trade: overrides.trade || '',
    active: overrides.active !== false,
    originalBudget: overrides.originalBudget ?? 0,
    currentBudget: overrides.currentBudget ?? 0,
    commercialAdjustment: overrides.commercialAdjustment ?? 500,
    adjustmentReason: overrides.adjustmentReason || 'BL-031D UAT test adjustment',
    manualAccrual: overrides.manualAccrual ?? 100,
    notes: overrides.notes || 'Frozen overlay',
    committed: overrides.committed ?? 50250,
    certified: overrides.certified ?? 2150,
    actualCost: overrides.actualCost ?? 0,
    currentCost: overrides.currentCost ?? 100,
    systemForecast: overrides.systemForecast ?? 50250,
    finalForecast: overrides.finalForecast ?? 50750,
    costToComplete: overrides.costToComplete ?? 50650,
    outstandingCertified: overrides.outstandingCertified ?? 2150,
    variance: overrides.variance ?? -50750,
    displayMetadata: {
      adjustmentHistory: history,
      ...(overrides.displayMetadata || {}),
    },
    adjustmentHistory: history,
    ...overrides,
  };
}

export function buildServerCvrSnapshotFixture(overrides = {}) {
  const rows = Array.isArray(overrides.rows)
    ? overrides.rows
    : [buildServerCvrSnapshotRowFixture({ snapshotId: overrides.id || 'snap-p01' })];
  const document = {
    id: overrides.id || 'snap-p01',
    clientId: overrides.clientId || 'client-1',
    developmentId: overrides.developmentId || 'dev-cvr-b',
    periodId: overrides.periodId || '11111111-2222-4333-8444-555555555555',
    periodKey: overrides.periodKey || 'P01',
    schemaVersion: overrides.schemaVersion ?? 1,
    commentary: {
      keyCommercialIssues: 'Locked P01 freeze',
      commercialOpportunities: '',
      financialRisks: '',
      actionsBeforeNextCvr: '',
      ...(overrides.commentary || {}),
    },
    sourceReadiness: {
      ledgerReady: true,
      ...(overrides.sourceReadiness || {}),
    },
    currentBudget: overrides.currentBudget ?? 0,
    committed: overrides.committed ?? 2364873,
    certified: overrides.certified ?? 2150,
    actualCost: overrides.actualCost ?? 0,
    manualAccrual: overrides.manualAccrual ?? 100,
    currentCost: overrides.currentCost ?? 100,
    systemForecast: overrides.systemForecast ?? 2364873,
    commercialAdjustment: overrides.commercialAdjustment ?? 500,
    finalForecast: overrides.finalForecast ?? 2365373,
    costToComplete: overrides.costToComplete ?? 2365273,
    outstandingCertified: overrides.outstandingCertified ?? 2150,
    variance: overrides.variance ?? -2365373,
    createdAt: overrides.createdAt || '2026-04-01T12:00:00.000Z',
    createdBy: overrides.createdBy || 'migration',
    rows,
    plots: Array.isArray(overrides.plots) ? overrides.plots : [],
    revenueAssumptions: overrides.revenueAssumptions ?? null,
    revenueSettingsId: overrides.revenueSettingsId ?? null,
    revenueSettingsVersion: overrides.revenueSettingsVersion ?? null,
  };
  if (overrides.forecastRevenue !== undefined) document.forecastRevenue = overrides.forecastRevenue;
  if (overrides.securedRevenue !== undefined) document.securedRevenue = overrides.securedRevenue;
  if (overrides.remainingForecastRevenue !== undefined) {
    document.remainingForecastRevenue = overrides.remainingForecastRevenue;
  }
  if (overrides.remainingForecast !== undefined) document.remainingForecast = overrides.remainingForecast;
  if (overrides.plotsSold !== undefined) document.plotsSold = overrides.plotsSold;
  if (overrides.plotsRemaining !== undefined) document.plotsRemaining = overrides.plotsRemaining;
  if (overrides.grossProfit !== undefined) document.grossProfit = overrides.grossProfit;
  if (overrides.grossMarginPercent !== undefined) {
    document.grossMarginPercent = overrides.grossMarginPercent;
  }
  if (overrides.expectedLiability !== undefined) {
    document.expectedLiability = overrides.expectedLiability;
  }
  if (overrides.expectedLiabilityCaptured !== undefined) {
    document.expectedLiabilityCaptured = overrides.expectedLiabilityCaptured;
  }
  return document;
}

export function buildServerCvrSnapshotPlotFixture(overrides = {}) {
  return {
    id: overrides.id || 'snap-plot-1',
    snapshotId: overrides.snapshotId || 'snap-p01',
    plotId: overrides.plotId || 'plot-1',
    plotNumber: overrides.plotNumber || '1',
    houseType: overrides.houseType || 'Arundel',
    tenure: overrides.tenure || 'Open Market',
    revenueCategory: overrides.revenueCategory || 'Open Market',
    revenueStatus: overrides.revenueStatus || 'Available',
    revenueSource: overrides.revenueSource || 'Manual Value',
    forecastRevenue: overrides.forecastRevenue ?? 255100,
    securedRevenue: overrides.securedRevenue ?? 0,
    remainingForecastRevenue: overrides.remainingForecastRevenue ?? 255100,
    sellingPrice: overrides.sellingPrice ?? 0,
    derivedForecast: overrides.derivedForecast ?? 255100,
    plotPremium: overrides.plotPremium ?? 0,
    niaFt2: overrides.niaFt2 ?? 686,
    effectiveGarage: overrides.effectiveGarage || 'None',
    reservedAt: overrides.reservedAt ?? null,
    exchangedAt: overrides.exchangedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    displayMetadata: overrides.displayMetadata || {},
    ...overrides,
  };
}

export function buildServerCvrRevenueSnapshotFixture(overrides = {}) {
  const forecastRevenue = overrides.forecastRevenue ?? 10444608;
  const securedRevenue = overrides.securedRevenue ?? 0;
  const remainingForecastRevenue = overrides.remainingForecastRevenue ?? forecastRevenue - securedRevenue;
  const finalForecast = overrides.finalForecast ?? 2365423;
  const grossProfit = overrides.grossProfit ?? forecastRevenue - finalForecast;
  const plots = Array.isArray(overrides.plots)
    ? overrides.plots
    : [buildServerCvrSnapshotPlotFixture({ snapshotId: overrides.id || 'snap-p03' })];
  return buildServerCvrSnapshotFixture({
    id: overrides.id || 'snap-p03',
    periodKey: overrides.periodKey || 'P03',
    schemaVersion: 2,
    forecastRevenue,
    securedRevenue,
    remainingForecastRevenue,
    remainingForecast: remainingForecastRevenue,
    plotsSold: overrides.plotsSold ?? 0,
    plotsRemaining: overrides.plotsRemaining ?? plots.length,
    grossProfit,
    grossMarginPercent:
      overrides.grossMarginPercent === undefined
        ? forecastRevenue
          ? (grossProfit / forecastRevenue) * 100
          : null
        : overrides.grossMarginPercent,
    revenueAssumptions: overrides.revenueAssumptions || {
      recognitionPolicy: 'completion',
      openMarket: { ratePerFt2: 350, effectiveDate: '' },
      settingsId: 'settings-frozen',
      settingsVersion: 2,
    },
    revenueSettingsId: overrides.revenueSettingsId ?? 'settings-frozen',
    revenueSettingsVersion: overrides.revenueSettingsVersion ?? 2,
    plots,
    finalForecast,
    ...overrides,
  });
}

function snapshotFromApprovedPeriod(existing) {
  if (existing.snapshot) return existing.snapshot;
  const inputs = store.inputsByPeriod.get(existing.id) || [];
  const rows = inputs.map((input) =>
    buildServerCvrSnapshotRowFixture({
      id: `snap-row-${input.id}`,
      snapshotId: `snap-${existing.id}`,
      costCodeKey: input.costCodeKey,
      costCodeLabel: input.costCodeLabel || input.costCodeKey,
      description: input.description || '',
      commercialHead: input.commercialHead || '',
      commercialFamily: input.commercialFamily || '',
      trade: input.trade || '',
      originalBudget: input.originalBudget ?? null,
      currentBudget: input.currentBudget ?? null,
      commercialAdjustment: input.commercialAdjustment ?? 0,
      adjustmentReason: input.adjustmentReason || input.commercialReason || '',
      manualAccrual: input.manualAccrual ?? 0,
      notes: input.notes || input.commercialNotes || '',
      adjustmentHistory: input.adjustmentHistory || [],
      displayMetadata: input.displayMetadata || {},
      committed: 0,
      certified: 0,
      actualCost: 0,
      currentCost: input.manualAccrual ?? 0,
      systemForecast: 0,
      expectedLiability: 0,
      expectedLiabilityCaptured: true,
      expectedLiabilityProvenance: [],
      finalForecast: input.commercialAdjustment ?? 0,
      costToComplete: 0,
      outstandingCertified: 0,
      variance: 0,
    })
  );
  return buildServerCvrSnapshotFixture({
    id: `snap-${existing.id}`,
    developmentId: existing.developmentId,
    periodId: existing.id,
    periodKey: existing.periodKey,
    commentary: existing.commentary,
    createdBy: 'migration',
    rows,
    currentBudget: 0,
    committed: 0,
    certified: 0,
    actualCost: 0,
    manualAccrual: rows.reduce((sum, row) => sum + (Number(row.manualAccrual) || 0), 0),
    currentCost: rows.reduce((sum, row) => sum + (Number(row.currentCost) || 0), 0),
    systemForecast: 0,
    commercialAdjustment: rows.reduce(
      (sum, row) => sum + (Number(row.commercialAdjustment) || 0),
      0
    ),
    finalForecast: rows.reduce((sum, row) => sum + (Number(row.finalForecast) || 0), 0),
    costToComplete: 0,
    outstandingCertified: 0,
    variance: 0,
    schemaVersion: 3,
    expectedLiability: 0,
    expectedLiabilityCaptured: true,
    forecastRevenue: 0,
    securedRevenue: 0,
    remainingForecastRevenue: 0,
    plotsSold: 0,
    plotsRemaining: 0,
    grossProfit: rows.reduce((sum, row) => sum + (Number(row.finalForecast) || 0), 0) * -1,
    grossMarginPercent: null,
    revenueAssumptions: { recognitionPolicy: 'completion', settingsId: null, settingsVersion: null },
    plots: [],
  });
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
  store.lastCreatePayload = clone({ developmentId, payload });
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
  const snapshot = snapshotFromApprovedPeriod(existing);
  const next = {
    ...existing,
    status: 'locked',
    version: existing.version + 1,
    approvedAt: '2026-04-01T12:00:00.000Z',
    approvedBy: payload.actor || 'migration',
    updatedBy: payload.actor || existing.updatedBy,
    snapshot,
    snapshotDeferred: false,
    snapshotNote: 'Immutable CVR snapshot created.',
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
  store.lastUpsertPayload = clone({ developmentId, periodId, payload });
  if (store.upsertShouldReject) throw store.upsertRejectError;
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

export function setCvrAddMemberReject(error = null) {
  store.addMemberShouldReject = true;
  store.addMemberRejectError =
    error ||
    new CvrPeriodApiError('A cost-code input already exists for this period.', {
      status: 409,
      body: {
        code: 'COST_CODE_ALREADY_MEMBER',
        message: 'A cost-code input already exists for this period.',
      },
    });
}

export function setCvrBudgetImportReject(error = null) {
  store.budgetImportShouldReject = true;
  store.budgetImportRejectError =
    error ||
    new CvrPeriodApiError('Budget cannot be imported.', {
      status: 400,
      body: {
        code: 'COST_CODE_NOT_FOUND',
        message: 'Budget cannot be imported.',
      },
    });
}

export function getLastCvrAddMemberPayload() {
  return store.lastAddMemberPayload ? clone(store.lastAddMemberPayload) : null;
}

export function getLastCvrBudgetImportPayload() {
  return store.lastBudgetImportPayload ? clone(store.lastBudgetImportPayload) : null;
}

export async function addCvrCostCodeMember(developmentId, periodId, payload = {}) {
  store.addMemberCallCount += 1;
  store.lastAddMemberPayload = clone({ developmentId, periodId, payload });
  if (store.addMemberShouldReject) throw store.addMemberRejectError;
  assertMutationAllowed();
  const period = findPeriod(developmentId, periodId);
  if (!period) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (period.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', {
      status: 409,
      body: { code: 'PERIOD_NOT_DRAFT', message: 'Only draft CVR periods can be edited.' },
    });
  }
  const key = String(payload.costCodeKey || payload.costCode || '').trim();
  const existing = (store.inputsByPeriod.get(periodId) || []).find(
    (item) => item.costCodeKey === key
  );
  if (existing) {
    throw new CvrPeriodApiError('A cost-code input already exists for this period.', {
      status: 409,
      body: {
        code: 'COST_CODE_ALREADY_MEMBER',
        message: 'A cost-code input already exists for this period.',
        input: clone(existing),
      },
    });
  }
  const input = {
    ...buildServerCvrInputFixture({
      id: newMockId(),
      periodId,
      costCodeKey: key,
      costCodeLabel: `${key} — Master`,
      description: 'Master description',
      version: 1,
      createdBy: payload.actor || 'QS',
      updatedBy: payload.actor || 'QS',
    }),
    originalBudget: null,
    currentBudget: null,
    commercialAdjustment: 0,
    manualAccrual: 0,
    notes: '',
    displayMetadata: {},
  };
  return saveInput(periodId, input);
}

export async function importCvrBudget(developmentId, periodId, payload = {}) {
  store.budgetImportCallCount += 1;
  store.lastBudgetImportPayload = clone({ developmentId, periodId, payload });
  if (store.budgetImportShouldReject) throw store.budgetImportRejectError;
  assertMutationAllowed();
  const period = findPeriod(developmentId, periodId);
  if (!period) throw new CvrPeriodApiError('CVR period not found.', { status: 404 });
  if (period.status !== 'draft') {
    throw new CvrPeriodApiError('Only draft CVR periods can be edited.', {
      status: 409,
      body: { code: 'PERIOD_NOT_DRAFT', message: 'Only draft CVR periods can be edited.' },
    });
  }
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const existing = store.inputsByPeriod.get(periodId) || [];
  const byKey = new Map(existing.map((item) => [item.costCodeKey, item]));
  let created = 0;
  let updated = 0;
  const inputs = [];
  for (const row of rows) {
    const key = String(row.costCodeKey || '').trim();
    const current = byKey.get(key);
    if (!current) {
      created += 1;
      const input = {
        ...buildServerCvrInputFixture({
          id: newMockId(),
          periodId,
          costCodeKey: key,
          version: 2,
        }),
        originalBudget: row.originalBudget,
        currentBudget: row.currentBudget ?? row.originalBudget,
        commercialAdjustment: 0,
        manualAccrual: 0,
      };
      byKey.set(key, input);
      inputs.push(input);
      continue;
    }
    updated += 1;
    const next = {
      ...current,
      originalBudget: row.originalBudget,
      currentBudget: row.currentBudget ?? row.originalBudget,
      version: current.version + 1,
    };
    byKey.set(key, next);
    inputs.push(next);
  }
  store.inputsByPeriod.set(periodId, [...byKey.values()]);
  return {
    created,
    updated,
    importedCount: rows.length,
    totalOriginalBudget: rows.reduce((sum, row) => sum + Number(row.originalBudget || 0), 0),
    totalCurrentBudget: rows.reduce(
      (sum, row) => sum + Number(row.currentBudget ?? row.originalBudget ?? 0),
      0
    ),
    inputs: clone(inputs),
  };
}
