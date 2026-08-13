/**
 * @vitest-environment jsdom
 */
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('./commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
  canUseCommercialEventsForFinancials: () => !authorityEnabled.value,
}));

vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildApprovedVariationFixture,
  resetCommercialEventApiStore,
  setCommercialEventListDelay,
} from '../test/mockCommercialEventApi';
import {
  __resetCommercialEventServerCacheForTests,
  ensureCommercialEventsReadyForDevelopment,
} from './commercialEventServerCache';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import { PackageTable } from '../components/DevelopmentOverview';
import { SubcontractPackageDashboard } from '../components/SubcontractPackageOverview';

const DEV_ID = 'dev-ccv-safety';
const ORDER_KEY = `${DEV_ID}::sup-spark::0120`;
const ORIGINAL_PO = 100000;
const APPROVED_VARIATION = 20000;

function makeOrder() {
  return {
    orderKey: ORDER_KEY,
    developmentId: DEV_ID,
    supplierId: 'sup-spark',
    costCode: '0120',
    supplierLabel: 'Sparktastic',
    projectLabel: 'Test Site 1',
    committedValue: ORIGINAL_PO,
    certifiedToDate: 0,
    remaining: ORIGINAL_PO,
    certificateCount: 0,
    status: { label: 'Ready', modifier: 'ready' },
  };
}

describe('commercialEvent CCV safety (BL-028B.1)', () => {
  let container;
  let root;

  beforeEach(() => {
    authorityEnabled.value = false;
    __resetCommercialEventServerCacheForTests();
    resetCommercialEventApiStore();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('does not expose PO-only CCV while server cache is loading when authority is enabled', () => {
    authorityEnabled.value = true;

    buildApprovedVariationFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      value: APPROVED_VARIATION,
    });
    setCommercialEventListDelay(100);

    const displayBeforeHydration = buildPackageCommercialDisplayFields(makeOrder());

    expect(displayBeforeHydration.commercialEventsReady).toBe(false);
    expect(displayBeforeHydration.currentPackageValue).toBeNull();
    expect(displayBeforeHydration.approvedCommercialEventMovement).toBeNull();
    expect(displayBeforeHydration.currentPackageValue).not.toBe(ORIGINAL_PO);
  });

  it('shows £120,000 CCV after hydration when approved variation exists (£100k + £20k)', async () => {
    authorityEnabled.value = true;

    buildApprovedVariationFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      value: APPROVED_VARIATION,
    });

    await ensureCommercialEventsReadyForDevelopment(DEV_ID);

    const display = buildPackageCommercialDisplayFields(makeOrder());

    expect(display.commercialEventsReady).toBe(true);
    expect(display.approvedCommercialEventMovement).toBe(APPROVED_VARIATION);
    expect(display.currentPackageValue).toBe(ORIGINAL_PO + APPROVED_VARIATION);
  });

  it('package view model suppresses false PO-only CCV before hydration', () => {
    authorityEnabled.value = true;

    buildApprovedVariationFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      value: APPROVED_VARIATION,
    });

    const pkg = buildPackageViewModel(makeOrder());

    expect(pkg.commercialEventsReady).toBe(false);
    expect(pkg.currentContractValue).toBeNull();
    expect(pkg.currentContractValue).not.toBe(ORIGINAL_PO);
  });

  it('DevelopmentOverview PackageTable shows loading placeholders instead of £100,000 CCV', () => {
    authorityEnabled.value = true;

    buildApprovedVariationFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      value: APPROVED_VARIATION,
    });

    act(() => {
      root.render(
        <PackageTable
          packages={[makeOrder()]}
          onOpenPackage={() => {}}
          commercialEventsLoading
        />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Loading commercial data…');
    expect(text).not.toMatch(/£100,000\.00/);
  });

  it('DevelopmentOverview PackageTable shows £120,000 CCV after hydration', async () => {
    authorityEnabled.value = true;

    buildApprovedVariationFixture({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      value: APPROVED_VARIATION,
    });

    await ensureCommercialEventsReadyForDevelopment(DEV_ID);

    act(() => {
      root.render(
        <PackageTable packages={[makeOrder()]} onOpenPackage={() => {}} />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('£120k');
    expect(text).toContain('+£20k');
  });

  it('SubcontractPackageDashboard shows loading commercial data instead of PO-only CCV', () => {
    authorityEnabled.value = true;

    const pkg = buildPackageViewModel(makeOrder());

    act(() => {
      root.render(
        <SubcontractPackageDashboard pkg={pkg} commercialEventsLoading />
      );
    });

    const text = container.textContent || '';
    expect(text).toContain('Loading commercial data…');
    expect(text).not.toMatch(/£100,000\.00/);
  });

  it('localStorage authority remains unchanged when server authority flag is off', () => {
    authorityEnabled.value = false;

    const display = buildPackageCommercialDisplayFields(makeOrder());
    expect(display.commercialEventsReady).toBe(true);
    expect(display.currentPackageValue).toBe(ORIGINAL_PO);
  });
});
