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
  getPaymentCertificateCreateCallCount,
  getPaymentCertificateMutationCallCount,
  getPaymentCertificatePatchCallCount,
  resetPaymentCertificateApiStore,
  seedMockPaymentCertificate,
  setPaymentCertificateMutationReject,
} from '../test/mockPaymentCertificateApi';
import {
  __resetPaymentCertificateServerCacheForTests,
  ensureCertificatesReadyForPackage,
  getCachedCertificate,
  getCachedCertificates,
  rememberPackageUuidForOrderKey,
  upsertCachedCertificate,
} from './paymentCertificateServerCache';
import { __resetPaymentCertificateMutationQueuesForTests } from './paymentCertificateServerMutations';
import {
  addCommercialLineToCertificate,
  approveCertificate,
  createCertificate,
  deleteCertificate,
  getCertificate,
  listCertificates,
  rejectCertificate,
  submitCertificate,
  updateCertificateProgress,
} from './paymentCertificateStore';
import { saveOrderMatrix } from './orderMatrixStore';
import { ensurePackageRecord } from './subcontractPackageStore';
import { buildStableCellId } from './paymentCertificateCellIdentity';
import { CERTIFICATE_COMMERCIAL_LINE_TYPES } from '../commercialEvents/commercialEventCertifiability';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { COMMERCIAL_EVENT_TYPES } from '../commercialEvents/commercialEventTypes';
import { saveCompanySettings } from '../admin/companyStore';

const DEV_ID = 'dev-bl030c';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const PACKAGE_B = 'aaaaaaaa-bbbb-4ccc-8ddd-bbbbbbbbbbbb';
const LOCAL_STORAGE_KEY = 'buildlite_subcontract_packages_v1';

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  packageUuid: PACKAGE_UUID,
  supplierId: 'sup-1',
  costCode: '0120',
  supplierLabel: 'Wipe It Cleaners',
  projectLabel: 'Test Site 1',
};

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [
      { id: 'plot-1', label: 'Plot 1', values: [10000, 20000] },
      { id: 'plot-2', label: 'Plot 2', values: [8000, 12000] },
    ],
    stages: ['First Fix', 'Second Fix'],
  });
}

function localCertificates() {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return [];
  return JSON.parse(raw)?.[ORDER_KEY]?.certificates || [];
}

