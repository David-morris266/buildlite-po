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
  closeCommercialEvent,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { buildPackageRecoverySummary } from '../commercialEvents/commercialEventPackageRecoveryKpis';
import {
  buildPackageCommercialDisplayFields,
} from '../commercialEvents/commercialEventPackageValue';
import { buildPackageViewModel } from './subcontractPackage';
import { summarizeCertificateProgress } from './paymentCertificateProgress';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { calculatePackageCertifiedValue } from '../cvr/cvrCertifiedValue';
import { evaluateOutstandingRecoveryCertificateRecommendation } from '../commercialAssistant/certificateRecommendationProvider';
import {
  addCommercialLineToCertificate,
  addRecoveryLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  rejectCertificate,
  removeCommercialLineFromCertificate,
  removeRecoveryLineFromCertificate,
  submitCertificate,
  updateCertificateCellProgress,
  updateCommercialLineAmount,
  updateRecoveryLineAmount,
} from './paymentCertificateStore';
import {
  applyRecoveryDeductionsOnCertificateApproval,
  buildCertificateRecoveryLineRows,
  buildRecoveryDeductionLineFromEvent,
  calculateRecoveryPreviouslyRecovered,
  getStaleDraftRecoveryLineApprovalMessage,
  getStaleDraftRecoveryLineMessage,
  getRecoveryDeductionEligibilityReason,
  isRecoveryEligibleForCertificate,
  isRecoveryLineUnchanged,
  isStaleDraftRecoveryLine,
  listEligibleRecoveryEvents,
  normalizeRecoveryDeductionAmount,
  validateRecoveryDeductionAmount,
  validateRecoveryLinesForCertificate,
} from './certificateRecoveryLines';
import * as commercialEventStore from '../commercialEvents/commercialEventStore';
import { buildCertificateWorksTotals } from './paymentCertificateProgress';
import { calculatePackageCertifiedGross } from './packageCertifiedTotals';
import { ensurePackageRecord } from './subcontractPackageStore';
import { saveOrderMatrix } from './orderMatrixStore';

const DEV_ID = 'dev-bl026';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;
const ORIGIN_PACKAGE = PACKAGE_B;

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

const originPackageOrder = {
  orderKey: ORIGIN_PACKAGE,
  developmentId: DEV_ID,
  supplierId: 'sup-2',
  costCode: '0200',
  committedValue: 50000,
  pos: [],
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

function seedApprovedOrigin(overrides = {}) {
  const packageId = overrides.packageId || ORIGIN_PACKAGE;
  const draft = createCommercialEvent(DEV_ID, {
    packageId,
    poNumber: packageId === ORDER_KEY ? 'S0001' : 'S0002',
    supplierId: packageId === ORDER_KEY ? 'sup-1' : 'sup-2',
    costCode: packageId === ORDER_KEY ? '0120' : '0200',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Damage to roof trusses',
    value: 7500,
    potentialContraCharge: true,
    ...overrides,
    packageId,
  });
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

function seedApprovedRecovery(
  recoveryPackageId = ORDER_KEY,
  { originPackageId = ORIGIN_PACKAGE, originValue = 7500, description = 'Damage to roof trusses' } = {}
) {
  const origin = seedApprovedOrigin({
    packageId: originPackageId,
    value: originValue,
    description,
  });
  const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
    recoveryPackageId,
  });
  expect(linked.ok).toBe(true);
  submitCommercialEvent(DEV_ID, linked.recovery.id);
  approveCommercialEvent(DEV_ID, linked.recovery.id);
  return getCommercialEventById(DEV_ID, linked.recovery.id);
}

function seedApprovedVariation(overrides = {}) {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Approved Variation',
    value: 10000,
    ...overrides,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return created.event;
}

function createDraftCertificate() {
  const result = createCertificate(ORDER_KEY, baseOrder);
  expect(result.ok).toBe(true);
  return result.certificate;
}

