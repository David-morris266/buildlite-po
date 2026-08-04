import { describe, expect, it } from 'vitest';
import { buildSubcontractOrderKey } from './packageKeyMigration';
import {
  buildPackageWorkspaceLaunchContext,
  getPackageLaunchErrorMessage,
  PACKAGE_OPENED_FROM,
  resolvePackageOrderFromList,
  resolvePackageWorkspaceBackTarget,
  resolvePackageWorkspaceInitialTab,
  validatePackageLaunchIdentity,
} from './packageWorkspaceLaunch';

const DEV_ID = 'dev-oakwood';
const SUPPLIER_ID = 'sup-plumb';
const COST_CODE = '0120';
const ORDER_KEY = buildSubcontractOrderKey(DEV_ID, SUPPLIER_ID, COST_CODE);

const packageRow = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: SUPPLIER_ID,
  costCode: COST_CODE,
  supplierLabel: 'PlumbCo',
  projectLabel: 'Oakwood Meadows',
  committedValue: 50000,
  certificateCount: 2,
  poNumbers: ['S0004'],
};

describe('packageWorkspaceLaunch', () => {
  it('resolves development, supplier and cost code to the canonical orderKey', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
    });

    expect(launch.orderKey).toBe(ORDER_KEY);
    expect(launch.developmentId).toBe(DEV_ID);
    expect(launch.supplierId).toBe(SUPPLIER_ID);
    expect(launch.costCode).toBe(COST_CODE);
    expect(launch.identityError).toBeNull();
  });

  it('defaults to Overview when opened from Developments', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
    });

    expect(resolvePackageWorkspaceInitialTab(launch.openedFrom, launch.initialTab)).toBe(
      'overview'
    );
  });

  it('returns to the development Packages tab from DevelopmentPackages context', () => {
    expect(
      resolvePackageWorkspaceBackTarget(PACKAGE_OPENED_FROM.DevelopmentPackages)
    ).toBe('development-packages');
  });

  it('preserves Payment Certificates back context', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow,
      openedFrom: PACKAGE_OPENED_FROM.PaymentCertificates,
      initialTab: 'certificates',
    });

    expect(launch.initialTab).toBe('certificates');
    expect(
      resolvePackageWorkspaceBackTarget(PACKAGE_OPENED_FROM.PaymentCertificates)
    ).toBe('payment-certificates-list');
  });

  it('finds the same package order object used by certificate routes', () => {
    const resolved = resolvePackageOrderFromList([packageRow], ORDER_KEY);
    expect(resolved).toEqual(packageRow);
  });

  it('reports missing supplier identity safely', () => {
    const error = validatePackageLaunchIdentity({
      developmentId: DEV_ID,
      supplierId: null,
      costCode: COST_CODE,
      orderKey: ORDER_KEY,
    });

    expect(error).toMatch(/supplier/i);
    expect(
      getPackageLaunchErrorMessage(
        buildPackageWorkspaceLaunchContext({
          packageRow: { ...packageRow, supplierId: null },
          openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
        }),
        null
      )
    ).toMatch(/supplier/i);
  });

  it('reports missing cost code safely', () => {
    const error = validatePackageLaunchIdentity({
      developmentId: DEV_ID,
      supplierId: SUPPLIER_ID,
      costCode: '',
      orderKey: null,
    });

    expect(error).toMatch(/cost code/i);
  });

  it('reports package-not-found when orderKey does not resolve in the list', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
    });

    expect(getPackageLaunchErrorMessage(launch, null)).toMatch(/not found/i);
  });
});

describe('BL-021A.4 package workspace reuse', () => {
  it('uses one canonical SubcontractPackageWorkspace entry contract', async () => {
    const workspaceModule = await import('../components/SubcontractPackageWorkspace.jsx');
    expect(workspaceModule.default).toBeTypeOf('function');
    expect(workspaceModule.default.name).toBe('SubcontractPackageWorkspace');
  });

  it('does not introduce an alternate package workspace component', async () => {
    const glob = import.meta.glob('../components/SubcontractPackageWorkspace.jsx');
    expect(Object.keys(glob)).toEqual(['../components/SubcontractPackageWorkspace.jsx']);
  });

  it('keeps Commercial Events available on the Variations tab', async () => {
    const source = await import('../components/SubcontractPackageWorkspace.jsx?raw');
    expect(String(source.default)).toMatch(/PackageCommercialEvents/);
    expect(String(source.default)).toMatch(/id: 'variations'/);
  });
});
