/**
 * @vitest-environment jsdom
 * BL-029D — Order Matrix server-authority save/cutover.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const fetchPackageByOrderKey = vi.hoisted(() => vi.fn());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./orderMatrixAuthority', () => ({
  isOrderMatrixServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/orderMatrices', () => import('../test/mockOrderMatrixApi'));

vi.mock('./packageStore', () => ({
  fetchPackageByOrderKey: (...args) => fetchPackageByOrderKey(...args),
  getCachedPackageByOrderKey: () => null,
}));

import {
  buildPlotStageMatrixFixture,
  getLastOrderMatrixPut,
  getOrderMatrixPutCallCount,
  resetOrderMatrixApiStore,
  setOrderMatrixPutReject,
  OrderMatrixApiError,
} from '../test/mockOrderMatrixApi';
import {
  __resetOrderMatrixServerCacheForTests,
  ensureMatricesReadyForDevelopment,
  getCachedOrderMatrixByOrderKey,
  getOrderMatricesLoadState,
} from './orderMatrixServerCache';
import {
  MATRIX_VERSION_CONFLICT_MESSAGE,
  PACKAGE_UUID_REQUIRED_MESSAGE,
  persistOrderMatrix,
  resolvePackageUuidFromOrder,
} from './orderMatrixServerMutations';
import {
  loadOrderMatrix,
  resolveOrderMatrixForPackage,
  saveOrderMatrix,
} from './orderMatrixStore';
import { summarizeCertificateProgress } from './paymentCertificateProgress';
import {
  createCertificate,
  submitCertificate,
  approveCertificate,
  getCertificate,
} from './paymentCertificateStore';
import { ensurePackageRecord } from './subcontractPackageStore';

const DEV_ID = 'dev-matrix-cutover';
const ORDER_KEY_A = `${DEV_ID}::sup-1::0120`;
const ORDER_KEY_B = `${DEV_ID}::sup-2::0121`;
const PACKAGE_UUID_A = 'a2419cff-f776-4a2c-8a29-01934b460bf1';
const PACKAGE_UUID_B = 'b3519cff-f776-4a2c-8a29-01934b460bf2';

const orderA = {
  orderKey: ORDER_KEY_A,
  developmentId: DEV_ID,
  jobId: DEV_ID,
  packageId: PACKAGE_UUID_A,
  supplierId: 'sup-1',
  projectLabel: 'Test Site 1',
  supplierLabel: 'Sparktastic',
  committedValue: 1500,
};

const plotStagePayload = {
  layout: 'plot-stage',
  stages: ['Foundations', 'Superstructure'],
  plots: [{ id: 'plot-1', label: 'Plot 1', values: [500, 1000] }],
  committedValue: 1500,
};

function matrixStorageSnapshot() {
  return storage.get('buildlite_order_matrices_v1') || null;
}

describe('BL-029D order matrix server mutations', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    storage.clear();
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
    fetchPackageByOrderKey.mockReset();
    fetchPackageByOrderKey.mockRejectedValue(new Error('package not found'));
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF save still writes localStorage and does not PUT', async () => {
    const result = await persistOrderMatrix(orderA, plotStagePayload);

    expect(result.ok).toBe(true);
    expect(getOrderMatrixPutCallCount()).toBe(0);
    expect(JSON.parse(matrixStorageSnapshot())[ORDER_KEY_A].plots).toHaveLength(1);
    expect(loadOrderMatrix(ORDER_KEY_A)?.layout).toBe('plot-stage');
  });

  it('authority ON save calls PUT and does not write matrix localStorage', async () => {
    authorityEnabled.value = true;

    const result = await persistOrderMatrix(orderA, plotStagePayload);

    expect(result.ok).toBe(true);
    expect(getOrderMatrixPutCallCount()).toBe(1);
    expect(getLastOrderMatrixPut().packageId).toBe(PACKAGE_UUID_A);
    expect(getLastOrderMatrixPut().payload.orderKey).toBe(ORDER_KEY_A);
    expect(getLastOrderMatrixPut().payload.version).toBeUndefined();
    expect(matrixStorageSnapshot()).toBeNull();
    expect(result.matrix.orderKey).toBe(ORDER_KEY_A);
    expect(result.matrix.packageUuid).toBe(PACKAGE_UUID_A);
  });

  it('successful PUT patches the development cache immediately', async () => {
    authorityEnabled.value = true;

    await persistOrderMatrix(orderA, plotStagePayload);

    expect(getOrderMatricesLoadState(DEV_ID)).toBe('loaded');
    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A)?.plots[0].label).toBe('Plot 1');
    expect(resolveOrderMatrixForPackage(orderA).present).toBe(true);
    expect(loadOrderMatrix(ORDER_KEY_A)?.packageUuid).toBe(PACKAGE_UUID_A);
  });

  it('re-import sends the current version', async () => {
    authorityEnabled.value = true;
    await persistOrderMatrix(orderA, plotStagePayload);

    const result = await persistOrderMatrix(orderA, {
      ...plotStagePayload,
      plots: [{ id: 'plot-1', label: 'Plot 1', values: [600, 1100] }],
    });

    expect(result.ok).toBe(true);
    expect(getLastOrderMatrixPut().payload.version).toBe(1);
    expect(result.matrix.version).toBe(2);
    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A).plots[0].values[0]).toBe(600);
  });

  it('stale 409 is surfaced and does not fall back to localStorage', async () => {
    authorityEnabled.value = true;
    buildPlotStageMatrixFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY_A,
      packageId: PACKAGE_UUID_A,
      version: 2,
    });
    await ensureMatricesReadyForDevelopment(DEV_ID);
    getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A).version = 1;

    const result = await persistOrderMatrix(orderA, plotStagePayload);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.errors[0]).toBe(MATRIX_VERSION_CONFLICT_MESSAGE);
    expect(matrixStorageSnapshot()).toBeNull();
    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A).version).toBe(2);
  });

  it('PUT failure has no localStorage fallback', async () => {
    authorityEnabled.value = true;
    setOrderMatrixPutReject(
      new OrderMatrixApiError('Order matrix save failed', { status: 500 })
    );

    const result = await persistOrderMatrix(orderA, plotStagePayload);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/Order matrix save failed/);
    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A)).toBeNull();
    expect(matrixStorageSnapshot()).toBeNull();
    expect(loadOrderMatrix(ORDER_KEY_A)).toBeNull();
  });

  it('resolves package UUID from a cached matrix when the order has no UUID', async () => {
    authorityEnabled.value = true;
    await persistOrderMatrix(orderA, plotStagePayload);

    const result = await persistOrderMatrix(
      { ...orderA, packageId: null, packageUuid: null, id: null },
      {
        ...plotStagePayload,
        plots: [{ id: 'plot-1', label: 'Plot 1', values: [700, 800] }],
      }
    );

    expect(result.ok).toBe(true);
    expect(getLastOrderMatrixPut().packageId).toBe(PACKAGE_UUID_A);
    expect(getLastOrderMatrixPut().payload.version).toBe(1);
  });

  it('requires a package UUID and does not materialise a package', async () => {
    authorityEnabled.value = true;
    const result = await persistOrderMatrix(
      { ...orderA, packageId: ORDER_KEY_A, packageUuid: null, id: ORDER_KEY_A },
      plotStagePayload
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toBe(PACKAGE_UUID_REQUIRED_MESSAGE);
    expect(getOrderMatrixPutCallCount()).toBe(0);
    expect(fetchPackageByOrderKey).toHaveBeenCalledWith(ORDER_KEY_A);
  });

  it('preserves orderKey and does not treat package UUID as the client key', async () => {
    authorityEnabled.value = true;
    await persistOrderMatrix(orderA, plotStagePayload);

    const resolved = resolveOrderMatrixForPackage(orderA);
    expect(resolved.matrix.orderKey).toBe(ORDER_KEY_A);
    expect(resolved.matrix.orderKey).not.toBe(PACKAGE_UUID_A);
    expect(resolvePackageUuidFromOrder(orderA)).toBe(PACKAGE_UUID_A);
  });

  it('keeps package A and package B isolated after save', async () => {
    authorityEnabled.value = true;
    await persistOrderMatrix(orderA, plotStagePayload);
    await persistOrderMatrix(
      { ...orderA, orderKey: ORDER_KEY_B, packageId: PACKAGE_UUID_B, supplierId: 'sup-2' },
      {
        ...plotStagePayload,
        plots: [{ id: 'plot-b', label: 'Plot B-only', values: [1, 2] }],
      }
    );

    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_A).plots[0].label).toBe('Plot 1');
    expect(getCachedOrderMatrixByOrderKey(DEV_ID, ORDER_KEY_B).plots[0].label).toBe('Plot B-only');
    expect(resolveOrderMatrixForPackage({ ...orderA, orderKey: ORDER_KEY_B, packageId: PACKAGE_UUID_B }).matrix.plots[0].label).not.toBe(
      'Plot 1'
    );
  });

  it('hard-refresh hydration returns the same saved server matrix', async () => {
    authorityEnabled.value = true;
    await persistOrderMatrix(orderA, plotStagePayload);
    __resetOrderMatrixServerCacheForTests();

    await ensureMatricesReadyForDevelopment(DEV_ID);

    expect(resolveOrderMatrixForPackage(orderA).matrix.packageUuid).toBe(PACKAGE_UUID_A);
    expect(resolveOrderMatrixForPackage(orderA).matrix.plots[0].label).toBe('Plot 1');
  });

  it('frozen approved certificate totals stay unchanged after a matrix replacement', async () => {
    authorityEnabled.value = true;
    ensurePackageRecord(ORDER_KEY_A, orderA);
    const created = createCertificate(ORDER_KEY_A, orderA).certificate;
    submitCertificate(ORDER_KEY_A, created.id);
    approveCertificate(
      ORDER_KEY_A,
      created.id,
      { grossWorksThisCertificate: 50000, netPayment: 47500 },
      orderA
    );

    await persistOrderMatrix(orderA, plotStagePayload);
    const summary = summarizeCertificateProgress(
      ORDER_KEY_A,
      getCertificate(ORDER_KEY_A, created.id).id,
      orderA
    );

    expect(summary.totals.grossThisCertificate).toBe(50000);
    expect(summary.totals.netPayment).toBe(47500);
  });
});