describe('BL-026 certificate recovery deductions', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(ORIGIN_PACKAGE, originPackageOrder);
    seedMatrix();
  });

  it('1. approved linked recovery appears as eligible', () => {
    const recovery = seedApprovedRecovery();
    const certificate = createDraftCertificate();
    const eligible = listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate);
    expect(eligible.some((item) => item.id === recovery.id)).toBe(true);
  });

  it('2. draft recovery excluded from eligibility', () => {
    const origin = seedApprovedOrigin({ packageId: ORIGIN_PACKAGE });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: ORDER_KEY,
    });
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
    expect(isRecoveryEligibleForCertificate(linked.recovery)).toBe(false);
  });

  it('3. submitted/unapproved recovery excluded from eligibility', () => {
    const origin = seedApprovedOrigin({ packageId: ORIGIN_PACKAGE });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: ORDER_KEY,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('4. origin CE excluded from recovery section', () => {
    const origin = seedApprovedOrigin({ packageId: ORIGIN_PACKAGE });
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
    expect(isRecoveryEligibleForCertificate(origin)).toBe(false);
  });

  it('5. ordinary negative credit excluded from recovery section', () => {
    const credit = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.credit.key,
      category: 'commercial',
      subcategory: 'credit',
      responsibility: 'commercial',
      description: 'Credit note',
      value: -2000,
    });
    submitCommercialEvent(DEV_ID, credit.event.id);
    approveCommercialEvent(DEV_ID, credit.event.id);
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('6. recovery on another package excluded', () => {
    const recovery = seedApprovedRecovery(PACKAGE_B, { originPackageId: ORDER_KEY });
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
    expect(recovery.packageId).toBe(PACKAGE_B);
  });

  it('7. add recoveryDeduction line stores signed negative amount', () => {
    const recovery = seedApprovedRecovery();
    const certificate = createDraftCertificate();
    const result = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      3000,
      baseOrder
    );
    expect(result.ok).toBe(true);
    const line = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    expect(line.lineType).toBe('recoveryDeduction');
    expect(line.amountThisCertificate).toBe(-3000);
    expect(line.sourceEventValue).toBe(recovery.value);
  });

  it('8. duplicate recovery line blocked', () => {
    const recovery = seedApprovedRecovery();
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    const duplicate = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1000,
      baseOrder
    );
    expect(duplicate.ok).toBe(false);
  });

  it('9. partial amount allowed', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    const result = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1000,
      baseOrder
    );
    expect(result.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines[0].amountThisCertificate).toBe(
      -1000
    );
  });

  it('10. amount over remaining blocked', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    const result = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      6000,
      baseOrder
    );
    expect(result.ok).toBe(false);
  });

  it('11. previous recovery derived from approved cert lines', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const cert1 = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, cert1.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, { grossWorksThisCertificate: 0, netPayment: -2000 });

    expect(calculateRecoveryPreviouslyRecovered(ORDER_KEY, recovery.id)).toBe(2000);

    const cert2 = createDraftCertificate();
    const eligible = listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, cert2);
    expect(eligible.some((item) => item.id === recovery.id)).toBe(true);
  });

  it('12. draft/submitted cert lines do not count as previously recovered', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const draftCert = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, draftCert.id, recovery.id, 2000, baseOrder);
    expect(calculateRecoveryPreviouslyRecovered(ORDER_KEY, recovery.id)).toBe(0);

    submitCertificate(ORDER_KEY, draftCert.id);
    expect(calculateRecoveryPreviouslyRecovered(ORDER_KEY, recovery.id)).toBe(0);
  });

  it('13. recovery does not alter grossWorksThisCertificate', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [
        { lineType: 'valueInclusion', amountThisCertificate: 4000 },
        { lineType: 'recoveryDeduction', amountThisCertificate: -3000 },
      ],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.grossWorksThisCertificate).toBe(24000);
  });

  it('14. recovery does not alter retention base', () => {
    const withoutRecovery = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      vatRate: 0,
      retentionRate: 0.05,
    });
    const withRecovery = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [
        { lineType: 'valueInclusion', amountThisCertificate: 4000 },
        { lineType: 'recoveryDeduction', amountThisCertificate: -3000 },
      ],
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(withRecovery.retention).toBe(withoutRecovery.retention);
    expect(withRecovery.retention).toBe(1200);
  });

  it('15. recovery certificate deduction does not alter Current Contract Value', () => {
    seedApprovedVariation({ value: 10000 });
    const recovery = seedApprovedRecovery();
    const beforeApproval = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;

    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 3000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, {
      grossWorksThisCertificate: 20000,
      netPayment: 17000,
    }, baseOrder);

    const afterApproval = buildPackageCommercialDisplayFields(baseOrder).currentPackageValue;
    expect(afterApproval).toBe(beforeApproval);
  });

  it('16. recovery reduces Net Payment', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [
        { lineType: 'valueInclusion', amountThisCertificate: 4000 },
        { lineType: 'recoveryDeduction', amountThisCertificate: -3000 },
      ],
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.netPayment).toBeLessThan(24000 - totals.retention);
  });

  it('17. £24k gross / £1.2k retention / £3k recovery = £19.8k net', () => {
    seedApprovedVariation({ value: 10000 });
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [
        { lineType: 'valueInclusion', amountThisCertificate: 4000 },
        { lineType: 'recoveryDeduction', amountThisCertificate: -3000 },
      ],
      currentContractValue: 110000,
      previousGrossWorks: 0,
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.grossWorksThisCertificate).toBe(24000);
    expect(totals.retention).toBe(1200);
    expect(totals.recoveryDeductionMagnitude).toBe(3000);
    expect(totals.netPayment).toBe(19800);
    expect(totals.certifiedToDate).toBe(24000);
    expect(totals.remainingContract).toBe(86000);
  });

  it('18. draft recovery line does not mutate event', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const before = getCommercialEventById(DEV_ID, recovery.id);
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    const after = getCommercialEventById(DEV_ID, recovery.id);
    expect(after.recoveredAmount).toBe(before.recoveredAmount);
    expect(after.recoveryStatus).toBe(before.recoveryStatus);
  });

  it('19. submitted recovery line does not mutate event', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    const after = getCommercialEventById(DEV_ID, recovery.id);
    expect(after.recoveredAmount).toBe(0);
    expect(after.recoveryStatus).toBe(COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key);
  });

  it('20. rejected cert does not mutate recovery', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    rejectCertificate(ORDER_KEY, certificate.id, 'Return for edit');
    const after = getCommercialEventById(DEV_ID, recovery.id);
    expect(after.recoveredAmount).toBe(0);
    expect(after.recoveryStatus).toBe(COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key);
  });

  it('21. approved cert updates recoveredAmount', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, {
      grossWorksThisCertificate: 0,
      netPayment: -2000,
    });
    expect(getCommercialEventById(DEV_ID, recovery.id).recoveredAmount).toBe(2000);
  });

  it('22. partial approval -> partiallyRecovered', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -2000 });
    expect(getCommercialEventById(DEV_ID, recovery.id).recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
    );
  });

  it('23. full cumulative recovery -> fullyRecovered', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 5000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -5000 });
    expect(getCommercialEventById(DEV_ID, recovery.id).recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
    );
  });

  it('24. fully recovered item no longer eligible', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const cert1 = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, cert1.id, recovery.id, 5000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, { grossWorksThisCertificate: 0, netPayment: -5000 });

    const cert2 = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, cert2)).toHaveLength(0);
  });

  it('25. two certificates accumulate recoveredAmount correctly', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });

    const cert1 = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, cert1.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, cert1.id);
    approveCertificate(ORDER_KEY, cert1.id, { grossWorksThisCertificate: 0, netPayment: -2000 });

    const cert2 = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, cert2.id, recovery.id, 3000, baseOrder);
    submitCertificate(ORDER_KEY, cert2.id);
    approveCertificate(ORDER_KEY, cert2.id, { grossWorksThisCertificate: 0, netPayment: -3000 });

    expect(getCommercialEventById(DEV_ID, recovery.id).recoveredAmount).toBe(5000);
  });

  it('26. repeated approval side effects do not double recover', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -2000 });

    const locked = getCertificate(ORDER_KEY, certificate.id);
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: locked,
    });

    expect(getCommercialEventById(DEV_ID, recovery.id).recoveredAmount).toBe(2000);
  });

  it('27. recovery audit records certificate + amount', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -2000 });

    const audit = getCommercialEventById(DEV_ID, recovery.id).auditHistory.filter(
      (entry) => entry.action === 'RECOVERY_STATUS_CHANGED'
    );
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0].comment).toContain('Certificate No.');
    expect(audit[0].comment).toContain('2,000.00');
    expect(audit[0].priorRecoveryStatus).toBeDefined();
    expect(audit[0].newRecoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
    );
  });

  it('28. package Recovery Position updates after approval', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const before = buildPackageRecoverySummary([recovery]);
    expect(before.outstandingRecoveries).toBe(5000);
    expect(before.recoveredValue).toBe(0);

    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -2000 });

    const afterPartial = buildPackageRecoverySummary([
      getCommercialEventById(DEV_ID, recovery.id),
    ]);
    expect(afterPartial.outstandingRecoveries).toBe(3000);
    expect(afterPartial.recoveredValue).toBe(2000);
  });

  it('29. assistant outstanding recovery resolves after full recovery', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    expect(
      evaluateOutstandingRecoveryCertificateRecommendation(recovery, DEV_ID)
    ).not.toBeNull();

    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 5000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { grossWorksThisCertificate: 0, netPayment: -5000 });

    expect(
      evaluateOutstandingRecoveryCertificateRecommendation(
        getCommercialEventById(DEV_ID, recovery.id),
        DEV_ID
      )
    ).toBeNull();
  });

  it('30. legacy cert without recovery lines unchanged', () => {
    const totals = buildCertificateWorksTotals(matrixCells(20000), {
      commercialLines: [{ lineType: 'valueInclusion', amountThisCertificate: 4000 }],
      vatRate: 0,
      retentionRate: 0.05,
    });
    expect(totals.netPayment).toBe(22800);
    expect(totals.recoveryDeductionMagnitude).toBe(0);
  });

  it('31. existing CE valueInclusion behaviour unchanged', () => {
    const event = seedApprovedVariation({ value: 10000 });
    const recovery = seedApprovedRecovery();
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 1000, baseOrder);
    const valueResult = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      event.id,
      4000,
      baseOrder
    );
    expect(valueResult.ok).toBe(true);
    const lines = getCertificate(ORDER_KEY, certificate.id).commercialLines;
    expect(lines.filter((line) => line.lineType === 'valueInclusion')).toHaveLength(1);
    expect(lines.filter((line) => line.lineType === 'recoveryDeduction')).toHaveLength(1);
  });

  it('32. normalizeRecoveryDeductionAmount stores signed negative values', () => {
    expect(normalizeRecoveryDeductionAmount(3000)).toBe(-3000);
    expect(normalizeRecoveryDeductionAmount(-3000)).toBe(-3000);
    expect(buildRecoveryDeductionLineFromEvent({ id: 'e1', value: -7500, eventNumber: 'CE-0020' }, 3000)
      .amountThisCertificate).toBe(-3000);
  });

  it('33. certified gross excludes recovery; CVR net includes recovery deduction', () => {
    seedApprovedVariation({ value: 10000 });
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 3000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, {
      grossWorksThisCertificate: 24000,
      netPayment: 19800,
    });

    expect(calculatePackageCertifiedGross(ORDER_KEY, baseOrder)).toBe(24000);
    expect(calculatePackageCertifiedValue(ORDER_KEY)).toBe(19800);
  });

  it('34. legacy unclassified contra without financialTreatment stays contract amendment', () => {
    const manualContra = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      category: 'recovery',
      subcategory: 'contraCharge',
      responsibility: 'commercial',
      description: 'Manual contra',
      value: -4000,
      linkedEventId: 'legacy-origin-id',
    });
    submitCommercialEvent(DEV_ID, manualContra.event.id);
    approveCommercialEvent(DEV_ID, manualContra.event.id);
    const event = getCommercialEventById(DEV_ID, manualContra.event.id);
    expect(event.relationshipType).not.toBe(COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key);

    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
    expect(isRecoveryEligibleForCertificate(event)).toBe(false);
  });

  it('35. new direct recoverable contra defaults to certificate recovery eligibility', () => {
    const direct = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      category: 'recovery',
      subcategory: 'contraCharge',
      responsibility: 'commercial',
      description: 'Direct recoverable contra',
      value: 2500,
    });
    expect(direct.event.relationshipType).toBe(COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key);
    submitCommercialEvent(DEV_ID, direct.event.id);
    approveCommercialEvent(DEV_ID, direct.event.id);
    const event = getCommercialEventById(DEV_ID, direct.event.id);
    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(1);
    expect(isRecoveryEligibleForCertificate(event)).toBe(true);
  });
});

