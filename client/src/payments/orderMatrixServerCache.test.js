import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/orderMatrices', () => import('../test/mockOrderMatrixApi'));

import {
  buildPlotStageMatrixFixture,
  getOrderMatrixListCallCount,
  resetOrderMatrixApiStore,
  setOrderMatrixListDelay,
  setOrderMatrixListReject,
  OrderMatrixApiError,
} from '../test/mockOrderMatrixApi';
import {
  __resetOrderMatrixServerCacheForTests,
  ensureMatricesReadyForDevelopment,
  getCachedOrderMatrixByOrderKey,
  getCachedOrderMatrixByPackageUuid,
  getOrderMatricesLoadError,
  getOrderMatricesLoadState,
  getOrderMatrixFinancialReadiness,
  listCachedOrderMatricesByDevelopment,
  refreshMatricesForDevelopment,
} from './orderMatrixServerCache';

const DEV_A = 'dev-matrix-a';
const DEV_B = 'dev-matrix-b';
const ORDER_KEY_A = `${DEV_A}::sup-1::0120`;
const ORDER_KEY_B = `${DEV_B}::sup-1::0120`;
const PACKAGE_UUID_A = 'pkg-uuid-a';

describe('orderMatrixServerCache', () => {
  beforeEach(() => {
    __resetOrderMatrixServerCacheForTests();
    resetOrderMatrixApiStore();
  });

  it('hydrates successfully and exposes synchronous selectors', async () => {
    buildPlotStageMatrixFixture({
      developmentId: DEV_A,
      orderKey: ORDER_KEY_A,
      packageId: PACKAGE_UUID_A,
      committedValue: 1500,
    });

    expect(getOrderMatricesLoadState(DEV_A)).toBe('idle');

    await ensureMatricesReadyForDevelopment(DEV_A);

    expect(getOrderMatricesLoadState(DEV_A)).toBe('loaded');
    expect(getOrderMatrixFinancialReadiness(DEV_A).ready).toBe(true);
    expect(listCachedOrderMatricesByDevelopment(DEV_A)).toHaveLength(1);
    expect(getCachedOrderMatrixByOrderKey(DEV_A, ORDER_KEY_A)?.committedValue).toBe(1500);
    expect(getCachedOrderMatrixByPackageUuid(DEV_A, PACKAGE_UUID_A)?.orderKey).toBe(ORDER_KEY_A);
  });

  it('handles empty hydration result as loaded with no matrices', async () => {
    await ensureMatricesReadyForDevelopment(DEV_A);

    expect(getOrderMatricesLoadState(DEV_A)).toBe('loaded');
    expect(listCachedOrderMatricesByDevelopment(DEV_A)).toEqual([]);
    expect(getCachedOrderMatrixByOrderKey(DEV_A, ORDER_KEY_A)).toBeNull();
  });

  it('sets error state and throws on API failure without populating cache', async () => {
    setOrderMatrixListReject(
      new OrderMatrixApiError('Order matrices unavailable', {
        status: 500,
        body: { message: 'Order matrices unavailable' },
      })
    );

    await expect(ensureMatricesReadyForDevelopment(DEV_A)).rejects.toThrow(
      'Order matrices unavailable'
    );

    expect(getOrderMatricesLoadState(DEV_A)).toBe('error');
    expect(getOrderMatricesLoadError(DEV_A)?.message).toContain('Order matrices unavailable');
    expect(getOrderMatrixFinancialReadiness(DEV_A).ready).toBe(false);
    expect(listCachedOrderMatricesByDevelopment(DEV_A)).toEqual([]);
  });

  it('deduplicates concurrent hydration for the same development', async () => {
    setOrderMatrixListDelay(50);
    buildPlotStageMatrixFixture({ developmentId: DEV_A, orderKey: ORDER_KEY_A });

    const first = ensureMatricesReadyForDevelopment(DEV_A);
    const second = ensureMatricesReadyForDevelopment(DEV_A);

    await Promise.all([first, second]);

    expect(getOrderMatrixListCallCount()).toBe(1);
    expect(getOrderMatricesLoadState(DEV_A)).toBe('loaded');
    expect(listCachedOrderMatricesByDevelopment(DEV_A)).toHaveLength(1);
  });

  it('does not refetch when the development is already loaded', async () => {
    buildPlotStageMatrixFixture({ developmentId: DEV_A, orderKey: ORDER_KEY_A });

    await ensureMatricesReadyForDevelopment(DEV_A);
    await ensureMatricesReadyForDevelopment(DEV_A);

    expect(getOrderMatrixListCallCount()).toBe(1);
  });

  it('refresh replaces cache contents', async () => {
    buildPlotStageMatrixFixture({
      id: 'mx-first',
      developmentId: DEV_A,
      orderKey: ORDER_KEY_A,
      committedValue: 1000,
    });

    await ensureMatricesReadyForDevelopment(DEV_A);
    expect(listCachedOrderMatricesByDevelopment(DEV_A)[0].committedValue).toBe(1000);

    resetOrderMatrixApiStore();
    buildPlotStageMatrixFixture({
      id: 'mx-second',
      developmentId: DEV_A,
      orderKey: ORDER_KEY_A,
      committedValue: 5000,
    });

    await refreshMatricesForDevelopment(DEV_A);

    const matrices = listCachedOrderMatricesByDevelopment(DEV_A);
    expect(matrices).toHaveLength(1);
    expect(matrices[0].matrixId).toBe('mx-second');
    expect(matrices[0].committedValue).toBe(5000);
  });

  it('keeps separate development caches isolated', async () => {
    buildPlotStageMatrixFixture({
      id: 'mx-dev-a',
      developmentId: DEV_A,
      orderKey: ORDER_KEY_A,
      packageId: 'pkg-a',
    });
    buildPlotStageMatrixFixture({
      id: 'mx-dev-b',
      developmentId: DEV_B,
      orderKey: ORDER_KEY_B,
      packageId: 'pkg-b',
    });

    await Promise.all([
      ensureMatricesReadyForDevelopment(DEV_A),
      ensureMatricesReadyForDevelopment(DEV_B),
    ]);

    expect(getCachedOrderMatrixByOrderKey(DEV_A, ORDER_KEY_A)?.matrixId).toBe('mx-dev-a');
    expect(getCachedOrderMatrixByOrderKey(DEV_B, ORDER_KEY_B)?.matrixId).toBe('mx-dev-b');
    expect(getCachedOrderMatrixByOrderKey(DEV_A, ORDER_KEY_B)).toBeNull();
    expect(getCachedOrderMatrixByPackageUuid(DEV_A, 'pkg-b')).toBeNull();
  });
});
