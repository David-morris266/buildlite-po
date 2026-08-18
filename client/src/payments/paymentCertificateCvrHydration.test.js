import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./paymentCertificateAuthority', () => ({
  isPaymentCertificateServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/paymentCertificates', () => import('../test/mockPaymentCertificateApi'));
vi.mock('../api/packages', () => import('../test/mockPackageApi'));

import {
  buildLockedServerCertificateFixture,
  getPaymentCertificateListCallCount,
  resetPaymentCertificateApiStore,
  setPaymentCertificateListReject,
} from '../test/mockPaymentCertificateApi';
import { resetPackageApiStore, seedMockPackage } from '../test/mockPackageApi';
import {
  __resetPackageStoreForTests,
  ensurePackagesReadyForDevelopment,
} from './packageStore';
import {
  __resetPaymentCertificateServerCacheForTests,
  ensureCertificatesReadyForDevelopment,
  getDevelopmentCertificateLoadState,
} from './paymentCertificateServerCache';
import { calculatePackageCertifiedValue } from '../cvr/cvrCertifiedValue';
import { buildCertifiedByCostCode } from '../cvr/cvrEngine';

const DEV_ID = 'dev-bl030c-cvr';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-cccccccccccc';

const order = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  packageUuid: PACKAGE_UUID,
  costCode: '0120',
};

describe('CVR certificate hydration (BL-030C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    __resetPaymentCertificateServerCacheForTests();
    __resetPackageStoreForTests();
    resetPaymentCertificateApiStore();
    resetPackageApiStore();
    storage.clear();
    seedMockPackage({
      id: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      developmentId: DEV_ID,
      supplierId: 'sup-1',
      costCode: '0120',
    });
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('certified value is unavailable until development packages are hydrated', async () => {
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      grossValue: 24000,
      netValue: 22800,
    });

    expect(calculatePackageCertifiedValue(ORDER_KEY, order)).toBeNull();
    expect(calculatePackageCertifiedValue(ORDER_KEY, order)).not.toBe(0);

    await ensurePackagesReadyForDevelopment(DEV_ID, { pos: [] });
    expect(getDevelopmentCertificateLoadState(DEV_ID)).toBe('idle');
    expect(calculatePackageCertifiedValue(ORDER_KEY, order)).toBeNull();

    await ensureCertificatesReadyForDevelopment(DEV_ID);
    expect(getDevelopmentCertificateLoadState(DEV_ID)).toBe('loaded');
    expect(calculatePackageCertifiedValue(ORDER_KEY, order)).toBe(22800);
  });

  it('deduplicates development hydration requests', async () => {
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      netValue: 1000,
    });
    await ensurePackagesReadyForDevelopment(DEV_ID, { pos: [] });
    const first = ensureCertificatesReadyForDevelopment(DEV_ID);
    const second = ensureCertificatesReadyForDevelopment(DEV_ID);
    expect(first).toBe(second);
    await first;
    const listCount = getPaymentCertificateListCallCount();
    await ensureCertificatesReadyForDevelopment(DEV_ID);
    expect(getPaymentCertificateListCallCount()).toBe(listCount);
    expect(getDevelopmentCertificateLoadState(DEV_ID)).toBe('loaded');
  });

  it('API failure keeps certified unavailable rather than £0', async () => {
    setPaymentCertificateListReject();
    await ensurePackagesReadyForDevelopment(DEV_ID, { pos: [] });
    await expect(ensureCertificatesReadyForDevelopment(DEV_ID)).rejects.toThrow();
    expect(getDevelopmentCertificateLoadState(DEV_ID)).toBe('error');
    expect(calculatePackageCertifiedValue(ORDER_KEY, order)).toBeNull();

    const aggregated = buildCertifiedByCostCode(DEV_ID, [
      {
        type: 'S',
        status: 'Approved',
        approval: { status: 'Approved' },
        supplierId: 'sup-1',
        subtotal: 100000,
        costRef: { costCode: '0120', developmentId: DEV_ID },
        items: [{ costCode: '0120', amount: 100000 }],
      },
    ]);
    expect(aggregated.unavailable.has('0120')).toBe(true);
  });
});
