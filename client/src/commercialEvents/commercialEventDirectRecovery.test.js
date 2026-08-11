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
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  listCommercialEventsByPackage,
  submitCommercialEvent,
} from './commercialEventStore';
import { COMMERCIAL_EVENT_FINANCIAL_TREATMENTS } from './commercialEventFinancialTreatment';
import { getCommercialEventLinkBadges } from './commercialEventRegisterBadges';
import { buildPackageRecoverySummary } from './commercialEventPackageRecoveryKpis';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import { isCommercialEventCertifiable } from './commercialEventCertifiability';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import { summarizeCertificateProgress } from '../payments/paymentCertificateProgress';
import {
  addCommercialLineToCertificate,
  addRecoveryLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  submitCertificate,
  updateCertificateCellProgress,
} from '../payments/paymentCertificateStore';
import {
  applyRecoveryDeductionsOnCertificateApproval,
  isRecoveryEligibleForCertificate,
  listEligibleRecoveryEvents,
} from '../payments/certificateRecoveryLines';
import { evaluateOutstandingRecoveryCertificateRecommendation } from '../commercialAssistant/certificateRecommendationProvider';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import { saveOrderMatrix } from '../payments/orderMatrixStore';

const DEV_ID = 'dev-sparktastic';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const ORIGIN_PACKAGE = `${DEV_ID}::sup-2::0200`;

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

function baseContraPayload(overrides = {}) {
  return {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
    category: 'recovery',
    subcategory: 'contraCharge',
    responsibility: 'commercial',
    description: 'charge Carpenter',
    ...overrides,
  };
}

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

function approveEvent(eventId) {
  submitCommercialEvent(DEV_ID, eventId);
  return approveCommercialEvent(DEV_ID, eventId).event;
}

function seedApprovedSalesUpgrade(value = 10000) {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
    category: 'commercial',
    subcategory: 'salesUpgrade',
    responsibility: 'commercial',
    description: 'Sales Upgrade',
    value,
  });
  return approveEvent(created.event.id);
}

function seedApprovedDirectRecovery(value = 2500, overrides = {}) {
  const created = createCommercialEvent(
    DEV_ID,
    baseContraPayload({ value, ...overrides })
  );
  return approveEvent(created.event.id);
}

function seedApprovedLinkedRecovery(originValue = 7500) {
  const origin = createCommercialEvent(DEV_ID, {
    packageId: ORIGIN_PACKAGE,
    poNumber: 'S0002',
    supplierId: 'sup-2',
    costCode: '0200',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Origin damage',
    value: originValue,
    potentialContraCharge: true,
  });
  approveEvent(origin.event.id);
  const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.event.id, {
    recoveryPackageId: ORDER_KEY,
  });
  expect(linked.ok).toBe(true);
  approveEvent(linked.recovery.id);
  return {
    origin: getCommercialEventById(DEV_ID, origin.event.id),
    recovery: getCommercialEventById(DEV_ID, linked.recovery.id),
  };
}

function createDraftCertificate() {
  const result = createCertificate(ORDER_KEY, baseOrder);
  expect(result.ok).toBe(true);
  return result.certificate;
}