describe('payment certificate server mutations (BL-030C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetPaymentCertificateServerCacheForTests();
    __resetPaymentCertificateMutationQueuesForTests();
    resetPaymentCertificateApiStore();
    storage.clear();
    localStorage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
    rememberPackageUuidForOrderKey(ORDER_KEY, PACKAGE_UUID);
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF create/write stays on localStorage and does not call the server', async () => {
    const created = createCertificate(ORDER_KEY, baseOrder);
    expect(created.ok).toBe(true);
    expect(created.certificate.id.startsWith('cert-')).toBe(true);
    expect(localCertificates()).toHaveLength(1);
    expect(getPaymentCertificateCreateCallCount()).toBe(0);
    expect(getPaymentCertificateMutationCallCount()).toBe(0);
  });

  it('authority ON create calls the server, patches cache, and does not write certificates to localStorage', async () => {
    authorityEnabled.value = true;
    const before = localCertificates().length;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    expect(created.ok).toBe(true);
    expect(created.certificate.certificateNumber).toBe(1);
    expect(created.certificate.version).toBe(1);
    expect(getPaymentCertificateCreateCallCount()).toBe(1);
    expect(getCachedCertificates(PACKAGE_UUID)).toHaveLength(1);
    expect(getCachedCertificate(PACKAGE_UUID, created.certificate.id).id).toBe(
      created.certificate.id
    );
    expect(localCertificates()).toHaveLength(before);
    expect(listCertificates(ORDER_KEY, baseOrder)[0].id).toBe(created.certificate.id);
  });

  it('authority ON API failure does not fall back to localStorage', async () => {
    authorityEnabled.value = true;
    setPaymentCertificateMutationReject();
    const before = JSON.stringify(localStorage.getItem(LOCAL_STORAGE_KEY));
    const created = await createCertificate(ORDER_KEY, baseOrder);
    expect(created.ok).toBe(false);
    expect(getCachedCertificates(PACKAGE_UUID)).toHaveLength(0);
    expect(JSON.stringify(localStorage.getItem(LOCAL_STORAGE_KEY))).toBe(before);
    expect(listCertificates(ORDER_KEY, baseOrder)).toEqual([]);
  });

  it('authority ON progress PATCH converts positional cells to stable identity', async () => {
    authorityEnabled.value = true;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    const patched = await updateCertificateProgress(
      ORDER_KEY,
      created.certificate.id,
      { '0::0': { thisCertificatePct: 40 } },
      baseOrder
    );
    expect(patched.ok).toBe(true);
    expect(getPaymentCertificatePatchCallCount()).toBe(1);
    const cellId = buildStableCellId('plot-1', 'First Fix');
    expect(patched.certificate.progress[cellId].plotId).toBe('plot-1');
    expect(patched.certificate.progress[cellId].stageKey).toBe('First Fix');
    expect(patched.certificate.progress['0::0']).toBeUndefined();
    expect(patched.certificate.version).toBe(2);
  });

  it('authority ON commercial line PATCH updates cache without localStorage writes', async () => {
    authorityEnabled.value = true;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    const event = seedApprovedVariation();
    const before = JSON.stringify(localStorage.getItem(LOCAL_STORAGE_KEY));
    const patched = await addCommercialLineToCertificate(
      ORDER_KEY,
      created.certificate.id,
      event.id,
      1500,
      baseOrder
    );
    expect(patched.ok).toBe(true);
    expect(patched.certificate.commercialLines).toHaveLength(1);
    expect(patched.certificate.commercialLines[0].amountThisCertificate).toBe(1500);
    expect(JSON.stringify(localStorage.getItem(LOCAL_STORAGE_KEY))).toBe(before);
  });

  it('authority ON submit/reject/approve/delete patch or remove cache', async () => {
    authorityEnabled.value = true;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    const submitted = await submitCertificate(ORDER_KEY, created.certificate.id, baseOrder);
    expect(submitted.ok).toBe(true);
    expect(submitted.certificate.status).toBe('submitted');

    const rejected = await rejectCertificate(
      ORDER_KEY,
      created.certificate.id,
      'Return to draft',
      baseOrder
    );
    expect(rejected.ok).toBe(true);
    expect(rejected.certificate.status).toBe('draft');

    const submittedAgain = await submitCertificate(
      ORDER_KEY,
      created.certificate.id,
      baseOrder
    );
    const approved = await approveCertificate(
      ORDER_KEY,
      created.certificate.id,
      { grossThisCertificate: 99999, netPayment: 88888 },
      baseOrder
    );
    expect(approved.ok).toBe(true);
    expect(approved.certificate.status).toBe('locked');
    expect(approved.certificate.grossValue).not.toBe(99999);
    expect(getCertificate(ORDER_KEY, created.certificate.id, baseOrder).status).toBe('locked');

    const second = await createCertificate(ORDER_KEY, baseOrder);
    const deleted = await deleteCertificate(ORDER_KEY, second.certificate.id, baseOrder);
    expect(deleted.ok).toBe(true);
    expect(getCachedCertificate(PACKAGE_UUID, second.certificate.id)).toBeNull();
    expect(getCachedCertificates(PACKAGE_UUID).map((item) => item.id)).toEqual([
      created.certificate.id,
    ]);
  });

  it('stale PATCH/submit/reject/approve 409 retain latest server state', async () => {
    authorityEnabled.value = true;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    upsertCachedCertificate(PACKAGE_UUID, {
      ...created.certificate,
      version: 1,
    });
    seedMockPaymentCertificate({
      ...created.certificate,
      packageId: PACKAGE_UUID,
      version: 4,
      progress: {
        [buildStableCellId('plot-1', 'First Fix')]: {
          plotId: 'plot-1',
          stageKey: 'First Fix',
          thisCertificatePct: 70,
        },
      },
    });

    const stale = await updateCertificateProgress(
      ORDER_KEY,
      created.certificate.id,
      { '0::0': { thisCertificatePct: 10 } },
      baseOrder
    );
    expect(stale.ok).toBe(false);
    expect(stale.errors[0]).toMatch(/changed elsewhere/i);
    expect(getCachedCertificate(PACKAGE_UUID, created.certificate.id).version).toBe(4);
    expect(
      getCachedCertificate(PACKAGE_UUID, created.certificate.id).progress[
        buildStableCellId('plot-1', 'First Fix')
      ].thisCertificatePct
    ).toBe(70);

    seedMockPaymentCertificate({
      ...created.certificate,
      packageId: PACKAGE_UUID,
      status: 'submitted',
      version: 6,
    });
    upsertCachedCertificate(PACKAGE_UUID, {
      ...created.certificate,
      status: 'submitted',
      version: 5,
    });
    const staleSubmit = await submitCertificate(ORDER_KEY, created.certificate.id, baseOrder);
    expect(staleSubmit.ok).toBe(false);
    expect(staleSubmit.errors[0]).toMatch(/changed elsewhere/i);

    upsertCachedCertificate(PACKAGE_UUID, {
      ...created.certificate,
      status: 'submitted',
      version: 5,
    });
    const staleReject = await rejectCertificate(
      ORDER_KEY,
      created.certificate.id,
      'stale',
      baseOrder
    );
    expect(staleReject.ok).toBe(false);

    upsertCachedCertificate(PACKAGE_UUID, {
      ...created.certificate,
      status: 'submitted',
      version: 5,
    });
    const staleApprove = await approveCertificate(
      ORDER_KEY,
      created.certificate.id,
      {},
      baseOrder
    );
    expect(staleApprove.ok).toBe(false);
    expect(getCachedCertificate(PACKAGE_UUID, created.certificate.id).version).toBe(6);
  });

  it('Developments and Payment Certificates resolve the same server certificate state', async () => {
    authorityEnabled.value = true;
    const created = await createCertificate(ORDER_KEY, baseOrder);
    const fromCertificatesRoute = listCertificates(ORDER_KEY, baseOrder);
    const fromDevelopmentsRoute = listCertificates(ORDER_KEY, {
      ...baseOrder,
      openedFrom: 'developments',
    });
    expect(fromCertificatesRoute).toEqual(fromDevelopmentsRoute);
    expect(fromCertificatesRoute[0].id).toBe(created.certificate.id);
    expect(fromCertificatesRoute[0]).toBe(fromDevelopmentsRoute[0]);
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
  expect(getCommercialEventById(DEV_ID, created.event.id)).toBeTruthy();
  void CERTIFICATE_COMMERCIAL_LINE_TYPES;
  return getCommercialEventById(DEV_ID, created.event.id);
}
