import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/packages', () => import('../test/mockPackageApi'));

import {
  getMaterialiseCalls,
  resetPackageApiStore,
  seedMockPackage,
} from '../test/mockPackageApi';
import {
  __resetPackageStoreForTests,
  ensurePackagesReadyForDevelopment,
  getCachedPackageByOrderKey,
  getPackagesLoadState,
} from '../payments/packageStore';
import {
  buildPoOrdersForDevelopment,
  findMissingServerPackageKeys,
  mergeServerPackagesWithPoOrders,
} from '../payments/packageIdentityMerge';
import { buildSubcontractOrderKey } from '../payments/packageKeyMigration';
import { saveOrderMatrix, loadOrderMatrix } from '../payments/orderMatrixStore';
import { ensurePackageRecord, getPackageRecord } from '../payments/subcontractPackageStore';
import { createCertificate, listCertificates } from '../payments/paymentCertificateStore';

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const SPARK_SUPPLIER = 'sup-1';
const MUCKY_SUPPLIER = 'sup-2';
const SPARK_ORDER_KEY = buildSubcontractOrderKey(TEST_SITE_ID, SPARK_SUPPLIER, '0120');
const MUCKY_ORDER_KEY = buildSubcontractOrderKey(TEST_SITE_ID, MUCKY_SUPPLIER, '0200');

function approvedPo({ poNumber, developmentId, supplierId, costCode, subtotal }) {
  return {
    poNumber,
    type: 'S',
    status: 'Approved',
    approval: { status: 'approved' },
    supplierId,
    development: { id: developmentId, developmentName: 'Test Site 1' },
    costRef: { costCode },
    items: [{ costCode }],
    subtotal,
  };
}

describe('packageIdentityMerge', () => {
  it('preserves exact orderKey and attaches server packageId', () => {
    const serverPackages = [
      {
        id: 'pkg-spark-uuid',
        orderKey: SPARK_ORDER_KEY,
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        supplierLabel: 'Sparktastic',
        poNumbers: ['S0001'],
      },
    ];
    const poOrders = [
      {
        orderKey: SPARK_ORDER_KEY,
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        supplierLabel: 'Sparktastic Live',
        projectLabel: 'Test Site 1',
        committedValue: 100000,
        certifiedToDate: 0,
        remaining: 100000,
        certificateCount: 0,
        status: { label: 'Ready', modifier: 'ready' },
        hasMatrix: true,
        matrixRowCount: 3,
        poNumbers: ['S0001'],
        pos: [],
      },
    ];

    const merged = mergeServerPackagesWithPoOrders(serverPackages, poOrders);
    expect(merged).toHaveLength(1);
    expect(merged[0].packageId).toBe('pkg-spark-uuid');
    expect(merged[0].orderKey).toBe(SPARK_ORDER_KEY);
    expect(merged[0].committedValue).toBe(100000);
    expect(merged[0].supplierLabel).toBe('Sparktastic Live');
  });

  it('two approved POs with same business key still build one commercial view model', () => {
    const orderKey = buildSubcontractOrderKey(TEST_SITE_ID, SPARK_SUPPLIER, '0120');
    const pos = [
      approvedPo({
        poNumber: 'S0001',
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        subtotal: 50000,
      }),
      approvedPo({
        poNumber: 'S0002',
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        subtotal: 30000,
      }),
    ];

    const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, pos);
    expect(poOrders).toHaveLength(1);
    expect(poOrders[0].committedValue).toBe(80000);
    expect(poOrders[0].poNumbers.sort()).toEqual(['S0001', 'S0002']);

    const merged = mergeServerPackagesWithPoOrders(
      [
        {
          id: 'pkg-group-uuid',
          orderKey,
          developmentId: TEST_SITE_ID,
          supplierId: SPARK_SUPPLIER,
          costCode: '0120',
          poNumbers: ['S0001', 'S0002'],
        },
      ],
      poOrders
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].poNumbers.sort()).toEqual(['S0001', 'S0002']);
  });

  it('detects missing server identities when PO-derived orderKey exists', () => {
    const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, [
      approvedPo({
        poNumber: 'S0001',
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        subtotal: 100000,
      }),
    ]);

    const missing = findMissingServerPackageKeys([], poOrders);
    expect(missing).toEqual([SPARK_ORDER_KEY]);
  });

  it('keeps Test Site 1 Sparktastic and Mucky orderKeys unchanged', () => {
    expect(SPARK_ORDER_KEY).toBe(`${TEST_SITE_ID}::${SPARK_SUPPLIER}::0120`);
    expect(MUCKY_ORDER_KEY).toBe(`${TEST_SITE_ID}::${MUCKY_SUPPLIER}::0200`);
  });
});