describe('BL-026.1 direct recoverable contra', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(ORIGIN_PACKAGE, originPackageOrder);
    seedMatrix();
  });

  it('1. new contra charge defaults to recoverable deduction', () => {
    const created = createCommercialEvent(DEV_ID, baseContraPayload({ value: 2500 }));
    expect(created.ok).toBe(true);
    expect(created.event.financialTreatment).toBe(
      COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key
    );
    expect(created.event.relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
  });

  it('2. QS enters +2500; canonical stored value is negative', () => {
    const created = createCommercialEvent(DEV_ID, baseContraPayload({ value: 2500 }));
    expect(created.event.value).toBe(-2500);
  });

  it('3. direct recovery has linkedEventId null', () => {
    const created = createCommercialEvent(DEV_ID, baseContraPayload({ value: 2500 }));
    expect(created.event.linkedEventId).toBeNull();
  });

  it('4–6. direct recovery excluded from CCV; Sparktastic CCV £110k; outstanding £2.5k', () => {
    seedApprovedSalesUpgrade(10000);
    const direct = seedApprovedDirectRecovery(2500);

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.originalPoCommitment).toBe(100000);
    expect(display.approvedCommercialEventMovement).toBe(10000);
    expect(display.currentPackageValue).toBe(110000);

    const recoverySummary = buildPackageRecoverySummary([
      getCommercialEventById(DEV_ID, direct.id),
    ]);
    expect(recoverySummary.outstandingRecoveries).toBe(2500);
    expect(recoverySummary.recoveredValue).toBe(0);
  });

  it('7–8. direct recovery in recovery deductions eligibility, not commercial events', () => {
    const direct = seedApprovedDirectRecovery(2500);
    const event = getCommercialEventById(DEV_ID, direct.id);
    const certificate = createDraftCertificate();

    expect(isCommercialEventCertifiable(event)).toBe(false);
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(1);
    expect(isRecoveryEligibleForCertificate(event)).toBe(true);
  });

  it('9–16. partial and final certificate recovery behaviour', () => {
    seedApprovedSalesUpgrade(10000);
    const direct = seedApprovedDirectRecovery(2500);
    const certificate = createDraftCertificate();
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, direct.id, 1000, baseOrder);

    const draftSummary = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);
    expect(draftSummary.totals.grossWorksThisCertificate).toBe(20000);
    expect(draftSummary.totals.retention).toBe(1000);
    expect(draftSummary.totals.recoveryDeductionMagnitude).toBe(1000);
    expect(draftSummary.totals.netPayment).toBe(18000);

    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, {
      grossWorksThisCertificate: 20000,
      netPayment: 18000,
    });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: getCertificate(ORDER_KEY, certificate.id),
    });

    const afterFirst = getCommercialEventById(DEV_ID, direct.id);
    expect(afterFirst.recoveredAmount).toBe(1000);
    expect(afterFirst.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
    );

    const displayAfter = buildPackageCommercialDisplayFields(baseOrder);
    expect(displayAfter.currentPackageValue).toBe(110000);

    const certificate2 = createDraftCertificate();
    const eligible = listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate2);
    expect(eligible).toHaveLength(1);
    addRecoveryLineToCertificate(ORDER_KEY, certificate2.id, direct.id, 1500, baseOrder);
    submitCertificate(ORDER_KEY, certificate2.id);
    approveCertificate(ORDER_KEY, certificate2.id, { netPayment: 0 });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: getCertificate(ORDER_KEY, certificate2.id),
    });

    const afterFinal = getCommercialEventById(DEV_ID, direct.id);
    expect(afterFinal.recoveredAmount).toBe(2500);
    expect(afterFinal.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
    );
  });

  it('17. fully recovered direct contra no longer eligible', () => {
    const direct = seedApprovedDirectRecovery(2500);
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, direct.id, 2500, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { netPayment: 0 });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: getCertificate(ORDER_KEY, certificate.id),
    });

    const certificate2 = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate2)).toHaveLength(0);
    expect(
      isRecoveryEligibleForCertificate(getCommercialEventById(DEV_ID, direct.id))
    ).toBe(false);
  });

  it('18. linked recovery BL-026 behaviour unchanged', () => {
    const { recovery } = seedApprovedLinkedRecovery(7500);
    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.currentPackageValue).toBe(100000);

    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(1);
    expect(recovery.financialTreatment).toBe(
      COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key
    );
    expect(getCommercialEventLinkBadges(recovery)).toEqual([
      expect.objectContaining({ label: 'Recovery' }),
    ]);
  });

  it('19. legacy unclassified contra without financialTreatment keeps CCV behaviour', () => {
    const legacy = createCommercialEvent(
      DEV_ID,
      baseContraPayload({
        value: 2500,
        linkedEventId: 'legacy-link',
        financialTreatment: undefined,
      })
    );
    expect(legacy.event.relationshipType).not.toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
    approveEvent(legacy.event.id);

    seedApprovedSalesUpgrade(10000);
    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.currentPackageValue).toBe(112500);
  });

  it('20. explicit contract amendment contra follows existing CCV behaviour', () => {
    seedApprovedSalesUpgrade(10000);
    const amendment = createCommercialEvent(
      DEV_ID,
      baseContraPayload({
        value: -2500,
        financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.contractAmendment.key,
      })
    );
    approveEvent(amendment.event.id);

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.currentPackageValue).toBe(107500);

    const certificate = createDraftCertificate();
    expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)).toHaveLength(0);
  });

  it('21. credit remains contract amendment + certifiable', () => {
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
      value: -5000,
    });
    approveEvent(credit.event.id);
    expect(isCommercialEventCertifiable(getCommercialEventById(DEV_ID, credit.event.id))).toBe(
      true
    );
  });

  it('22. negative variation remains contract amendment', () => {
    const variation = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Omission',
      value: -3000,
    });
    approveEvent(variation.event.id);
    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.currentPackageValue).toBe(97000);
  });

  it('23. sales upgrade remains normal positive CE', () => {
    seedApprovedSalesUpgrade(10000);
    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.approvedCommercialEventMovement).toBe(10000);
    expect(display.currentPackageValue).toBe(110000);
  });

  it('24. no automatic migration of legacy stored events on read', () => {
    const legacy = createCommercialEvent(
      DEV_ID,
      baseContraPayload({
        value: 1800,
        linkedEventId: 'keep-me',
      })
    );
    const stored = getCommercialEventById(DEV_ID, legacy.event.id);
    expect(stored.financialTreatment).toBeNull();
    expect(stored.relationshipType).toBeNull();
    expect(stored.linkedEventId).toBe('keep-me');
  });

  it('25. direct recovery audit trail identifies certificate deduction on approval', () => {
    const direct = seedApprovedDirectRecovery(2500);
    const certificate = createDraftCertificate();
    addRecoveryLineToCertificate(ORDER_KEY, certificate.id, direct.id, 1000, baseOrder);
    submitCertificate(ORDER_KEY, certificate.id);
    approveCertificate(ORDER_KEY, certificate.id, { netPayment: 0 });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: getCertificate(ORDER_KEY, certificate.id),
    });

    const updated = getCommercialEventById(DEV_ID, direct.id);
    const audit = updated.auditHistory.find(
      (entry) => entry.action === 'RECOVERY_STATUS_CHANGED'
    );
    expect(audit.comment).toMatch(/Recovery deduction this certificate: £1,000\.00/);
  });

  it('26. assistant recovery refresh continues to work', () => {
    const direct = seedApprovedDirectRecovery(2500);
    const recommendation = evaluateOutstandingRecoveryCertificateRecommendation(
      getCommercialEventById(DEV_ID, direct.id),
      DEV_ID
    );
    expect(recommendation).not.toBeNull();
    expect(recommendation.sourceRecordId).toBe(direct.id);
  });

  it('shows DIRECT RECOVERY badge for direct recoveries', () => {
    const direct = seedApprovedDirectRecovery(2500);
    expect(getCommercialEventLinkBadges(direct)).toEqual([
      expect.objectContaining({ label: 'Direct Recovery' }),
    ]);
  });

  it('approved direct recovery starts outstanding with recoveredAmount zero', () => {
    const direct = seedApprovedDirectRecovery(2500);
    expect(direct.recoveredAmount).toBe(0);
    expect(direct.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
    );
  });
});

