/**
 * In-memory V1 Payment Certificate API mock for client tests (BL-030B / BL-030C).
 */

const certificateApiStore = {
  certificatesByPackage: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  mutationShouldReject: false,
  mutationRejectError: null,
  listCallCount: 0,
  getCallCount: 0,
  createCallCount: 0,
  patchCallCount: 0,
  submitCallCount: 0,
  approveCallCount: 0,
  rejectCallCount: 0,
  deleteCallCount: 0,
};

export class PaymentCertificateApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Payment Certificate API request failed');
    this.name = 'PaymentCertificateApiError';
    this.status = status;
    this.body = body;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nextId() {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(Date.now()).slice(-8)}${Math.random()
    .toString(16)
    .slice(2, 6)}`;
}

function listForPackage(packageId) {
  return certificateApiStore.certificatesByPackage.get(packageId) || [];
}

function writePackage(packageId, certificates) {
  certificateApiStore.certificatesByPackage.set(packageId, certificates);
}

function findCertificate(packageId, certificateId) {
  return listForPackage(packageId).find((item) => item.id === certificateId) || null;
}

function replaceCertificate(packageId, certificate) {
  const existing = listForPackage(packageId);
  const index = existing.findIndex((item) => item.id === certificate.id);
  const next =
    index === -1
      ? [...existing, certificate]
      : existing.map((item) => (item.id === certificate.id ? certificate : item));
  writePackage(packageId, next);
  return clone(certificate);
}

function versionConflict(certificate) {
  return new PaymentCertificateApiError('Payment certificate version conflict.', {
    status: 409,
    body: {
      message: 'Payment certificate version conflict.',
      certificate: clone(certificate),
    },
  });
}

function requireVersion(payload, certificate) {
  const expected = Number(payload?.version);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new PaymentCertificateApiError('version is required and must be a positive integer.', {
      status: 400,
      body: { message: 'version is required and must be a positive integer.' },
    });
  }
  if (expected !== Number(certificate.version)) {
    throw versionConflict(certificate);
  }
}

function maybeRejectMutation() {
  if (certificateApiStore.mutationShouldReject) {
    throw (
      certificateApiStore.mutationRejectError ||
      new PaymentCertificateApiError('Payment certificate mutation failed', {
        status: 500,
        body: { message: 'Payment certificate mutation failed' },
      })
    );
  }
}

export function resetPaymentCertificateApiStore() {
  certificateApiStore.certificatesByPackage.clear();
  certificateApiStore.listDelayMs = 0;
  certificateApiStore.listShouldReject = false;
  certificateApiStore.listRejectError = null;
  certificateApiStore.mutationShouldReject = false;
  certificateApiStore.mutationRejectError = null;
  certificateApiStore.listCallCount = 0;
  certificateApiStore.getCallCount = 0;
  certificateApiStore.createCallCount = 0;
  certificateApiStore.patchCallCount = 0;
  certificateApiStore.submitCallCount = 0;
  certificateApiStore.approveCallCount = 0;
  certificateApiStore.rejectCallCount = 0;
  certificateApiStore.deleteCallCount = 0;
}

export function getPaymentCertificateListCallCount() {
  return certificateApiStore.listCallCount;
}

export function getPaymentCertificateCreateCallCount() {
  return certificateApiStore.createCallCount;
}

export function getPaymentCertificatePatchCallCount() {
  return certificateApiStore.patchCallCount;
}

export function getPaymentCertificateMutationCallCount() {
  return (
    certificateApiStore.createCallCount +
    certificateApiStore.patchCallCount +
    certificateApiStore.submitCallCount +
    certificateApiStore.approveCallCount +
    certificateApiStore.rejectCallCount +
    certificateApiStore.deleteCallCount
  );
}

export function setPaymentCertificateListDelay(ms) {
  certificateApiStore.listDelayMs = Number(ms) || 0;
}

export function setPaymentCertificateListReject(error) {
  certificateApiStore.listShouldReject = true;
  certificateApiStore.listRejectError =
    error ||
    new PaymentCertificateApiError('Payment certificates unavailable', {
      status: 500,
      body: { message: 'Payment certificates unavailable' },
    });
}

export function setPaymentCertificateMutationReject(error) {
  certificateApiStore.mutationShouldReject = true;
  certificateApiStore.mutationRejectError =
    error ||
    new PaymentCertificateApiError('Payment certificate mutation failed', {
      status: 500,
      body: { message: 'Payment certificate mutation failed' },
    });
}

export function seedMockPaymentCertificate(record) {
  if (!record?.id || !record?.packageId) {
    throw new Error('seedMockPaymentCertificate requires id and packageId');
  }

  const normalized = {
    certificateNumber: 1,
    status: 'draft',
    progress: {},
    commercialLines: [],
    version: 1,
    ...record,
  };

  const existing = listForPackage(record.packageId);
  const index = existing.findIndex((item) => item.id === record.id);
  const next =
    index === -1
      ? [...existing, normalized]
      : existing.map((item) => (item.id === record.id ? normalized : item));
  writePackage(record.packageId, next);
  return clone(normalized);
}

export function buildLockedServerCertificateFixture({
  packageId,
  orderKey,
  id = 'cert-server-1',
  certificateNumber = 1,
  grossValue = 24000,
  netValue = 22800,
  commercialLines = [],
  ...rest
} = {}) {
  return seedMockPaymentCertificate({
    id,
    packageId,
    orderKey,
    certificateNumber,
    status: 'locked',
    certificateDate: '2026-08-01',
    grossValue,
    netValue,
    matrixGross: grossValue,
    commercialEventGross: 0,
    recoverySigned: 0,
    retention: 1200,
    vat: 0,
    retentionRate: 0.05,
    vatRate: 0,
    version: 2,
    createdAt: '2026-08-01T10:00:00.000Z',
    createdBy: 'QS',
    submittedAt: '2026-08-01T11:00:00.000Z',
    submittedBy: 'QS',
    approvedAt: '2026-08-01T12:00:00.000Z',
    approvedBy: 'CM',
    progress: rest.progress || {},
    commercialLines,
    totals: {
      grossWorksThisCertificate: grossValue,
      netPayment: netValue,
    },
    ...rest,
  });
}

async function maybeDelay() {
  if (certificateApiStore.listDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, certificateApiStore.listDelayMs));
  }
}

export async function listCertificatesForPackage(packageId) {
  certificateApiStore.listCallCount += 1;
  await maybeDelay();
  if (certificateApiStore.listShouldReject) {
    throw certificateApiStore.listRejectError;
  }
  return listForPackage(packageId).map((item) => clone(item));
}

export async function getCertificateById(packageId, certificateId) {
  certificateApiStore.getCallCount += 1;
  const match = findCertificate(packageId, certificateId);
  if (!match) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  return clone(match);
}

export async function createCertificateForPackage(packageId, payload = {}) {
  certificateApiStore.createCallCount += 1;
  maybeRejectMutation();
  const existing = listForPackage(packageId);
  const open = existing.find((item) => item.status === 'draft' || item.status === 'submitted');
  if (open) {
    throw new PaymentCertificateApiError(
      `Certificate No. ${open.certificateNumber} must be approved before creating the next certificate.`,
      {
        status: 409,
        body: {
          message: `Certificate No. ${open.certificateNumber} must be approved before creating the next certificate.`,
        },
      }
    );
  }

  const nextNumber = existing.length
    ? Math.max(...existing.map((item) => Number(item.certificateNumber) || 0)) + 1
    : 1;
  const now = new Date().toISOString();
  const created = {
    id: nextId(),
    packageId,
    orderKey: payload.orderKey || existing[0]?.orderKey || null,
    certificateNumber: nextNumber,
    status: 'draft',
    certificateDate: payload.certificateDate || now.slice(0, 10),
    progress: {},
    commercialLines: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: payload.createdBy || payload.actor || 'Test QS',
    updatedBy: payload.updatedBy || payload.actor || 'Test QS',
    auditHistory: [
      {
        id: `audit-${nextNumber}`,
        action: 'created',
        actor: payload.actor || 'Test QS',
        at: now,
      },
    ],
  };
  writePackage(packageId, [...existing, created]);
  return clone(created);
}

export async function patchCertificateForPackage(packageId, certificateId, payload = {}) {
  certificateApiStore.patchCallCount += 1;
  maybeRejectMutation();
  const current = findCertificate(packageId, certificateId);
  if (!current) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  if (current.status !== 'draft') {
    throw new PaymentCertificateApiError('Only draft certificates can be patched.', {
      status: 409,
      body: { message: 'Only draft certificates can be patched.', certificate: clone(current) },
    });
  }
  requireVersion(payload, current);
  const now = new Date().toISOString();
  const next = {
    ...current,
    progress: payload.progress ? clone(payload.progress) : current.progress,
    commercialLines: Object.prototype.hasOwnProperty.call(payload, 'commercialLines')
      ? clone(payload.commercialLines)
      : current.commercialLines,
    certificateDate: payload.certificateDate || current.certificateDate,
    version: Number(current.version) + 1,
    updatedAt: now,
    updatedBy: payload.updatedBy || payload.actor || current.updatedBy,
  };
  return replaceCertificate(packageId, next);
}

export async function submitCertificateForPackage(packageId, certificateId, payload = {}) {
  certificateApiStore.submitCallCount += 1;
  maybeRejectMutation();
  const current = findCertificate(packageId, certificateId);
  if (!current) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  if (current.status !== 'draft') {
    throw new PaymentCertificateApiError('Only draft certificates can be submitted.', {
      status: 409,
      body: { message: 'Only draft certificates can be submitted.', certificate: clone(current) },
    });
  }
  requireVersion(payload, current);
  const now = new Date().toISOString();
  const next = {
    ...current,
    status: 'submitted',
    submittedAt: now,
    submittedBy: payload.actor || 'Test QS',
    version: Number(current.version) + 1,
    updatedAt: now,
  };
  return replaceCertificate(packageId, next);
}

export async function approveCertificateForPackage(packageId, certificateId, payload = {}) {
  certificateApiStore.approveCallCount += 1;
  maybeRejectMutation();
  const current = findCertificate(packageId, certificateId);
  if (!current) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  if (current.status !== 'submitted') {
    throw new PaymentCertificateApiError('Only submitted certificates can be approved.', {
      status: 409,
      body: { message: 'Only submitted certificates can be approved.', certificate: clone(current) },
    });
  }
  requireVersion(payload, current);
  const now = new Date().toISOString();
  const grossValue = current.grossValue ?? 0;
  const netValue = current.netValue ?? 0;
  const snapshotCells = Object.entries(current.progress || {}).map(([cellId, entry]) => ({
    cellId,
    plotId: entry.plotId,
    plotKey: entry.plotId,
    stageKey: entry.stageKey,
    thisCertificatePct: entry.thisCertificatePct,
    previousCumulativePct: 0,
    cumulativePct: entry.thisCertificatePct,
    contractValue: 0,
    previousValue: 0,
    thisCertificateValue: 0,
    certifiedToDateValue: 0,
    remainingValue: 0,
  }));
  const next = {
    ...current,
    status: 'locked',
    approvedAt: now,
    approvedBy: payload.actor || 'Test CM',
    grossValue,
    netValue,
    version: Number(current.version) + 1,
    updatedAt: now,
    valuationSnapshot: current.valuationSnapshot || {
      snapshotVersion: 1,
      capturedAt: now,
      totals: {
        grossWorksThisCertificate: grossValue,
        netPayment: netValue,
      },
      cells: snapshotCells,
    },
  };
  return replaceCertificate(packageId, next);
}

export async function rejectCertificateForPackage(packageId, certificateId, payload = {}) {
  certificateApiStore.rejectCallCount += 1;
  maybeRejectMutation();
  const current = findCertificate(packageId, certificateId);
  if (!current) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  if (current.status !== 'submitted') {
    throw new PaymentCertificateApiError('Only submitted certificates can be rejected.', {
      status: 409,
      body: { message: 'Only submitted certificates can be rejected.', certificate: clone(current) },
    });
  }
  requireVersion(payload, current);
  const comment = String(payload.comment || '').trim();
  if (!comment) {
    throw new PaymentCertificateApiError('A rejection comment is required.', {
      status: 400,
      body: { message: 'A rejection comment is required.' },
    });
  }
  const now = new Date().toISOString();
  const next = {
    ...current,
    status: 'draft',
    submittedAt: null,
    submittedBy: null,
    version: Number(current.version) + 1,
    updatedAt: now,
  };
  return replaceCertificate(packageId, next);
}

export async function deleteCertificateForPackage(packageId, certificateId) {
  certificateApiStore.deleteCallCount += 1;
  maybeRejectMutation();
  const current = findCertificate(packageId, certificateId);
  if (!current) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  if (current.status !== 'draft') {
    throw new PaymentCertificateApiError('Only draft certificates can be deleted.', {
      status: 409,
      body: { message: 'Only draft certificates can be deleted.' },
    });
  }
  writePackage(
    packageId,
    listForPackage(packageId).filter((item) => item.id !== certificateId)
  );
  return null;
}
