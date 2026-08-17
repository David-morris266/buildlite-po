/**
 * In-memory V1 Payment Certificate API mock for client tests (BL-030B).
 */

const certificateApiStore = {
  certificatesByPackage: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
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

export function resetPaymentCertificateApiStore() {
  certificateApiStore.certificatesByPackage.clear();
  certificateApiStore.listDelayMs = 0;
  certificateApiStore.listShouldReject = false;
  certificateApiStore.listRejectError = null;
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

export function seedMockPaymentCertificate(record) {
  if (!record?.id || !record?.packageId) {
    throw new Error('seedMockPaymentCertificate requires id and packageId');
  }

  const normalized = {
    certificateNumber: 1,
    status: 'draft',
    progress: {},
    commercialLines: [],
    ...record,
  };

  const existing = certificateApiStore.certificatesByPackage.get(record.packageId) || [];
  const index = existing.findIndex((item) => item.id === record.id);
  const next =
    index === -1
      ? [...existing, normalized]
      : existing.map((item) => (item.id === record.id ? normalized : item));
  certificateApiStore.certificatesByPackage.set(record.packageId, next);
  return { ...normalized };
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
  return (certificateApiStore.certificatesByPackage.get(packageId) || []).map((item) => ({
    ...item,
  }));
}

export async function getCertificateById(packageId, certificateId) {
  certificateApiStore.getCallCount += 1;
  const match = (certificateApiStore.certificatesByPackage.get(packageId) || []).find(
    (item) => item.id === certificateId
  );
  if (!match) {
    throw new PaymentCertificateApiError('Payment certificate not found.', {
      status: 404,
      body: { message: 'Payment certificate not found.' },
    });
  }
  return { ...match };
}

export async function createCertificateForPackage() {
  certificateApiStore.createCallCount += 1;
  throw new Error('BL-030B tests must not call createCertificateForPackage');
}

export async function patchCertificateForPackage() {
  certificateApiStore.patchCallCount += 1;
  throw new Error('BL-030B tests must not call patchCertificateForPackage');
}

export async function submitCertificateForPackage() {
  certificateApiStore.submitCallCount += 1;
  throw new Error('BL-030B tests must not call submitCertificateForPackage');
}

export async function approveCertificateForPackage() {
  certificateApiStore.approveCallCount += 1;
  throw new Error('BL-030B tests must not call approveCertificateForPackage');
}

export async function rejectCertificateForPackage() {
  certificateApiStore.rejectCallCount += 1;
  throw new Error('BL-030B tests must not call rejectCertificateForPackage');
}

export async function deleteCertificateForPackage() {
  certificateApiStore.deleteCallCount += 1;
  throw new Error('BL-030B tests must not call deleteCertificateForPackage');
}
