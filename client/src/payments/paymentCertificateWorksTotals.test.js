import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { saveCompanySettings } from '../admin/companyStore';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { COMMERCIAL_EVENT_TYPES } from '../commercialEvents/commercialEventTypes';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  addCommercialLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  submitCertificate,
} from './paymentCertificateStore';
import {
  buildCertificateCommercialTotals,
  buildCertificateWorksTotals,
  buildMatrixOnlyCertificateTotals,
  summarizeCertificateProgress,
} from './paymentCertificateProgress';
import {
  calculatePackageCertifiedGross,
  getApprovedCertificateGrossValue,
} from './packageCertifiedTotals';
import { calculatePackageCertifiedValue } from '../cvr/cvrCertifiedValue';
import { ensurePackageRecord } from './subcontractPackageStore';
import { saveOrderMatrix } from './orderMatrixStore';

const DEV_ID = 'dev-0253';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function matrixCells(grossThis = 0, previous = 0) {
  return [
    {
      thisCertificateValue: grossThis,
      previousValue: previous,
      certifiedToDateValue: previous + grossThis,
    },
  ];
}

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

function seedApprovedEvent(overrides = {}) {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Approved CE',
    value: 10000,
    ...overrides,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return created.event;
}

describe('BL-025.3 certificate works totals', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
  });

  it('1. no commercialLines keeps matrix gross unchanged', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [],
      currentContractValue: 100000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.matrixGrossThisCertificate).toBe(20000);
    expect(totals.commercialEventGrossThisCertificate).toBe(0);
    expect(totals.grossWorksThisCertificate).toBe(20000);
  });

  it('2. +£4k CE line increases gross this certificate by £4k', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [
        {
          lineType: 'valueInclusion',
          amountThisCertificate: 4000,
        },
      ],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.grossWorksThisCertificate).toBe(24000);
  });

  it('3. −£2k credit reduces gross this certificate', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: -2000 }],
      currentContractValue: 108000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.grossWorksThisCertificate).toBe(18000);
  });

  it('4. multiple CE lines sum signed values correctly', () => {
    const totals = buildCertificateWorksTotals(matrixCells(10000), {
      commercialLines: [
        { lineType: 'valueInclusion', amountThisCertificate: 4000 },
        { lineType: 'valueInclusion', amountThisCertificate: -2000 },
      ],
      currentContractValue: 102000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.commercialEventGrossThisCertificate).toBe(2000);
    expect(totals.grossWorksThisCertificate).toBe(12000);
  });

  it('5. matrix £20k + CE £4k = gross £24k', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.grossWorksThisCertificate).toBe(24000);
  });

  it('6. PO £100k + approved CE £10k = current contract £110k', () => {
    seedApprovedEvent({ value: 10000 });
    expect(buildPackageCommercialDisplayFields(baseOrder).currentPackageValue).toBe(110000);
  });

  it('7. worked example remaining contract = £86k', () => {
    seedApprovedEvent({ value: 10000 });
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.certifiedToDate).toBe(24000);
    expect(totals.remainingContract).toBe(86000);
    expect(totals.retention).toBe(1200);
    expect(totals.vat).toBe(0);
    expect(totals.netPayment).toBe(22800);
  });

  it('8. previously approved CE line contributes to previous certified', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert1 = createCertificate(ORDER_KEY, baseOrder).certificate;
    addCommercialLineToCertificate(ORDER_KEY, cert1.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });

    const cert2 = createCertificate(ORDER_KEY, baseOrder).certificate;
    const summary = summarizeCertificateProgress(ORDER_KEY, cert2.id, baseOrder);
    expect(summary.totals.previousCertified).toBe(24000);
  });

  it('9. draft/submitted CE lines do not contribute to previous certified', () => {
    const event = seedApprovedEvent({ value: 5000 });
    const draftCert = createCertificate(ORDER_KEY, baseOrder).certificate;
    addCommercialLineToCertificate(ORDER_KEY, draftCert.id, event.id, 3000, baseOrder);
    const draftSummary = summarizeCertificateProgress(ORDER_KEY, draftCert.id, baseOrder);
    expect(draftSummary.totals.previousCertified).toBe(0);
    expect(draftSummary.totals.commercialEventGrossThisCertificate).toBe(3000);

    submitCertificate(ORDER_KEY, draftCert.id);
    const submittedSummary = summarizeCertificateProgress(ORDER_KEY, draftCert.id, baseOrder);
    expect(submittedSummary.totals.previousCertified).toBe(0);
  });

  it('10. current draft line is not double-counted in certified to date', () => {
    seedApprovedEvent({ value: 10000 });
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    const event = seedApprovedEvent({ value: 5000, description: 'Second' });
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    const summary = summarizeCertificateProgress(ORDER_KEY, cert.id, {
      ...baseOrder,
      pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
    });
    expect(summary.totals.commercialEventGrossThisCertificate).toBe(4000);
    expect(summary.totals.certifiedToDate).toBe(summary.totals.grossWorksThisCertificate);
  });

  it('11. retention applies to combined gross', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.retention).toBe(1200);
  });

  it('12. credit reduces retention base', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: -2000 }],
      currentContractValue: 108000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.retention).toBe(900);
  });

  it('13. VAT uses combined gross minus retention', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0.2,
      retentionRate: 0.05,
    });
    expect(totals.vat).toBe(4560);
  });

  it('14. net payment uses combined gross', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.netPayment).toBe(22800);
  });

  it('15. approved certificate persists combined grossValue', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(getCertificate(ORDER_KEY, cert.id).grossValue).toBe(24000);
  });

  it('16. approved certificate persists combined netValue', () => {
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(getCertificate(ORDER_KEY, cert.id).netValue).toBe(22800);
  });

  it('17. legacy approved certificate without lines remains valid', () => {
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossThisCertificate: 15000,
      netPayment: 17100,
    });
    expect(getApprovedCertificateGrossValue(getCertificate(ORDER_KEY, cert.id))).toBe(15000);
  });

  it('18. package certified gross picks up combined gross once approved', () => {
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBe(24000);
  });

  it('19. CE certificateStatus remains unchanged after approval', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe('notIncluded');
  });

  it('20. recovery fields remain unchanged', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(getCommercialEventById(DEV_ID, event.id).recoveryStatus).toBe('notApplicable');
    expect(getCommercialEventById(DEV_ID, event.id).recoveredAmount).toBe(0);
  });

  it('21. buildCertificateCommercialTotals remains matrix-only', () => {
    const matrixTotals = buildCertificateCommercialTotals(matrixCells(20000), 100000, {
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(matrixTotals.grossThisCertificate).toBe(20000);
    expect(buildMatrixOnlyCertificateTotals(matrixCells(20000), 100000).grossThisCertificate).toBe(
      20000
    );
  });

  it('22. order committed value remains unchanged', () => {
    seedApprovedEvent({ value: 10000 });
    expect(buildPackageCommercialDisplayFields(baseOrder).originalPoCommitment).toBe(100000);
  });

  it('23. current contract value remains CE-aware from BL-025.1', () => {
    seedApprovedEvent({ value: 10000 });
    expect(buildPackageCommercialDisplayFields(baseOrder).currentPackageValue).toBe(110000);
  });

  it('24. over-certification is not silently hidden', () => {
    const totals = buildCertificateWorksTotals(matrixCells(90000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 30000 }],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.overCertified).toBe(true);
    expect(totals.remainingContract).toBeLessThan(0);
  });

  it('25. CVR certified helper reads approved netValue including CE valuation', () => {
    const cert = createCertificate(ORDER_KEY, baseOrder).certificate;
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 24000,
      grossThisCertificate: 24000,
      netPayment: 22800,
    });
    expect(calculatePackageCertifiedValue(ORDER_KEY)).toBe(22800);
  });
});
