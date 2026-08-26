/**
 * In-memory Commercial Event API mock for client tests (BL-028B.1).
 */

const commercialEventApiStore = {
  events: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  listCallCount: 0,
};

function sortEvents(records) {
  return [...records].sort((a, b) =>
    String(a.eventNumber || '').localeCompare(String(b.eventNumber || ''), undefined, {
      numeric: true,
    })
  );
}

export function resetCommercialEventApiStore() {
  commercialEventApiStore.events.clear();
  commercialEventApiStore.listDelayMs = 0;
  commercialEventApiStore.listShouldReject = false;
  commercialEventApiStore.listRejectError = null;
  commercialEventApiStore.listCallCount = 0;
}

export function getCommercialEventListCallCount() {
  return commercialEventApiStore.listCallCount;
}

export class CommercialEventApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Commercial Event API request failed');
    this.name = 'CommercialEventApiError';
    this.status = status;
    this.body = body;
  }
}

export function setCommercialEventListDelay(ms) {
  commercialEventApiStore.listDelayMs = Number(ms) || 0;
}

export function setCommercialEventListReject(error) {
  commercialEventApiStore.listShouldReject = true;
  commercialEventApiStore.listRejectError =
    error ||
    new CommercialEventApiError('Commercial Events unavailable', {
      status: 500,
      body: { message: 'Commercial Events unavailable' },
    });
}

export async function listCommercialEvents(filters = {}) {
  commercialEventApiStore.listCallCount += 1;
  if (commercialEventApiStore.listDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, commercialEventApiStore.listDelayMs));
  }
  if (commercialEventApiStore.listShouldReject) {
    throw commercialEventApiStore.listRejectError;
  }

  let records = sortEvents([...commercialEventApiStore.events.values()]);
  if (filters.developmentId) {
    records = records.filter((event) => event.developmentId === filters.developmentId);
  }
  if (filters.orderKey) {
    records = records.filter(
      (event) => event.packageId === filters.orderKey || event.orderKey === filters.orderKey
    );
  }
  if (filters.packageId) {
    records = records.filter((event) => event.packageUuid === filters.packageId);
  }
  return records.map((event) => ({ ...event }));
}

export async function getCommercialEvent(id) {
  const record = commercialEventApiStore.events.get(id);
  if (!record) {
    throw new CommercialEventApiError('Commercial event not found.', {
      status: 404,
      body: { message: 'Commercial event not found.' },
    });
  }
  return { ...record };
}

export function seedMockCommercialEvent(record) {
  if (!record?.id || !record?.developmentId) {
    throw new Error('seedMockCommercialEvent requires id and developmentId');
  }
  const orderKey = record.packageId || record.orderKey;
  const normalized = {
    packageUuid: record.packageUuid || null,
    packageId: orderKey,
    orderKey,
    eventNumber: record.eventNumber || 'CE-0001',
    status: record.status || 'draft',
    eventType: record.eventType || 'variation',
    category: record.category || 'design',
    responsibility: record.responsibility || 'employer',
    description: record.description || 'Test event',
    value: Number(record.value) || 0,
    financialTreatment: record.financialTreatment ?? 'contractAmendment',
    vatTreatment: record.vatTreatment || 'standard',
    certificateStatus: record.certificateStatus || 'notIncluded',
    recoveryStatus: record.recoveryStatus || 'notApplicable',
    recoveredAmount: Number(record.recoveredAmount) || 0,
    version: record.version || 1,
    auditHistory: Array.isArray(record.auditHistory) ? record.auditHistory : [],
    ...record,
  };
  commercialEventApiStore.events.set(normalized.id, normalized);
  return normalized;
}

export function buildApprovedVariationFixture({
  id = 'ce-fixture-variation-1',
  developmentId,
  orderKey,
  packageUuid = 'pkg-uuid-spark',
  value = 20000,
  eventNumber = 'CE-9001',
} = {}) {
  return seedMockCommercialEvent({
    id,
    developmentId,
    packageUuid,
    packageId: orderKey,
    orderKey,
    eventNumber,
    eventType: 'variation',
    category: 'design',
    responsibility: 'employer',
    description: 'Approved variation fixture',
    value,
    financialTreatment: 'contractAmendment',
    status: 'approved',
  });
}

export function buildApprovedRecoveryFixture({
  id = 'ce-fixture-recovery-1',
  developmentId,
  orderKey,
  packageUuid = 'pkg-uuid-mucky',
  value = -2500,
  eventNumber = 'CE-9002',
} = {}) {
  return seedMockCommercialEvent({
    id,
    developmentId,
    packageUuid,
    packageId: orderKey,
    orderKey,
    eventNumber,
    eventType: 'contraCharge',
    category: 'recovery',
    responsibility: 'subcontractor',
    description: 'Direct recovery fixture',
    value,
    financialTreatment: 'recoverableDeduction',
    relationshipType: 'recovery',
    status: 'approved',
    recoveryStatus: 'outstanding',
  });
}

// Stubs for unused workflow endpoints in B.1 tests
export async function createCommercialEvent() {
  throw new Error('createCommercialEvent mock not implemented');
}
export async function updateCommercialEvent() {
  throw new Error('updateCommercialEvent mock not implemented');
}
export async function submitCommercialEvent() {
  throw new Error('submitCommercialEvent mock not implemented');
}
export async function approveCommercialEvent() {
  throw new Error('approveCommercialEvent mock not implemented');
}
export async function rejectCommercialEvent() {
  throw new Error('rejectCommercialEvent mock not implemented');
}
export async function closeCommercialEvent() {
  throw new Error('closeCommercialEvent mock not implemented');
}
export async function dismissPotentialContra() {
  throw new Error('dismissPotentialContra mock not implemented');
}
export async function createLinkedRecovery() {
  throw new Error('createLinkedRecovery mock not implemented');
}
export async function updateExpectedLiability() {
  throw new Error('updateExpectedLiability mock not implemented');
}
export async function importCommercialEvents() {
  throw new Error('importCommercialEvents mock not implemented');
}
