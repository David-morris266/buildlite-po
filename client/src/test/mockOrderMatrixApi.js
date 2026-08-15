/**
 * In-memory Order Matrix API mock for client tests (BL-029B).
 */

const orderMatrixApiStore = {
  matrices: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  listCallCount: 0,
};

export class OrderMatrixApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Order Matrix API request failed');
    this.name = 'OrderMatrixApiError';
    this.status = status;
    this.body = body;
  }
}

export function resetOrderMatrixApiStore() {
  orderMatrixApiStore.matrices.clear();
  orderMatrixApiStore.listDelayMs = 0;
  orderMatrixApiStore.listShouldReject = false;
  orderMatrixApiStore.listRejectError = null;
  orderMatrixApiStore.listCallCount = 0;
}

export function getOrderMatrixListCallCount() {
  return orderMatrixApiStore.listCallCount;
}

export function setOrderMatrixListDelay(ms) {
  orderMatrixApiStore.listDelayMs = Number(ms) || 0;
}

export function setOrderMatrixListReject(error) {
  orderMatrixApiStore.listShouldReject = true;
  orderMatrixApiStore.listRejectError =
    error ||
    new OrderMatrixApiError('Order matrices unavailable', {
      status: 500,
      body: { message: 'Order matrices unavailable' },
    });
}

function recordKey(developmentId, orderKey) {
  return `${developmentId}::${orderKey}`;
}

export function seedMockOrderMatrix(record) {
  if (!record?.developmentId || !record?.orderKey) {
    throw new Error('seedMockOrderMatrix requires developmentId and orderKey');
  }
  const normalized = {
    id: record.id || `mx-${record.orderKey}`,
    packageId: record.packageId || record.packageUuid || `pkg-${record.orderKey}`,
    orderKey: record.orderKey,
    developmentId: record.developmentId,
    layout: record.layout || 'plot-stage',
    committedValue: record.committedValue ?? 0,
    stages: Array.isArray(record.stages) ? record.stages : ['Foundations', 'Superstructure'],
    plots: Array.isArray(record.plots)
      ? record.plots
      : [{ id: 'plot-1', label: 'Plot 1', values: [500, 1000] }],
    jobId: record.jobId || record.developmentId,
    supplierId: record.supplierId || '',
    projectLabel: record.projectLabel || '',
    supplierLabel: record.supplierLabel || '',
    version: record.version || 1,
    updatedAt: record.updatedAt || '2026-08-15T12:00:00.000Z',
    ...record,
  };
  orderMatrixApiStore.matrices.set(
    recordKey(normalized.developmentId, normalized.orderKey),
    normalized
  );
  return { ...normalized };
}

export function buildPlotStageMatrixFixture({
  developmentId,
  orderKey,
  packageId = 'pkg-uuid-matrix-1',
  committedValue = 1500,
  stages = ['Foundations', 'Superstructure'],
  plots = [{ id: 'plot-1', label: 'Plot 1', values: [500, 1000] }],
  ...rest
} = {}) {
  return seedMockOrderMatrix({
    developmentId,
    orderKey,
    packageId,
    committedValue,
    stages,
    plots,
    ...rest,
  });
}

export async function listMatricesForDevelopment(developmentId) {
  orderMatrixApiStore.listCallCount += 1;
  if (orderMatrixApiStore.listDelayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, orderMatrixApiStore.listDelayMs));
  }
  if (orderMatrixApiStore.listShouldReject) {
    throw orderMatrixApiStore.listRejectError;
  }
  return [...orderMatrixApiStore.matrices.values()]
    .filter((matrix) => matrix.developmentId === developmentId)
    .map((matrix) => ({ ...matrix }));
}

export async function getMatrixByPackageId(packageId) {
  const record = [...orderMatrixApiStore.matrices.values()].find(
    (matrix) => matrix.packageId === packageId || matrix.packageUuid === packageId
  );
  if (!record) {
    throw new OrderMatrixApiError('Order matrix not found.', {
      status: 404,
      body: { message: 'Order matrix not found.' },
    });
  }
  return { ...record };
}

export async function getMatrixByOrderKey(orderKey) {
  const record = [...orderMatrixApiStore.matrices.values()].find(
    (matrix) => matrix.orderKey === orderKey
  );
  if (!record) {
    throw new OrderMatrixApiError('Order matrix not found.', {
      status: 404,
      body: { message: 'Order matrix not found.' },
    });
  }
  return { ...record };
}

export async function putMatrixForPackage() {
  throw new Error('putMatrixForPackage mock not used in BL-029B runtime');
}