describe('BL-026 UAT gate — linked recovery excluded from CCV', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(ORIGIN_PACKAGE, originPackageOrder);
    seedMatrix();
  });

  it('worked £100k / £7.5k package and partial certificate recovery', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 7500 });

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.originalPoCommitment).toBe(100000);
    expect(display.approvedCommercialEventMovement).toBe(0);
    expect(display.currentPackageValue).toBe(100000);

    const recoverySummary = buildPackageRecoverySummary([
      getCommercialEventById(DEV_ID, recovery.id),
    ]);
    expect(recoverySummary.outstandingRecoveries).toBe(7500);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.approvedCommercialMovement).toBe(0);
    expect(pkg.currentContractValue).toBe(100000);

    const certificate = createDraftCertificate();
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 3000, baseOrder);

    const draftSummary = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);
    expect(draftSummary.totals.grossWorksThisCertificate).toBe(20000);
    expect(draftSummary.totals.retention).toBe(1000);
    expect(draftSummary.totals.recoveryDeductionMagnitude).toBe(3000);
    expect(draftSummary.totals.netPayment).toBe(16000);

    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(
      ORDER_KEY,
      certificate.id,
      draftSummary.totals,
      baseOrder
    );

    const afterDisplay = buildPackageCommercialDisplayFields(baseOrder);
    expect(afterDisplay.currentPackageValue).toBe(100000);
    expect(afterDisplay.approvedCommercialEventMovement).toBe(0);

    const afterPkg = buildPackageViewModel(baseOrder);
    expect(afterPkg.certifiedGrossToDate).toBe(20000);
    expect(afterPkg.remainingContractValue).toBe(80000);
    expect(afterPkg.currentContractValue).toBe(100000);

    const updatedRecovery = getCommercialEventById(DEV_ID, recovery.id);
    expect(updatedRecovery.recoveredAmount).toBe(3000);
    expect(buildPackageRecoverySummary([updatedRecovery]).outstandingRecoveries).toBe(4500);
  });

  it('full recovery leaves CCV unchanged', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 7500 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 7500, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, {
      grossWorksThisCertificate: 0,
      netPayment: -7500,
    }, baseOrder);

    expect(buildPackageCommercialDisplayFields(baseOrder).currentPackageValue).toBe(100000);
    const updated = getCommercialEventById(DEV_ID, recovery.id);
    expect(updated.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
    );
    expect(buildPackageRecoverySummary([updated]).outstandingRecoveries).toBe(0);
    expect(buildPackageRecoverySummary([updated]).recoveredValue).toBe(7500);
  });

  it('legacy contract amendment contra without recovery relationship still reduces CCV', () => {
    const manual = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      category: 'recovery',
      subcategory: 'contraCharge',
      responsibility: 'commercial',
      description: 'Manual contra',
      value: -4000,
      linkedEventId: 'legacy-origin-ref',
    });
    submitCommercialEvent(DEV_ID, manual.event.id);
    approveCommercialEvent(DEV_ID, manual.event.id);

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.approvedCommercialEventMovement).toBe(-4000);
    expect(display.currentPackageValue).toBe(96000);
  });

  it('positive variation still increases CCV alongside unchanged recovery', () => {
    seedApprovedVariation({ value: 10000 });
    seedApprovedRecovery(undefined, { originValue: 7500 });

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.approvedCommercialEventMovement).toBe(10000);
    expect(display.currentPackageValue).toBe(110000);
  });
});

