/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

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

import {
  buildPlotStageMatrixFixture,
  resetOrderMatrixApiStore,
  setOrderMatrixListReject,
  OrderMatrixApiError,
} from '../test/mockOrderMatrixApi';
import {
  __resetOrderMatrixServerCacheForTests,
  ensureMatricesReadyForDevelopment,
  patchCachedOrderMatrix,
} from './orderMatrixServerCache';
import {
  deleteOrderMatrix,
  hasOrderMatrix,
  loadOrderMatrix,
  resolveOrderMatrixForPackage,
  saveOrderMatrix,
} from './orderMatrixStore';

const DEV_ID = 'dev-matrix-authority';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'pkg-uuid-authority';

function seedLocalMatrix() {
  return saveOrderMatrix(ORDER_KEY, {
    orderKey: ORDER_KEY,
    jobId: DEV_ID,
    layout: 'plot-stage',
    committedValue: 999,
    stages: ['Local stage'],
    plots: [{ id: 'local-1', label: 'Local plot', values: [999] }],
  });
}

describe('orderMatrixStore authority facade (BL-029B)', () => {
  beforeEach(() => {
    authorityEnabled.value = false;
    storage.clear();
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
  });

  it('authority OFF uses localStorage reads and writes exactly as before', () => {
    expect(hasOrderMatrix(ORDER_KEY)).toBe(false);
    expect(loadOrderMatrix(ORDER_KEY)).toBeNull();

    seedLocalMatrix();

    expect(hasOrderMatrix(ORDER_KEY)).toBe(true);
    expect(loadOrderMatrix(ORDER_KEY)?.committedValue).toBe(999);
    expect(loadOrderMatrix(ORDER_KEY)?.plots[0].label).toBe('Local plot');
    expect(resolveOrderMatrixForPackage(ORDER_KEY).ready).toBe(true);
    expect(resolveOrderMatrixForPackage(ORDER_KEY).present).toBe(true);
    expect(resolveOrderMatrixForPackage(ORDER_KEY).loadState).toBe('local');

    deleteOrderMatrix(ORDER_KEY);
    expect(hasOrderMatrix(ORDER_KEY)).toBe(false);
  });

  it('authority ON reads from the server cache, not localStorage', async () => {
    seedLocalMatrix();
    authorityEnabled.value = true;
    buildPlotStageMatrixFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      packageId: PACKAGE_UUID,
      committedValue: 1500,
    });

    await ensureMatricesReadyForDevelopment(DEV_ID);

    expect(loadOrderMatrix(ORDER_KEY)?.committedValue).toBe(1500);
    expect(loadOrderMatrix(ORDER_KEY)?.packageUuid).toBe(PACKAGE_UUID);
    expect(hasOrderMatrix(ORDER_KEY)).toBe(true);
    expect(resolveOrderMatrixForPackage({ orderKey: ORDER_KEY, developmentId: DEV_ID }).matrix.plots[0].label).toBe(
      'Plot 1'
    );
  });

  it('authority ON loading is not genuine matrix absence', () => {
    seedLocalMatrix();
    authorityEnabled.value = true;

    const resolved = resolveOrderMatrixForPackage({
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
    });

    expect(resolved.ready).toBe(false);
    expect(resolved.present).toBe(false);
    expect(resolved.loadState).toBe('idle');
    expect(resolved.matrix).toBeNull();
    expect(hasOrderMatrix(ORDER_KEY)).toBe(false);
    expect(loadOrderMatrix(ORDER_KEY)).toBeNull();
  });

  it('authority ON API failure has no localStorage fallback', async () => {
    seedLocalMatrix();
    authorityEnabled.value = true;
    setOrderMatrixListReject(
      new OrderMatrixApiError('Order matrices unavailable', { status: 500 })
    );

    await expect(ensureMatricesReadyForDevelopment(DEV_ID)).rejects.toThrow(
      'Order matrices unavailable'
    );

    const resolved = resolveOrderMatrixForPackage({
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
    });
    expect(resolved.ready).toBe(false);
    expect(resolved.loadState).toBe('error');
    expect(resolved.error?.message).toContain('Order matrices unavailable');
    expect(loadOrderMatrix(ORDER_KEY)).toBeNull();
    expect(hasOrderMatrix(ORDER_KEY)).toBe(false);
  });

  it('authority ON loaded with no matrix is genuine absence', async () => {
    seedLocalMatrix();
    authorityEnabled.value = true;

    await ensureMatricesReadyForDevelopment(DEV_ID);

    const resolved = resolveOrderMatrixForPackage({
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
    });
    expect(resolved.ready).toBe(true);
    expect(resolved.present).toBe(false);
    expect(resolved.matrix).toBeNull();
    expect(hasOrderMatrix(ORDER_KEY)).toBe(false);
  });

  it('authority ON saveOrderMatrix does not write localStorage', () => {
    authorityEnabled.value = true;
    patchCachedOrderMatrix(DEV_ID, {
      id: 'mx-cache',
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
      committedValue: 1,
    });

    saveOrderMatrix(ORDER_KEY, {
      layout: 'plot-stage',
      committedValue: 42,
      plots: [],
      stages: [],
    });

    expect(storage.get('buildlite_order_matrices_v1')).toBeUndefined();
    expect(loadOrderMatrix(ORDER_KEY)?.committedValue).toBe(1);
  });
});