describe('BL-026.1 Sparktastic worked example', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
  });

  it('£100k PO + £10k sales upgrade + £2.5k direct recovery => CCV £110k', () => {
    seedApprovedSalesUpgrade(10000);
    seedApprovedDirectRecovery(2500, { description: 'charge Carpenter' });

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.originalOrderValue).toBe(100000);
    expect(pkg.approvedCommercialMovement).toBe(10000);
    expect(pkg.currentContractValue).toBe(110000);
    expect(pkg.recoverySummary.outstandingRecoveries).toBe(2500);
    expect(pkg.recoverySummary.recoveredValue).toBe(0);

    const certificate = createDraftCertificate();
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, certificate)[0].id,
      1000,
      baseOrder
    );

    const summary = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder);
    expect(summary.totals.grossWorksThisCertificate).toBe(20000);
    expect(summary.totals.retention).toBe(1000);
    expect(summary.totals.recoveryDeductionMagnitude).toBe(1000);
    expect(summary.totals.netPayment).toBe(18000);

    const valueLineAttempt = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      listCommercialEventsByPackage(DEV_ID, ORDER_KEY).find(
        (event) => event.eventType === COMMERCIAL_EVENT_TYPES.contraCharge.key
      ).id,
      2500,
      baseOrder
    );
    expect(valueLineAttempt.ok).toBe(false);
  });
});