describe('BL-026 recovery line editing', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(ORIGIN_PACKAGE, originPackageOrder);
    seedMatrix();
  });

  it('allows editing and removing draft recovery lines', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    const line = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];

    const updated = updateRecoveryLineAmount(ORDER_KEY, certificate.id, line.id, 1500, baseOrder);
    expect(updated.ok).toBe(true);
    expect(
      getCertificate(ORDER_KEY, certificate.id).commercialLines[0].amountThisCertificate
    ).toBe(-1500);

    const removed = removeRecoveryLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      line.id,
      baseOrder
    );
    expect(removed.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(0);
  });

  it('validateRecoveryDeductionAmount rejects zero and over-max', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    expect(validateRecoveryDeductionAmount(0, recovery, ORDER_KEY).valid).toBe(false);
    expect(validateRecoveryDeductionAmount(6000, recovery, ORDER_KEY).valid).toBe(false);
    expect(validateRecoveryDeductionAmount(3000, recovery, ORDER_KEY).valid).toBe(true);
  });
});

describe('BL-028B.3 stale draft recovery lines', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(ORIGIN_PACKAGE, originPackageOrder);
    seedMatrix();
  });

  function seedDraftWithStaleClosedRecovery({ recoveryAmount = 1500, variationValue = 10000 } = {}) {
    const recovery = seedApprovedRecovery(undefined, {
      originValue: 7500,
      description: 'Repair works after electrical correction',
    });
    const variation = seedApprovedVariation({
      description: 'Customer electrical extras',
      value: variationValue,
      eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
    });
    const certificate = createDraftCertificate();
    const recoveryAdd = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      recoveryAmount,
      baseOrder
    );
    expect(recoveryAdd.ok).toBe(true);

    const closed = closeCommercialEvent(DEV_ID, recovery.id);
    expect(closed.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, recovery.id).status).toBe(
      COMMERCIAL_EVENT_STATUSES.closed.key
    );

    return { recovery, variation, certificate };
  }

  it('marks an existing draft recovery line stale after the live CE is closed', () => {
    const { recovery, certificate } = seedDraftWithStaleClosedRecovery();
    const rows = buildCertificateRecoveryLineRows(ORDER_KEY, getCertificate(ORDER_KEY, certificate.id), DEV_ID);

    expect(rows).toHaveLength(1);
    expect(rows[0].stale).toBe(true);
    expect(rows[0].staleReason).toMatch(/is now Closed/i);
    expect(isStaleDraftRecoveryLine(getCommercialEventById(DEV_ID, recovery.id), ORDER_KEY)).toBe(true);
  });

  it('does not block adding a valid valueInclusion while an unchanged stale recovery line remains', () => {
    const { variation, certificate } = seedDraftWithStaleClosedRecovery();
    const result = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      variation.id,
      6000,
      baseOrder
    );

    expect(result.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(2);
  });

  it('does not block editing or removing another valid valueInclusion while stale recovery remains', () => {
    const { variation, certificate } = seedDraftWithStaleClosedRecovery();
    const added = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      variation.id,
      6000,
      baseOrder
    );
    expect(added.ok).toBe(true);

    const valueLine = getCertificate(ORDER_KEY, certificate.id).commercialLines.find(
      (line) => line.lineType === 'valueInclusion'
    );

    const edit = updateCommercialLineAmount(
      ORDER_KEY,
      certificate.id,
      valueLine.id,
      5000,
      baseOrder
    );
    expect(edit.ok).toBe(true);

    const removed = removeCommercialLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      valueLine.id,
      baseOrder
    );
    expect(removed.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(1);
  });

  it('allows removing a stale recovery line even after the live CE is closed', () => {
    const { recovery, certificate } = seedDraftWithStaleClosedRecovery();
    const line = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    const removed = removeRecoveryLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      line.id,
      baseOrder
    );

    expect(removed.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(0);
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, getCertificate(ORDER_KEY, certificate.id))).toHaveLength(0);
  });

  it('blocks approval while a stale recovery line remains with a closed-specific message', () => {
    const { certificate } = seedDraftWithStaleClosedRecovery();
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    submitCertificate(ORDER_KEY, certificate.id);

    const approval = approveCertificate(
      ORDER_KEY,
      certificate.id,
      summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals,
      baseOrder
    );

    expect(approval.ok).toBe(false);
    expect(approval.errors.join(' ')).toMatch(/Closed and can no longer be deducted/i);
  });

  it('allows approval after the stale recovery line is removed', () => {
    const { variation, certificate } = seedDraftWithStaleClosedRecovery();
    const recoveryLine = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    removeRecoveryLineFromCertificate(ORDER_KEY, certificate.id, recoveryLine.id, baseOrder);
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, variation.id, 6000, baseOrder);
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);

    submitCertificate(ORDER_KEY, certificate.id);
    const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
    const approval = approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

    expect(approval.ok).toBe(true);
    expect(getCertificate(ORDER_KEY, certificate.id).status).toBe('locked');
  });

  it('excludes closed recoveries from new recovery deduction selection', () => {
    const { recovery, certificate } = seedDraftWithStaleClosedRecovery();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
    expect(isRecoveryEligibleForCertificate(getCommercialEventById(DEV_ID, recovery.id), ORDER_KEY)).toBe(
      false
    );

    const recoveryLine = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    removeRecoveryLineFromCertificate(ORDER_KEY, certificate.id, recoveryLine.id, baseOrder);

    const blocked = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1500,
      baseOrder
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.errors.join(' ')).toMatch(/Closed commercial events cannot be added/i);
  });

  it('preserves draft totals including stale deduction until the line is removed', () => {
    const { certificate } = seedDraftWithStaleClosedRecovery({ recoveryAmount: 1500 });
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);

    const withStale = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);
    expect(withStale.totals.recoveryDeductionMagnitude).toBe(1500);

    const recoveryLine = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    removeRecoveryLineFromCertificate(ORDER_KEY, certificate.id, recoveryLine.id, baseOrder);

    const afterRemove = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);
    expect(afterRemove.totals.recoveryDeductionMagnitude).toBe(0);
  });

  it('does not retrospectively invalidate an already-approved certificate when the CE is later closed', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, recovery.id, 2000, baseOrder);
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 10);
    submitCertificate(ORDER_KEY, certificate.id);
    const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
    approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

    closeCommercialEvent(DEV_ID, recovery.id);

    const locked = getCertificate(ORDER_KEY, certificate.id);
    expect(locked.status).toBe('locked');
    expect(locked.commercialLines.filter((line) => line.lineType === 'recoveryDeduction')).toHaveLength(1);
    expect(getCommercialEventById(DEV_ID, recovery.id).status).toBe(
      COMMERCIAL_EVENT_STATUSES.closed.key
    );
  });

  it('uses authority-aware getCommercialEventById during draft validation', () => {
    const { certificate } = seedDraftWithStaleClosedRecovery();
    const spy = vi.spyOn(commercialEventStore, 'getCommercialEventById');

    validateRecoveryLinesForCertificate({
      orderKey: ORDER_KEY,
      certificateId: certificate.id,
      developmentId: DEV_ID,
      commercialLines: getCertificate(ORDER_KEY, certificate.id).commercialLines,
    });

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('recognises unchanged persisted stale lines via isRecoveryLineUnchanged', () => {
    const { certificate } = seedDraftWithStaleClosedRecovery();
    const persisted = getCertificate(ORDER_KEY, certificate.id).commercialLines[0];
    const liveEvent = getCommercialEventById(DEV_ID, persisted.commercialEventId);

    expect(isRecoveryLineUnchanged(persisted, { ...persisted })).toBe(true);
    expect(getStaleDraftRecoveryLineMessage(persisted, liveEvent)).toMatch(/is now Closed/i);
    expect(getStaleDraftRecoveryLineApprovalMessage(persisted, liveEvent)).toMatch(
      /Remove this recovery line before approving/i
    );
  });

  it('distinguishes workflow closed from recovery lifecycle closed in eligibility messaging', () => {
    const recovery = seedApprovedRecovery(undefined, { originValue: 5000 });
    closeCommercialEvent(DEV_ID, recovery.id);
    expect(getRecoveryDeductionEligibilityReason(getCommercialEventById(DEV_ID, recovery.id))).toMatch(
      /Closed commercial events cannot be added/i
    );

    const lifecycleClosed = {
      ...recovery,
      status: COMMERCIAL_EVENT_STATUSES.approved.key,
      recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key,
    };
    expect(getRecoveryDeductionEligibilityReason(lifecycleClosed)).toMatch(
      /recovery lifecycle is closed/i
    );
  });
});
