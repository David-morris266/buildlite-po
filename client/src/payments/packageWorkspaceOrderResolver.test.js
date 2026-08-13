import { describe, expect, it } from 'vitest';
import { buildSubcontractOrderKey } from './packageKeyMigration';
import { buildPoOrdersForDevelopment } from './packageIdentityMerge';
import { buildSubcontractOrdersFromPos } from './subcontractOrders';
import {
  compareCommercialWorkspaceOrders,
  isCommercialContextReady,
  resolvePackageWorkspaceOrder,
  resolvePackageWorkspaceOrderFromPoList,
} from './packageWorkspaceOrderResolver';

const TEST_SITE_ID = 'dev-1785599776666-zck5pl';
const BRICKS_SUPPLIER = 'sup-1786606980806';
const SPARKS_SUPPLIER = 'sup-1';
const BRICKS_PACKAGE_UUID = 'e1174b75-72d3-4a8d-80e0-ec5cfe2edbfd';
const BRICKS_ORDER_KEY = buildSubcontractOrderKey(
  TEST_SITE_ID,
  BRICKS_SUPPLIER,
  '2300 — brickwork — brickwork'
);
const SPARKS_ORDER_KEY = buildSubcontractOrderKey(TEST_SITE_ID, SPARKS_SUPPLIER, '0120');
const BRICKS_COMMITMENT = 250000;

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

function bricksServerPackage() {
  return {
    id: BRICKS_PACKAGE_UUID,
    orderKey: BRICKS_ORDER_KEY,
    developmentId: TEST_SITE_ID,
    supplierId: BRICKS_SUPPLIER,
    costCode: '2300 — brickwork — brickwork',
    supplierLabel: 'Bricks R Us',
    developmentNumber: 'TS1',
    developmentName: 'Test Site 1',
    poNumbers: ['S0011'],
  };
}

function sparksServerPackage() {
  return {
    id: 'pkg-sparks-uuid',
    orderKey: SPARKS_ORDER_KEY,
    developmentId: TEST_SITE_ID,
    supplierId: SPARKS_SUPPLIER,
    costCode: '0120',
    supplierLabel: 'Sparks R Us',
    poNumbers: ['S0001'],
  };
}

describe('resolvePackageWorkspaceOrder', () => {
  it('returns loading when server package references POs but PO list is still loading', () => {
    const resolution = resolvePackageWorkspaceOrder({
      orderKey: BRICKS_ORDER_KEY,
      serverPackages: [bricksServerPackage()],
      poOrders: [],
      poLoading: true,
      packagesLoading: false,
    });

    expect(resolution.status).toBe('loading');
    expect(resolution.reason).toBe('awaiting-po-context');
    expect(resolution.order).toBeNull();
  });

  it('returns incomplete after PO load when referenced PO cannot be resolved', () => {
    const resolution = resolvePackageWorkspaceOrder({
      orderKey: BRICKS_ORDER_KEY,
      serverPackages: [bricksServerPackage()],
      poOrders: [],
      poLoading: false,
      packagesLoading: false,
    });

    expect(resolution.status).toBe('incomplete');
    expect(resolution.reason).toBe('unresolved-po-context');
    expect(resolution.order?.committedValue).toBe(0);
    expect(resolution.order?.pos).toEqual([]);
  });

  it('auto-resolves to ready once matching approved PO arrives', () => {
    const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, [
      approvedPo({
        poNumber: 'S0011',
        developmentId: TEST_SITE_ID,
        supplierId: BRICKS_SUPPLIER,
        costCode: '2300 — brickwork — brickwork',
        subtotal: BRICKS_COMMITMENT,
      }),
    ]);

    const resolution = resolvePackageWorkspaceOrder({
      orderKey: BRICKS_ORDER_KEY,
      serverPackages: [bricksServerPackage()],
      poOrders,
      poLoading: false,
      packagesLoading: false,
    });

    expect(resolution.status).toBe('ready');
    expect(resolution.order.packageId).toBe(BRICKS_PACKAGE_UUID);
    expect(resolution.order.orderKey).toBe(BRICKS_ORDER_KEY);
    expect(resolution.order.developmentId).toBe(TEST_SITE_ID);
    expect(resolution.order.supplierId).toBe(BRICKS_SUPPLIER);
    expect(resolution.order.committedValue).toBe(BRICKS_COMMITMENT);
    expect(resolution.order.pos.length).toBeGreaterThan(0);
    expect(resolution.order.poNumbers).toContain('S0011');
  });

  it('opens Sparks immediately when matching PO is already present', () => {
    const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, [
      approvedPo({
        poNumber: 'S0001',
        developmentId: TEST_SITE_ID,
        supplierId: SPARKS_SUPPLIER,
        costCode: '0120',
        subtotal: 100000,
      }),
    ]);

    const resolution = resolvePackageWorkspaceOrder({
      orderKey: SPARKS_ORDER_KEY,
      serverPackages: [sparksServerPackage()],
      poOrders,
      poLoading: false,
      packagesLoading: false,
    });

    expect(resolution.status).toBe('ready');
    expect(resolution.order.committedValue).toBe(100000);
    expect(resolution.order.pos.length).toBeGreaterThan(0);
  });

  it('does not treat unresolved server-only fallback as commercially ready', () => {
    const resolution = resolvePackageWorkspaceOrder({
      orderKey: BRICKS_ORDER_KEY,
      serverPackages: [bricksServerPackage()],
      poOrders: [],
      poLoading: false,
      packagesLoading: false,
    });

    expect(isCommercialContextReady(resolution.order, {
      serverPackage: bricksServerPackage(),
    })).toBe(false);
    expect(resolution.status).not.toBe('ready');
  });
});

