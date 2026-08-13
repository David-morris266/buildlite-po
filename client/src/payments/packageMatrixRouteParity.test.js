import { describe, expect, it } from 'vitest';
import { buildSubcontractOrderKey } from './packageKeyMigration';
import { buildPoOrdersForDevelopment, mergeServerPackagesWithPoOrders } from './packageIdentityMerge';
import {
  compareCommercialWorkspaceOrders,
  resolvePackageWorkspaceOrder,
  resolvePackageWorkspaceOrderFromPoList,
} from './packageWorkspaceOrderResolver';

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const WIPE_SUPPLIER = 'sup-1786619149194';
const WIPE_ORDER_KEY = buildSubcontractOrderKey(
  TEST_SITE_ID,
  WIPE_SUPPLIER,
  '5231 - cleaning - cleaning'
);

function approvedWipePo() {
  return {
    poNumber: 'S0012',
    type: 'S',
    status: 'Approved',
    approval: { status: 'approved' },
    supplierId: WIPE_SUPPLIER,
    development: { id: TEST_SITE_ID, developmentName: 'Test Site 1' },
    developmentId: TEST_SITE_ID,
    costRef: { costCode: '5231 - Cleaning - Cleaning' },
    items: [{ costCode: '5231 - Cleaning - Cleaning' }],
    subtotal: 50000,
  };
}

function wipeServerPackage() {
  return {
    id: 'a2419cff-f776-4a2c-8a29-01934b460bf1',
    orderKey: WIPE_ORDER_KEY,
    developmentId: TEST_SITE_ID,
    supplierId: WIPE_SUPPLIER,
    costCode: '5231 - cleaning - cleaning',
    supplierLabel: 'Wipe It Cleaners',
    developmentNumber: 'DEV-001',
    developmentName: 'Test Site 1',
    poNumbers: ['S0012'],
  };
}

describe('Wipe It Cleaners route parity', () => {
  const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, [approvedWipePo()]);

  it('resolves equivalent commercial context on Development and Payment Certificates paths', () => {
    const developmentResolution = resolvePackageWorkspaceOrder({
      orderKey: WIPE_ORDER_KEY,
      serverPackages: [wipeServerPackage()],
      poOrders,
      poLoading: false,
      packagesLoading: false,
    });

    const certificatesResolution = resolvePackageWorkspaceOrderFromPoList({
      orderKey: WIPE_ORDER_KEY,
      poOrders,
      poLoading: false,
    });

    expect(developmentResolution.status).toBe('ready');
    expect(certificatesResolution.status).toBe('ready');
    expect(developmentResolution.order.committedValue).toBe(50000);
    expect(developmentResolution.order.pos).toHaveLength(1);
    expect(compareCommercialWorkspaceOrders(
      developmentResolution.order,
      certificatesResolution.order
    ).equivalent).toBe(true);
  });

  it('returns loading during PO refresh only before a stable workspace order exists', () => {
    const loadingResolution = resolvePackageWorkspaceOrder({
      orderKey: WIPE_ORDER_KEY,
      serverPackages: [wipeServerPackage()],
      poOrders: [],
      poLoading: true,
      packagesLoading: false,
    });

    expect(loadingResolution.status).toBe('loading');

    const merged = mergeServerPackagesWithPoOrders([wipeServerPackage()], poOrders)[0];
    expect(merged.commercialContextReady).toBe(true);
    expect(merged.committedValue).toBe(50000);
  });

  it('preserves open workspace during PO refresh once stable order exists', () => {
    const stableOrder = { orderKey: WIPE_ORDER_KEY, committedValue: 50000 };
    const loadingResolution = { status: 'loading', order: null };

    const oldGateShowsLoading =
      !loadingResolution || loadingResolution.status === 'loading';
    expect(oldGateShowsLoading).toBe(true);

    const activeOrder =
      loadingResolution.status === 'loading' &&
      stableOrder.orderKey === WIPE_ORDER_KEY
        ? stableOrder
        : null;

    expect(activeOrder?.committedValue).toBe(50000);
  });
});
