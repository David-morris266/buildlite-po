/**
 * @vitest-environment jsdom
 * BL-028B.3c — Payment Certificates authority-ON hydration + financial safety.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
  canUseCommercialEventsForFinancials: (developmentId) =>
    !authorityEnabled.value || Boolean(developmentId),
}));

vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildApprovedVariationFixture,
  resetCommercialEventApiStore,
  seedMockCommercialEvent,
  setCommercialEventListReject,
} from '../test/mockCommercialEventApi';
import {
  __resetCommercialEventServerCacheForTests,
  ensureCommercialEventsReadyForDevelopment,
} from '../commercialEvents/commercialEventServerCache';
import { deriveCommercialEventsUiState } from '../commercialEvents/useCommercialEventServerHydration';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  buildCertificateWorksTotals,
  summarizeCertificateProgress,
} from '../payments/paymentCertificateProgress';
import { calculateRemainingContractValue } from '../payments/packageCertifiedTotals';
import {
  buildCertificateCommercialLineRows,
  validateCommercialLinesForCertificate,
} from '../payments/certificateCommercialLines';
import { isStaleDraftRecoveryLine, getStaleDraftRecoveryLineApprovalMessage } from '../payments/certificateRecoveryLines';
import { getCommercialEventById } from '../commercialEvents/commercialEventStore';
import {
  approveCertificate,
  createCertificate,
  getCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import { saveOrderMatrix } from '../payments/orderMatrixStore';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import { COMMERCIAL_EVENT_STATUSES } from '../commercialEvents/commercialEventTypes';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY = `${DEV_ID}::sup-1786363489252::5215 — electrical — electrical`;
const CE_0013_ID = 'ce-1786363649246-r6zg6h';
const CE_0019_ID = 'ce-1786452815397-1d9sov';
const CE_0016_ID = 'ce-1786448351364-agfajp';

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1786363489252',
  costCode: '5215 — electrical — electrical',
  supplierLabel: 'Sparktastic Ltd',
  projectLabel: 'Test Site 1',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function seedSparktasticServerEvents() {
  buildApprovedVariationFixture({
    id: CE_0013_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    eventNumber: 'CE-0013',
    eventType: 'salesUpgrade',
    description: 'Elec extras',
    value: 10000,
  });
  buildApprovedVariationFixture({
    id: CE_0016_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    eventNumber: 'CE-0016',
    eventType: 'contraCharge',
    description: 'charge Carpenter',
    value: 2500,
    status: COMMERCIAL_EVENT_STATUSES.closed.key,
  });
  seedMockCommercialEvent({
    id: CE_0019_ID,
    developmentId: DEV_ID,
    orderKey: ORDER_KEY,
    packageId: ORDER_KEY,
    eventNumber: 'CE-0019',
    eventType: 'contraCharge',
    category: 'recovery',
    responsibility: 'subcontractor',
    description: 'Repair works after electrical correction',
    value: -1500,
    financialTreatment: 'recoverableDeduction',
    relationshipType: 'recovery',
    status: COMMERCIAL_EVENT_STATUSES.closed.key,
    recoveryStatus: 'outstanding',
  });
}

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

function seedApprovedCertificatesOneAndTwo() {
  const first = createCertificate(ORDER_KEY, baseOrder);
  submitCertificate(ORDER_KEY, first.certificate.id);
  approveCertificate(ORDER_KEY, first.certificate.id, {
    grossWorksThisCertificate: 12000,
    netPayment: 11400,
  });

  const second = createCertificate(ORDER_KEY, baseOrder);
  submitCertificate(ORDER_KEY, second.certificate.id);
  approveCertificate(ORDER_KEY, second.certificate.id, {
    grossWorksThisCertificate: 12000,
    netPayment: 11400,
  });
}

describe('BL-028B.3c Payment Certificates authority hydration', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetCommercialEventServerCacheForTests();
    resetCommercialEventApiStore();
    localStorage.clear();
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('deriveCommercialEventsUiState shows loading for idle/loading and ready after loaded', () => {
    authorityEnabled.value = true;

    expect(deriveCommercialEventsUiState('idle')).toMatchObject({
      commercialEventsLoading: true,
      commercialEventsReady: false,
    });
    expect(deriveCommercialEventsUiState('loading')).toMatchObject({
      commercialEventsLoading: true,
      commercialEventsReady: false,
    });
    expect(deriveCommercialEventsUiState('loaded')).toMatchObject({
      commercialEventsLoading: false,
      commercialEventsReady: true,
    });
    expect(deriveCommercialEventsUiState('error', 'Failed')).toMatchObject({
      commercialEventsLoading: false,
      commercialEventsReady: false,
      commercialEventsError: 'Failed',
    });
  });

  it('package header stays pending before hydration and populates after hydration', async () => {
    authorityEnabled.value = true;
    seedSparktasticServerEvents();

    const before = buildPackageViewModel(baseOrder);
    expect(before.commercialEventsReady).toBe(false);
    expect(before.currentContractValue).toBeNull();
    expect(before.approvedCommercialMovement).toBeNull();

    await ensureCommercialEventsReadyForDevelopment(DEV_ID);

    const after = buildPackageViewModel(baseOrder);
    expect(after.commercialEventsReady).toBe(true);
    expect(after.approvedCommercialMovement).toBe(12500);
    expect(after.currentContractValue).toBe(112500);
  });

  it('CE-0013 is not classified missing while financial data is still loading', () => {
    authorityEnabled.value = true;
    seedSparktasticServerEvents();

    const cert3 = createCertificate(ORDER_KEY, baseOrder).certificate;
    const commercialLines = [
      {
        id: 'line-ce-0013',
        commercialEventId: CE_0013_ID,
        lineType: 'valueInclusion',
        amountThisCertificate: 6000,
        sourceEventNumber: 'CE-0013',
        sourceEventValue: 10000,
      },
    ];

    const validation = validateCommercialLinesForCertificate({
      orderKey: ORDER_KEY,
      certificateId: cert3.id,
      developmentId: DEV_ID,
      commercialLines,
    });

    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const rows = buildCertificateCommercialLineRows(
      ORDER_KEY,
      { ...cert3, commercialLines },
      DEV_ID
    );
    expect(rows[0].pendingResolution).toBe(true);
    expect(rows[0].missing).toBe(false);
    expect(rows[0].stale).toBe(false);
  });

  it('CE-0013 resolves after hydration and CE-0019 closed recovery remains stale on approval', async () => {
    authorityEnabled.value = true;
    seedSparktasticServerEvents();
    await ensureCommercialEventsReadyForDevelopment(DEV_ID);

    const cert3 = createCertificate(ORDER_KEY, baseOrder).certificate;
    const commercialLines = [
      {
        id: 'line-ce-0013',
        commercialEventId: CE_0013_ID,
        lineType: 'valueInclusion',
        amountThisCertificate: 6000,
        sourceEventNumber: 'CE-0013',
        sourceEventValue: 10000,
      },
      {
        id: 'line-ce-0019',
        commercialEventId: CE_0019_ID,
        lineType: 'recoveryDeduction',
        amountThisCertificate: -1500,
        sourceEventNumber: 'CE-0019',
        sourceEventValue: -1500,
      },
    ];

    const valueValidation = validateCommercialLinesForCertificate({
      orderKey: ORDER_KEY,
      certificateId: cert3.id,
      developmentId: DEV_ID,
      commercialLines: [commercialLines[0]],
    });
    expect(valueValidation.valid).toBe(true);

    const liveRecovery = getCommercialEventById(DEV_ID, CE_0019_ID);
    expect(liveRecovery?.status).toBe(COMMERCIAL_EVENT_STATUSES.closed.key);
    expect(isStaleDraftRecoveryLine(liveRecovery, ORDER_KEY)).toBe(true);
    expect(
      getStaleDraftRecoveryLineApprovalMessage(commercialLines[1], liveRecovery)
    ).toMatch(/Closed/i);
  });

  it('remaining contract is unavailable during CE loading and never uses £0 CCV', () => {
    authorityEnabled.value = true;
    seedSparktasticServerEvents();
    seedApprovedCertificatesOneAndTwo();

    const cert3 = createCertificate(ORDER_KEY, baseOrder).certificate;
    const summaryBefore = summarizeCertificateProgress(ORDER_KEY, cert3.id, baseOrder);

    expect(summaryBefore.totals.currentContractValue).toBeNull();
    expect(summaryBefore.totals.remainingContract).toBeNull();
    expect(summaryBefore.totals.contractValueUnavailable).toBe(true);
    expect(calculateRemainingContractValue(null, 30000)).toBeNull();

    const unsafeTotals = buildCertificateWorksTotals([], {
      commercialLines: [
        {
          lineType: 'valueInclusion',
          amountThisCertificate: 6000,
        },
      ],
      currentContractValue: null,
      previousGrossWorks: 24000,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(unsafeTotals.remainingContract).toBeNull();
    expect(unsafeTotals.remainingContract).not.toBe(-30000);
  });

  it('remaining contract after hydration uses authoritative CCV minus certified-to-date', async () => {
    authorityEnabled.value = true;
    seedSparktasticServerEvents();
    seedApprovedCertificatesOneAndTwo();
    await ensureCommercialEventsReadyForDevelopment(DEV_ID);

    const cert3 = createCertificate(ORDER_KEY, baseOrder).certificate;
    const summary = summarizeCertificateProgress(ORDER_KEY, cert3.id, baseOrder);

    expect(summary.totals.currentContractValue).toBe(112500);
    expect(summary.totals.previousCertified).toBe(24000);
    expect(summary.totals.certifiedToDate).toBe(24000);
    expect(summary.totals.remainingContract).toBe(88500);
  });

  it('API failure surfaces error state without localStorage fallback', async () => {
    authorityEnabled.value = true;
    setCommercialEventListReject(new Error('Commercial Events unavailable'));

    await expect(ensureCommercialEventsReadyForDevelopment(DEV_ID)).rejects.toThrow(
      /Commercial Events unavailable/i
    );

    const ui = deriveCommercialEventsUiState('error', 'Commercial Events unavailable');
    expect(ui.commercialEventsError).toMatch(/Commercial Events unavailable/i);
    expect(ui.commercialEventsReady).toBe(false);

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.commercialEventsReady).toBe(false);
    expect(display.currentPackageValue).toBeNull();
  });

  it('authority OFF local behaviour remains unchanged', () => {
    authorityEnabled.value = false;

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.commercialEventsReady).toBe(true);
    expect(display.currentPackageValue).toBe(100000);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.commercialEventsReady).toBe(true);
    expect(pkg.currentContractValue).toBe(100000);
  });
});