describe('resolvePackageWorkspaceOrderFromPoList', () => {
  it('returns loading while Payment Certificates PO list is fetching', () => {
    const resolution = resolvePackageWorkspaceOrderFromPoList({
      orderKey: BRICKS_ORDER_KEY,
      poOrders: [],
      poLoading: true,
    });

    expect(resolution.status).toBe('loading');
    expect(resolution.reason).toBe('awaiting-po-list');
  });

  it('returns ready with PO-derived commercial context', () => {
    const poOrders = buildSubcontractOrdersFromPos([
      approvedPo({
        poNumber: 'S0011',
        developmentId: TEST_SITE_ID,
        supplierId: BRICKS_SUPPLIER,
        costCode: '2300 — brickwork — brickwork',
        subtotal: BRICKS_COMMITMENT,
      }),
    ]);

    const resolution = resolvePackageWorkspaceOrderFromPoList({
      orderKey: BRICKS_ORDER_KEY,
      poOrders,
      poLoading: false,
    });

    expect(resolution.status).toBe('ready');
    expect(resolution.order.committedValue).toBe(BRICKS_COMMITMENT);
    expect(resolution.order.poNumbers).toContain('S0011');
  });
});

describe('compareCommercialWorkspaceOrders', () => {
  it('reports equivalent commercial context between Development and Payment Certificates paths', () => {
    const poOrders = buildPoOrdersForDevelopment(TEST_SITE_ID, [
      approvedPo({
        poNumber: 'S0011',
        developmentId: TEST_SITE_ID,
        supplierId: BRICKS_SUPPLIER,
        costCode: '2300 — brickwork — brickwork',
        subtotal: BRICKS_COMMITMENT,
      }),
    ]);

    const developmentResolution = resolvePackageWorkspaceOrder({
      orderKey: BRICKS_ORDER_KEY,
      serverPackages: [bricksServerPackage()],
      poOrders,
      poLoading: false,
      packagesLoading: false,
    });

    const certificatesResolution = resolvePackageWorkspaceOrderFromPoList({
      orderKey: BRICKS_ORDER_KEY,
      poOrders,
      poLoading: false,
    });

    const comparison = compareCommercialWorkspaceOrders(
      developmentResolution.order,
      certificatesResolution.order
    );

    expect(developmentResolution.status).toBe('ready');
    expect(certificatesResolution.status).toBe('ready');
    expect(comparison.equivalent).toBe(true);
    expect(comparison.differences).toEqual([]);
    expect(developmentResolution.order.packageId).toBe(BRICKS_PACKAGE_UUID);
    expect(certificatesResolution.order.packageId).toBeUndefined();
    expect(developmentResolution.order.orderKey).toBe(
      certificatesResolution.order.orderKey
    );
  });
});