describe('packageStore', () => {
  beforeEach(() => {
    resetPackageApiStore();
    __resetPackageStoreForTests();
  });

  it('lists server packages for a development', async () => {
    seedMockPackage({
      id: 'pkg-1',
      orderKey: SPARK_ORDER_KEY,
      developmentId: TEST_SITE_ID,
      supplierId: SPARK_SUPPLIER,
      costCode: '0120',
      supplierLabel: 'Sparktastic',
      poNumbers: ['S0001'],
    });

    const packages = await ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos: [] });
    expect(packages).toHaveLength(1);
    expect(packages[0].id).toBe('pkg-1');
  });

  it('resolves package by orderKey from cache', async () => {
    seedMockPackage({
      id: 'pkg-mucky',
      orderKey: MUCKY_ORDER_KEY,
      developmentId: TEST_SITE_ID,
      supplierId: MUCKY_SUPPLIER,
      costCode: '0200',
      supplierLabel: 'Mucky Plasterers',
      poNumbers: ['S0003'],
    });

    await ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos: [] });
    const pkg = getCachedPackageByOrderKey(TEST_SITE_ID, MUCKY_ORDER_KEY);
    expect(pkg?.id).toBe('pkg-mucky');
    expect(pkg?.orderKey).toBe(MUCKY_ORDER_KEY);
  });

  it('development-scoped materialisation fills missing identities without whole-tenant scan', async () => {
    const pos = [
      approvedPo({
        poNumber: 'S0001',
        developmentId: TEST_SITE_ID,
        supplierId: SPARK_SUPPLIER,
        costCode: '0120',
        subtotal: 100000,
      }),
    ];

    await ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos });

    expect(getMaterialiseCalls()).toEqual([{ developmentId: TEST_SITE_ID }]);
  });

  it('does not silently fall back when server load fails', async () => {
    const api = await import('../api/packages');
    vi.spyOn(api, 'listPackagesForDevelopment').mockRejectedValueOnce(
      new Error('Server unavailable')
    );

    await expect(
      ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos: [] })
    ).rejects.toThrow('Server unavailable');

    const state = getPackagesLoadState(TEST_SITE_ID);
    expect(state.loadState).toBe('error');
    expect(state.loadError?.message).toContain('Server unavailable');
  });

  it('materialisation rerun is idempotent for cached development packages', async () => {
    seedMockPackage({
      id: 'pkg-spark',
      orderKey: SPARK_ORDER_KEY,
      developmentId: TEST_SITE_ID,
      supplierId: SPARK_SUPPLIER,
      costCode: '0120',
      poNumbers: ['S0001'],
    });

    const first = await ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos: [] });
    const second = await ensurePackagesReadyForDevelopment(TEST_SITE_ID, { pos: [] });
    expect(first[0].orderKey).toBe(second[0].orderKey);
    expect(first[0].id).toBe(second[0].id);
  });
});

describe('local downstream compatibility by orderKey', () => {
  beforeEach(() => {
    storage.clear();
  });

  it('local matrix, CE container, and certificates resolve by unchanged orderKey', () => {
    const orderKey = buildSubcontractOrderKey(TEST_SITE_ID, SPARK_SUPPLIER, '0120');
    const order = {
      orderKey,
      developmentId: TEST_SITE_ID,
      supplierId: SPARK_SUPPLIER,
      costCode: '0120',
      committedValue: 100000,
      poNumbers: ['S0001'],
    };

    saveOrderMatrix(orderKey, {
      layout: 'plot-stage',
      plots: [{ label: '1', values: [100000] }],
      stages: ['Stage 1'],
    });
    ensurePackageRecord(orderKey, order);
    createCertificate(orderKey, order);

    expect(loadOrderMatrix(orderKey)?.plots).toHaveLength(1);
    expect(getPackageRecord(orderKey)?.orderKey).toBe(orderKey);
    expect(listCertificates(orderKey)).toHaveLength(1);
    expect(getPackageRecord(orderKey)?.certificates).toHaveLength(1);
  });
});

describe('buildSubcontractOrderKey compatibility', () => {
  it('remains unchanged for normalised cost codes', () => {
    expect(buildSubcontractOrderKey('dev-x', 'sup-y', '5218')).toBe('dev-x::sup-y::5218');
    expect(buildSubcontractOrderKey('dev-x', 'sup-y', ' 5218 ')).toBe('dev-x::sup-y::5218');
  });
});
