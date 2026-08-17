import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/paymentCertificates', () => import('../test/mockPaymentCertificateApi'));

import {
  buildLockedServerCertificateFixture,
  getPaymentCertificateListCallCount,
  resetPaymentCertificateApiStore,
  seedMockPaymentCertificate,
  setPaymentCertificateListDelay,
  setPaymentCertificateListReject,
} from '../test/mockPaymentCertificateApi';
import {
  __resetPaymentCertificateServerCacheForTests,
  ensureCertificatesReadyForPackage,
  getCachedCertificate,
  getCachedCertificates,
  getCertificateLoadState,
  refreshCertificatesForPackage,
  removeCachedCertificate,
  replaceCachedCertificates,
  upsertCachedCertificate,
} from './paymentCertificateServerCache';

const PACKAGE_A = 'aaaaaaaa-bbbb-4ccc-8ddd-111111111111';
const PACKAGE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-222222222222';

describe('paymentCertificateServerCache (BL-030B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    __resetPaymentCertificateServerCacheForTests();
    resetPaymentCertificateApiStore();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('loads certificates from idle/loading into loaded', async () => {
    setPaymentCertificateListDelay(20);
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_A,
      orderKey: 'dev::a::0120',
      grossValue: 24000,
    });

    expect(getCertificateLoadState(PACKAGE_A)).toBe('idle');
    const pending = ensureCertificatesReadyForPackage(PACKAGE_A);
    expect(getCertificateLoadState(PACKAGE_A)).toBe('loading');
    await pending;
    expect(getCertificateLoadState(PACKAGE_A)).toBe('loaded');
    expect(getCachedCertificates(PACKAGE_A)).toHaveLength(1);
    expect(getCachedCertificate(PACKAGE_A, 'cert-server-1').grossValue).toBe(24000);
  });

  it('treats a loaded empty list as genuine empty', async () => {
    await ensureCertificatesReadyForPackage(PACKAGE_A);
    expect(getCertificateLoadState(PACKAGE_A)).toBe('loaded');
    expect(getCachedCertificates(PACKAGE_A)).toEqual([]);
  });

  it('records cache error without collapsing to loaded empty', async () => {
    setPaymentCertificateListReject();
    await expect(ensureCertificatesReadyForPackage(PACKAGE_A)).rejects.toThrow(
      /unavailable/i
    );
    expect(getCertificateLoadState(PACKAGE_A)).toBe('error');
    expect(getCachedCertificates(PACKAGE_A)).toEqual([]);
  });

  it('deduplicates in-flight loads for the same package', async () => {
    setPaymentCertificateListDelay(30);
    seedMockPaymentCertificate({
      id: 'c1',
      packageId: PACKAGE_A,
      certificateNumber: 1,
      status: 'draft',
    });

    const [first, second] = await Promise.all([
      ensureCertificatesReadyForPackage(PACKAGE_A),
      ensureCertificatesReadyForPackage(PACKAGE_A),
    ]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(getPaymentCertificateListCallCount()).toBe(1);
  });

  it('refresh replaces the cached list', async () => {
    seedMockPaymentCertificate({
      id: 'c1',
      packageId: PACKAGE_A,
      certificateNumber: 1,
      status: 'draft',
    });
    await ensureCertificatesReadyForPackage(PACKAGE_A);
    expect(getCachedCertificates(PACKAGE_A)).toHaveLength(1);

    seedMockPaymentCertificate({
      id: 'c2',
      packageId: PACKAGE_A,
      certificateNumber: 2,
      status: 'draft',
    });
    await refreshCertificatesForPackage(PACKAGE_A);
    expect(getCachedCertificates(PACKAGE_A).map((item) => item.id)).toEqual(['c1', 'c2']);
  });

  it('isolates package A from package B', async () => {
    seedMockPaymentCertificate({
      id: 'a1',
      packageId: PACKAGE_A,
      certificateNumber: 1,
      status: 'locked',
      grossValue: 1000,
    });
    seedMockPaymentCertificate({
      id: 'b1',
      packageId: PACKAGE_B,
      certificateNumber: 1,
      status: 'locked',
      grossValue: 9000,
    });

    await ensureCertificatesReadyForPackage(PACKAGE_A);
    await ensureCertificatesReadyForPackage(PACKAGE_B);

    expect(getCachedCertificates(PACKAGE_A).map((item) => item.id)).toEqual(['a1']);
    expect(getCachedCertificates(PACKAGE_B).map((item) => item.id)).toEqual(['b1']);
  });

  it('patch helpers preserve package isolation', () => {
    replaceCachedCertificates(PACKAGE_A, [
      { id: 'a1', packageId: PACKAGE_A, certificateNumber: 1, status: 'draft' },
    ]);
    upsertCachedCertificate(PACKAGE_A, {
      id: 'a2',
      packageId: PACKAGE_A,
      certificateNumber: 2,
      status: 'draft',
    });
    upsertCachedCertificate(PACKAGE_B, {
      id: 'b1',
      packageId: PACKAGE_B,
      certificateNumber: 1,
      status: 'locked',
      grossValue: 5000,
    });
    removeCachedCertificate(PACKAGE_A, 'a1');

    expect(getCachedCertificates(PACKAGE_A).map((item) => item.id)).toEqual(['a2']);
    expect(getCachedCertificates(PACKAGE_B).map((item) => item.id)).toEqual(['b1']);
  });
});
