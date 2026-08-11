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
  submitCommercialEvent,
} from './commercialEventStore';
import { COMMERCIAL_EVENT_FINANCIAL_TREATMENTS } from './commercialEventFinancialTreatment';
import {
  isCommercialEventCertifiable,
} from './commercialEventCertifiability';
import { getCommercialEventLinkBadges } from './commercialEventRegisterBadges';
import { buildPackageRecoverySummary } from './commercialEventPackageRecoveryKpis';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import {
  canFlagRecoverFromOtherSubcontractor,
} from './commercialEventRecovery';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import { listEligibleCommercialEvents } from '../payments/certificateCommercialLines';
import {
  addCommercialLineToCertificate,
  addRecoveryLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import {
  applyRecoveryDeductionsOnCertificateApproval,
  listEligibleRecoveryEvents,
} from '../payments/certificateRecoveryLines';
import { summarizeCertificateProgress } from '../payments/paymentCertificateProgress';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';
import { saveOrderMatrix } from '../payments/orderMatrixStore';

const DEV_ID = 'dev-bl0262';
const SPARKTASTIC = `${DEV_ID}::sup-1::0120`;
const MUCKY = `${DEV_ID}::sup-2::0200`;

const sparktasticOrder = {
  orderKey: SPARKTASTIC,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

const muckyOrder = {
  orderKey: MUCKY,
  developmentId: DEV_ID,
  supplierId: 'sup-2',
  costCode: '0200',
  committedValue: 80000,
  pos: [{ subtotal: 80000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function seedMatrix(orderKey) {
  saveOrderMatrix(orderKey, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

function approveEvent(eventId) {
  submitCommercialEvent(DEV_ID, eventId);
  return approveCommercialEvent(DEV_ID, eventId).event;
}

function createDraftCertificate(orderKey, order) {
  const result = createCertificate(orderKey, order);
  expect(result.ok).toBe(true);
  return result.certificate;
}

describe('BL-026.2 origin cost vs recovery workflow', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(SPARKTASTIC, sparktasticOrder);
    ensurePackageRecord(MUCKY, muckyOrder);
    seedMatrix(SPARKTASTIC);
    seedMatrix(MUCKY);
  });

  it('1–5. recoverable variation remains variation and certifiable origin', () => {
    const created = createCommercialEvent(DEV_ID, {
      packageId: SPARKTASTIC,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Repair damage caused by plumbing subcontractor',
      value: 2500,
      potentialContraCharge: true,
    });

    expect(created.event.eventType).toBe(COMMERCIAL_EVENT_TYPES.variation.key);
    expect(created.event.relationshipType).not.toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
    expect(created.event.value).toBe(2500);

    const approved = approveEvent(created.event.id);
    expect(isCommercialEventCertifiable(approved)).toBe(true);
    expect(getCommercialEventLinkBadges(approved)).toEqual([
      expect.objectContaining({ label: 'Recovery Pending' }),
    ]);

    const display = buildPackageCommercialDisplayFields(sparktasticOrder);
    expect(display.currentPackageValue).toBe(102500);
  });

  it('6–10. linked recovery is distinct on responsible package', () => {
    const origin = approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: SPARKTASTIC,
        poNumber: 'S0001',
        supplierId: 'sup-1',
        costCode: '0120',
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        category: 'commercial',
        subcategory: 'scopeChange',
        responsibility: 'commercial',
        description: 'Repair damage caused by plumbing subcontractor',
        value: 2500,
        potentialContraCharge: true,
      }).event.id
    );

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: MUCKY,
    });
    expect(linked.ok).toBe(true);
    approveEvent(linked.recovery.id);

    const recovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(recovery.packageId).toBe(MUCKY);
    expect(recovery.relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
    expect(recovery.linkedEventId).toBe(origin.id);

    const muckyDisplay = buildPackageCommercialDisplayFields(muckyOrder);
    expect(muckyDisplay.currentPackageValue).toBe(80000);

    const muckyRecovery = buildPackageRecoverySummary([
      getCommercialEventById(DEV_ID, recovery.id),
    ]);
    expect(muckyRecovery.outstandingRecoveries).toBe(2500);

    const sparkCert = createDraftCertificate(SPARKTASTIC, sparktasticOrder);
    expect(
      listEligibleCommercialEvents(DEV_ID, SPARKTASTIC, sparkCert).some(
        (item) => item.id === origin.id
      )
    ).toBe(true);

    const muckyCert = createDraftCertificate(MUCKY, muckyOrder);
    expect(
      listEligibleCommercialEvents(DEV_ID, MUCKY, muckyCert).some(
        (item) => item.id === recovery.id
      )
    ).toBe(false);
    expect(listEligibleRecoveryEvents(DEV_ID, MUCKY, muckyCert)).toHaveLength(1);
  });

  it('11. origin remains certifiable after recovery linked', () => {
    const origin = approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: SPARKTASTIC,
        poNumber: 'S0001',
        supplierId: 'sup-1',
        costCode: '0120',
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        category: 'commercial',
        subcategory: 'scopeChange',
        responsibility: 'commercial',
        description: 'Repair damage',
        value: 2500,
        potentialContraCharge: true,
      }).event.id
    );
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: MUCKY,
    });
    approveEvent(linked.recovery.id);

    const updatedOrigin = getCommercialEventById(DEV_ID, origin.id);
    expect(updatedOrigin.eventType).toBe(COMMERCIAL_EVENT_TYPES.variation.key);
    expect(isCommercialEventCertifiable(updatedOrigin)).toBe(true);
    expect(getCommercialEventLinkBadges(updatedOrigin)).toEqual([
      expect.objectContaining({ label: 'Recovery Linked' }),
    ]);
  });

  it('12–13. partial and full linked recovery on responsible package', () => {
    const origin = approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: SPARKTASTIC,
        poNumber: 'S0001',
        supplierId: 'sup-1',
        costCode: '0120',
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        category: 'commercial',
        subcategory: 'scopeChange',
        responsibility: 'commercial',
        description: 'Repair damage',
        value: 2500,
        potentialContraCharge: true,
      }).event.id
    );
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: MUCKY,
    });
    approveEvent(linked.recovery.id);

    const cert1 = createDraftCertificate(MUCKY, muckyOrder);
    addRecoveryLineToCertificate(MUCKY, cert1.id, linked.recovery.id, 1000, muckyOrder);
    submitCertificate(MUCKY, cert1.id);
    approveCertificate(MUCKY, cert1.id, { netPayment: 0 });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: MUCKY,
      certificate: getCertificate(MUCKY, cert1.id),
    });

    const partial = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(partial.recoveredAmount).toBe(1000);
    expect(partial.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
    );

    const cert2 = createDraftCertificate(MUCKY, muckyOrder);
    addRecoveryLineToCertificate(MUCKY, cert2.id, linked.recovery.id, 1500, muckyOrder);
    submitCertificate(MUCKY, cert2.id);
    approveCertificate(MUCKY, cert2.id, { netPayment: 0 });
    applyRecoveryDeductionsOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: MUCKY,
      certificate: getCertificate(MUCKY, cert2.id),
    });

    const full = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(full.recoveredAmount).toBe(2500);
    expect(full.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
    );
    expect(buildPackageCommercialDisplayFields(muckyOrder).currentPackageValue).toBe(80000);
  });

  it('14–15. direct recovery without origin still works and excludes CCV', () => {
    const direct = approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: MUCKY,
        poNumber: 'S0002',
        supplierId: 'sup-2',
        costCode: '0200',
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        category: 'recovery',
        subcategory: 'contraCharge',
        responsibility: 'commercial',
        description: 'Replacement materials',
        value: 500,
      }).event.id
    );

    expect(direct.relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
    expect(buildPackageCommercialDisplayFields(muckyOrder).currentPackageValue).toBe(80000);

    const cert = createDraftCertificate(MUCKY, muckyOrder);
    expect(listEligibleRecoveryEvents(DEV_ID, MUCKY, cert)).toHaveLength(1);
  });

  it('16. contract amendment contra still alters CCV', () => {
    approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: MUCKY,
        poNumber: 'S0002',
        supplierId: 'sup-2',
        costCode: '0200',
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        category: 'recovery',
        subcategory: 'contraCharge',
        responsibility: 'commercial',
        description: 'Contract reduction',
        value: -1000,
        financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.contractAmendment.key,
      }).event.id
    );

    expect(buildPackageCommercialDisplayFields(muckyOrder).currentPackageValue).toBe(79000);
  });

  it('contra charge type cannot be flagged recover-from-other', () => {
    expect(
      canFlagRecoverFromOtherSubcontractor({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      })
    ).toBe(false);
    expect(
      canFlagRecoverFromOtherSubcontractor({
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      })
    ).toBe(true);
  });
});

