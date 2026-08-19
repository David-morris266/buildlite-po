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

import {
  buildLockedServerCertificateFixture,
  resetPaymentCertificateApiStore,
} from '../test/mockPaymentCertificateApi';
import {
  __resetPaymentCertificateServerCacheForTests,
  ensureCertificatesReadyForPackage,
} from './paymentCertificateServerCache';
import {
  approveCertificate,
  canCreateNextCertificate,
  createCertificate,
  getCertificate,
  getCertificateCount,
  listCertificates,
  resolveCertificatesForPackage,
  submitCertificate,
} from './paymentCertificateStore';
import {
  calculatePackageCertifiedGross,
  calculatePackageCertifiedNet,
  calculateRemainingContractValue,
} from './packageCertifiedTotals';
import { calculatePackageCertifiedValue } from '../cvr/cvrCertifiedValue';
import { buildPackageViewModel } from './subcontractPackage';
import { ensurePackageRecord } from './subcontractPackageStore';
import { saveOrderMatrix } from './orderMatrixStore';
import {
  buildCommercialEventCertificationOverlay,
  getCommercialEventCertificationBadges,
} from '../commercialEvents/commercialEventCertificationOverlay';
import { getCommercialEventRecoveryPresentation } from '../commercialEvents/commercialEventRecoveryOverlay';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { CERTIFICATE_COMMERCIAL_LINE_TYPES } from '../commercialEvents/commercialEventCertifiability';
import { saveCompanySettings } from '../admin/companyStore';

const DEV_ID = 'dev-bl030b';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LOCAL_STORAGE_KEY = 'buildlite_subcontract_packages_v1';

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  packageUuid: PACKAGE_UUID,
  supplierId: 'sup-1',
  costCode: '0120',
  supplierLabel: 'Carpentry Co',
  projectLabel: 'Test Site 1',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function seedLocalApprovedCertificate() {
  ensurePackageRecord(ORDER_KEY, baseOrder);
  const created = createCertificate(ORDER_KEY, baseOrder);
  submitCertificate(ORDER_KEY, created.certificate.id);
  approveCertificate(ORDER_KEY, created.certificate.id, {
    grossThisCertificate: 11111,
    netPayment: 10000,
  });
  return created.certificate;
}

describe('payment certificate authority reads (BL-030B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetPaymentCertificateServerCacheForTests();
    resetPaymentCertificateApiStore();
    localStorage.clear();
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    saveOrderMatrix(ORDER_KEY, {
      layout: 'plot-stage',
      plots: [{ id: 'plot-1', label: '1', values: [100000] }],
      stages: ['Stage 1'],
    });
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF listCertificates uses localStorage', () => {
    const created = createCertificate(ORDER_KEY, baseOrder);
    expect(listCertificates(ORDER_KEY)).toHaveLength(1);
    expect(listCertificates(ORDER_KEY)[0].id).toBe(created.certificate.id);
    expect(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY))[ORDER_KEY].certificates).toHaveLength(
      1
    );
  });

  it('authority ON list reads server cache once loaded', async () => {
    seedLocalApprovedCertificate();
    authorityEnabled.value = true;
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      id: 'server-cert',
      grossValue: 24000,
      netValue: 22800,
    });

    await ensureCertificatesReadyForPackage(PACKAGE_UUID);

    const listed = listCertificates(ORDER_KEY, baseOrder);
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe('server-cert');
    expect(listed[0].grossValue).toBe(24000);
    expect(listed[0].id).not.toBe(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY))[ORDER_KEY].certificates[0].id);
  });

  it('authority ON loading is not a genuine empty list', () => {
    seedLocalApprovedCertificate();
    authorityEnabled.value = true;

    const resolved = resolveCertificatesForPackage(ORDER_KEY, baseOrder);
    expect(resolved.ready).toBe(false);
    expect(resolved.loadState).toBe('idle');
    expect(listCertificates(ORDER_KEY, baseOrder)).toEqual([]);
    expect(getCertificateCount(ORDER_KEY, baseOrder)).toBeNull();
    expect(canCreateNextCertificate(ORDER_KEY, baseOrder).ok).toBe(false);
    expect(canCreateNextCertificate(ORDER_KEY, baseOrder).unavailable).toBe(true);
  });

  it('authority ON error has no localStorage fallback', async () => {
    seedLocalApprovedCertificate();
    authorityEnabled.value = true;

    const { setPaymentCertificateListReject } = await import('../test/mockPaymentCertificateApi');
    setPaymentCertificateListReject();

    await expect(ensureCertificatesReadyForPackage(PACKAGE_UUID)).rejects.toThrow();
    expect(resolveCertificatesForPackage(ORDER_KEY, baseOrder).ready).toBe(false);
    expect(resolveCertificatesForPackage(ORDER_KEY, baseOrder).loadState).toBe('error');
    expect(listCertificates(ORDER_KEY, baseOrder)).toEqual([]);
    expect(getCertificate(ORDER_KEY, JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY))[ORDER_KEY].certificates[0].id, baseOrder)).toBeNull();
    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBeNull();
  });

  it('package certified gross/net are unavailable while loading, not £0', () => {
    authorityEnabled.value = true;
    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBeNull();
    expect(calculatePackageCertifiedNet(ORDER_KEY, baseOrder)).toBeNull();
    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).not.toBe(0);
  });

  it('remaining contract is unavailable while loading, not full CCV', () => {
    authorityEnabled.value = true;
    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.certificatesReady).toBe(false);
    expect(pkg.certifiedGrossToDate).toBeNull();
    expect(pkg.remainingContractValue).toBeNull();
    expect(pkg.remainingContractValue).not.toBe(100000);
    expect(calculateRemainingContractValue(100000, null)).toBeNull();
  });

  it('CVR certified value is null while certificate cache is not ready', () => {
    authorityEnabled.value = true;
    expect(calculatePackageCertifiedValue(ORDER_KEY, baseOrder)).toBeNull();
  });

  it('loaded approved/frozen server values map into certified totals', async () => {
    authorityEnabled.value = true;
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      grossValue: 24000,
      netValue: 22800,
    });
    await ensureCertificatesReadyForPackage(PACKAGE_UUID);

    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBe(24000);
    expect(calculatePackageCertifiedNet(ORDER_KEY, baseOrder)).toBe(22800);
    expect(calculatePackageCertifiedValue(ORDER_KEY, baseOrder)).toBe(24000);
    expect(calculateRemainingContractValue(100000, 24000)).toBe(76000);
  });

  it('CE certification overlay is unavailable while certs loading', () => {
    authorityEnabled.value = true;
    const event = seedApprovedVariation();
    const overlay = buildCommercialEventCertificationOverlay({
      event,
      orderKey: ORDER_KEY,
    });
    expect(overlay.unavailable).toBe(true);
    expect(overlay.certifiedToDate).toBeNull();
    expect(getCommercialEventCertificationBadges(event, ORDER_KEY)).toEqual([]);
  });

  it('CE recovery overlay is unavailable while certs loading', () => {
    authorityEnabled.value = true;
    const recovery = seedApprovedRecovery();
    const presentation = getCommercialEventRecoveryPresentation(recovery, ORDER_KEY);
    expect(presentation.unavailable).toBe(true);
    expect(presentation.recoveredToDate).toBeNull();
    expect(presentation.presentationRecoveryStatus).toBeNull();
  });

  it('loaded locked server cert drives certification and recovery overlays', async () => {
    const event = seedApprovedVariation();
    const recovery = seedApprovedRecovery();
    authorityEnabled.value = true;
    buildLockedServerCertificateFixture({
      packageId: PACKAGE_UUID,
      orderKey: ORDER_KEY,
      id: 'locked-server',
      commercialLines: [
        {
          id: 'cel-1',
          commercialEventId: event.id,
          lineType: CERTIFICATE_COMMERCIAL_LINE_TYPES.valueInclusion,
          amountThisCertificate: 10000,
        },
        {
          id: 'cel-2',
          commercialEventId: recovery.id,
          lineType: CERTIFICATE_COMMERCIAL_LINE_TYPES.recoveryDeduction,
          amountThisCertificate: -7500,
        },
      ],
    });
    await ensureCertificatesReadyForPackage(PACKAGE_UUID);

    const overlay = buildCommercialEventCertificationOverlay({
      event,
      orderKey: ORDER_KEY,
    });
    expect(overlay.unavailable).toBe(false);
    expect(overlay.certifiedToDate).toBe(10000);
    expect(overlay.source).toBe('server-certificate-history');
    expect(getCommercialEventCertificationBadges(event, ORDER_KEY)[0].label).toBe(
      'Fully Certified'
    );

    const presentation = getCommercialEventRecoveryPresentation(recovery, ORDER_KEY);
    expect(presentation.unavailable).toBe(false);
    expect(presentation.recoveredToDate).toBe(7500);
    expect(presentation.source).toBe('server-certificate-history');
  });

  it('authority OFF keeps the existing create/submit/approve lifecycle on localStorage', () => {
    authorityEnabled.value = false;
    const created = createCertificate(ORDER_KEY, baseOrder);
    expect(created.ok).toBe(true);
    expect(submitCertificate(ORDER_KEY, created.certificate.id).ok).toBe(true);
    expect(
      approveCertificate(ORDER_KEY, created.certificate.id, {
        grossThisCertificate: 5000,
        netPayment: 4750,
      }).ok
    ).toBe(true);
    expect(getCertificate(ORDER_KEY, created.certificate.id).status).toBe('locked');
    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBe(5000);
  });
});

function seedApprovedVariation() {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Scope change',
    value: 10000,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return getCommercialEventById(DEV_ID, created.event.id);
}

function seedApprovedRecovery() {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
    category: 'commercial',
    subcategory: 'damage',
    responsibility: 'subcontractor',
    description: 'Recovery',
    value: -7500,
    relationshipType: 'recovery',
    recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return getCommercialEventById(DEV_ID, created.event.id);
}