describe('BL-026.2 Sparktastic / Mucky worked example', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(SPARKTASTIC, sparktasticOrder);
    ensurePackageRecord(MUCKY, muckyOrder);
    seedMatrix(SPARKTASTIC);
    seedMatrix(MUCKY);
  });

  it('£100k + £10k sales upgrade + £2.5k recoverable variation; no duplicate CCV', () => {
    approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: SPARKTASTIC,
        poNumber: 'S0001',
        supplierId: 'sup-1',
        costCode: '0120',
        eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
        category: 'sales',
        subcategory: 'buyerUpgrade',
        responsibility: 'commercial',
        description: 'Sales Upgrade',
        value: 10000,
      }).event.id
    );

    const variation = approveEvent(
      createCommercialEvent(DEV_ID, {
        packageId: SPARKTASTIC,
        poNumber: 'S0001',
        supplierId: 'sup-1',
        costCode: '0120',
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        category: 'commercial',
        subcategory: 'scopeChange',
        responsibility: 'commercial',
        description: 'Repair damage caused by plumbing subcontractor',
        value: 2500,
        potentialContraCharge: true,
      }).event.id
    );

    const sparktastic = buildPackageViewModel(sparktasticOrder);
    expect(sparktastic.currentContractValue).toBe(112500);

    const sparkCert = createDraftCertificate(SPARKTASTIC, sparktasticOrder);
    expect(listEligibleCommercialEvents(DEV_ID, SPARKTASTIC, sparkCert)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: variation.id, value: 2500 }),
      ])
    );
    addCommercialLineToCertificate(
      SPARKTASTIC,
      sparkCert.id,
      variation.id,
      2500,
      sparktasticOrder
    );

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, variation.id, {
      recoveryPackageId: MUCKY,
    });
    approveEvent(linked.recovery.id);

    const mucky = buildPackageViewModel(muckyOrder);
    expect(mucky.currentContractValue).toBe(80000);
    expect(mucky.recoverySummary.outstandingRecoveries).toBe(2500);

    const muckyCert = createDraftCertificate(MUCKY, muckyOrder);
    addRecoveryLineToCertificate(MUCKY, muckyCert.id, linked.recovery.id, 2500, muckyOrder);
    const summary = summarizeCertificateProgress(MUCKY, muckyCert.id, muckyOrder);
    expect(summary.totals.recoveryDeductionMagnitude).toBe(2500);

    expect(buildPackageViewModel(sparktasticOrder).currentContractValue).toBe(112500);
    expect(buildPackageViewModel(muckyOrder).currentContractValue).toBe(80000);
  });
});
