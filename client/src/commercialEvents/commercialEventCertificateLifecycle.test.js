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
  listCommercialEventsByDevelopment,
  submitCommercialEvent,
} from './commercialEventStore';
import {
  deriveCertificateStatusFromCertification,
  applyValueInclusionLifecycleOnCertificateApproval,
  buildCommercialEventCertificateLifecycleView,
  calculateValueInclusionCertifiedToDate,
  getCommercialEventCertificationPresentation,
  hasCommercialEventCertificationRemaining,
} from './commercialEventCertificateLifecycle';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import { isCommercialEventAwaitingValuation } from '../commercialAssistant/certificateAssistantHelpers';
import {
  buildCertificateRecommendations,
  CERTIFICATE_RULE_ID,
} from '../commercialAssistant/certificateRecommendationProvider';
import { listEligibleCommercialEvents, sumValueInclusionCommercialLines } from '../payments/certificateCommercialLines';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import {
  addCommercialLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  rejectCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';

const DEV_ID = 'dev-bl0254';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

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
    description: 'Scope change',
    value: 10000,
    ...overrides,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return getCommercialEventById(DEV_ID, created.event.id);
}

function createDraftCertificate() {
  const result = createCertificate(ORDER_KEY, baseOrder);
  expect(result.ok).toBe(true);
  return result.certificate;
}

function approveCertWithLine(eventId, amount, totals = {}) {
  const cert = createDraftCertificate();
  addCommercialLineToCertificate(ORDER_KEY, cert.id, eventId, amount, baseOrder);
  submitCertificate(ORDER_KEY, cert.id);
  approveCertificate(ORDER_KEY, cert.id, {
    grossWorksThisCertificate: 20000,
    netPayment: 20000 + amount,
    ...totals,
  });
  return getCertificate(ORDER_KEY, cert.id);
}

describe('BL-025.4 commercial event certificate lifecycle', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    ensurePackageRecord(PACKAGE_B, {
      ...baseOrder,
      orderKey: PACKAGE_B,
      supplierId: 'sup-2',
      costCode: '0200',
      committedValue: 80000,
    });
  });

  it('1. approved CE with no approved cert lines → notIncluded', () => {
    const event = seedApprovedEvent();
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
    );
    expect(
      deriveCertificateStatusFromCertification(
        10000,
        calculateValueInclusionCertifiedToDate(ORDER_KEY, event.id)
      )
    ).toBe(COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key);
  });

  it('2. draft line does not change lifecycle', () => {
    const event = seedApprovedEvent();
    const cert = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
    );
  });

  it('3. submitted line does not change lifecycle', () => {
    const event = seedApprovedEvent();
    const cert = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
    );
  });

  it('4. approved partial line → partiallyIncluded', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 4000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
    );
  });

  it('5. multiple approved certs aggregate correctly', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 4000);
    approveCertWithLine(event.id, 3000);
    expect(calculateValueInclusionCertifiedToDate(ORDER_KEY, event.id)).toBe(7000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
    );
  });

  it('6. full approved amount → fullyIncluded', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 4000);
    approveCertWithLine(event.id, 6000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
  });

  it('7. partial event remains certificate eligible for remaining amount', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 4000);
    const cert2 = createDraftCertificate();
    const eligible = listEligibleCommercialEvents(DEV_ID, ORDER_KEY, cert2);
    expect(eligible.some((item) => item.id === event.id)).toBe(true);
    const view = buildCommercialEventCertificateLifecycleView(
      getCommercialEventById(DEV_ID, event.id),
      ORDER_KEY,
      { excludeCertificateId: cert2.id }
    );
    expect(view.remainingAmount).toBe(6000);
  });

  it('8. fully certified event no longer eligible', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 10000);
    const cert2 = createDraftCertificate();
    expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, cert2)).toHaveLength(0);
  });

  it('9. repeated approval/reconciliation does not double count', () => {
    const event = seedApprovedEvent();
    const cert = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, { netPayment: 24000 });
    const afterFirst = getCommercialEventById(DEV_ID, event.id);
    applyValueInclusionLifecycleOnCertificateApproval({
      developmentId: DEV_ID,
      orderKey: ORDER_KEY,
      certificate: getCertificate(ORDER_KEY, cert.id),
    });
    const afterRepeat = getCommercialEventById(DEV_ID, event.id);
    expect(afterRepeat.certificateStatus).toBe(afterFirst.certificateStatus);
    expect(afterRepeat.auditHistory.length).toBe(afterFirst.auditHistory.length);
    expect(calculateValueInclusionCertifiedToDate(ORDER_KEY, event.id)).toBe(4000);
  });

  it('10. lifecycle audit written once per genuine transition', () => {
    const event = seedApprovedEvent();
    approveCertWithLine(event.id, 4000);
    const updated = getCommercialEventById(DEV_ID, event.id);
    const audits = updated.auditHistory.filter(
      (entry) => entry.action === 'CERTIFICATE_STATUS_CHANGED'
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].priorCertificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
    );
    expect(audits[0].newCertificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
    );
    expect(audits[0].comment).toMatch(/Certified to date/);
  });

  it('11. fully certified event no longer triggers Assistant awaiting-valuation recommendation', () => {
    seedApprovedEvent({ eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key, value: 10000 });
    approveCertWithLine(listCommercialEventsByDevelopment(DEV_ID)[0].id, 10000);
    const recommendations = buildCertificateRecommendations({
      developmentId: DEV_ID,
      packages: [
        {
          orderKey: ORDER_KEY,
          developmentId: DEV_ID,
          supplierId: 'sup-1',
          costCode: '0120',
          supplierLabel: 'Sparktastic',
          committedValue: 100000,
        },
      ],
    });
    expect(
      recommendations.some(
        (item) => item.ruleId === CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation
      )
    ).toBe(false);
  });

  it('12. partially certified event still triggers recommendation for remaining amount', () => {
    const event = seedApprovedEvent({ value: 10000 });
    approveCertWithLine(event.id, 4000);
    expect(
      isCommercialEventAwaitingValuation(getCommercialEventById(DEV_ID, event.id), ORDER_KEY)
    ).toBe(true);
    const recommendations = buildCertificateRecommendations({
      developmentId: DEV_ID,
      packages: [
        {
          orderKey: ORDER_KEY,
          developmentId: DEV_ID,
          supplierId: 'sup-1',
          costCode: '0120',
          supplierLabel: 'Sparktastic',
          committedValue: 100000,
        },
      ],
    });
    expect(
      recommendations.some(
        (item) => item.ruleId === CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation
      )
    ).toBe(true);
  });

  it('13. recovery CE excluded from normal certificate lifecycle', () => {
    const origin = seedApprovedEvent({ value: 7500, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);
    const recovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(getCommercialEventCertificationPresentation(recovery, PACKAGE_B)).toBeNull();
  });

  it('14. BL-026 recoveryStatus unchanged by normal reconciliation', () => {
    const origin = seedApprovedEvent({ value: 7500, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);
    approveCertWithLine(origin.id, 4000);
    const recovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(recovery.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
    );
    expect(recovery.recoveredAmount).toBe(0);
  });

  it('15. origin certification and linked recovery lifecycle remain independent', () => {
    const origin = seedApprovedEvent({
      value: 2500,
      potentialContraCharge: true,
      description: 'Repair damage',
    });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    approveCertWithLine(origin.id, 2500);
    expect(getCommercialEventById(DEV_ID, origin.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
    expect(getCommercialEventById(DEV_ID, linked.recovery.id).recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
    );

    expect(buildPackageCommercialDisplayFields(baseOrder).currentPackageValue).toBe(102500);
    expect(
      buildPackageCommercialDisplayFields({
        ...baseOrder,
        orderKey: PACKAGE_B,
        committedValue: 80000,
      }).currentPackageValue
    ).toBe(80000);
  });

  it('16. sales upgrade works with lifecycle reconciliation', () => {
    const event = seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
      category: 'sales',
      subcategory: 'buyerUpgrade',
      value: 10000,
    });
    approveCertWithLine(event.id, 10000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
  });

  it('17. variation lifecycle reconciliation works', () => {
    const event = seedApprovedEvent({ value: 10000 });
    approveCertWithLine(event.id, 4000);
    expect(
      hasCommercialEventCertificationRemaining(getCommercialEventById(DEV_ID, event.id), ORDER_KEY)
    ).toBe(true);
  });

  it('18. legacy event without certificateStatus loads safely', () => {
    storage.set(
      'buildlite_commercial_events_v1',
      JSON.stringify({
        [DEV_ID]: {
          events: [
            {
              id: 'legacy-ce-1',
              eventNumber: 'CE-0001',
              developmentId: DEV_ID,
              packageId: ORDER_KEY,
              eventType: COMMERCIAL_EVENT_TYPES.variation.key,
              category: 'commercial',
              subcategory: 'scopeChange',
              responsibility: 'commercial',
              description: 'Legacy event',
              value: 1000,
              status: 'approved',
              auditHistory: [],
            },
          ],
        },
      })
    );
    const [legacy] = listCommercialEventsByDevelopment(DEV_ID);
    expect(legacy.certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
    );
    expect(
      deriveCertificateStatusFromCertification(
        1000,
        calculateValueInclusionCertifiedToDate(ORDER_KEY, legacy.id)
      )
    ).toBe(COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key);
  });

  it('19. signed negative certifiable credit behaves correctly', () => {
    const event = seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.credit.key,
      value: -5000,
    });
    approveCertWithLine(event.id, -2000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
    );
    approveCertWithLine(event.id, -3000);
    expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
  });

  it('20. certificate financial totals unchanged by lifecycle reconciliation', () => {
    const event = seedApprovedEvent({ value: 10000 });
    const cert = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    approveCertificate(ORDER_KEY, cert.id, {
      grossWorksThisCertificate: 20000,
      netPayment: 24000,
    });
    const locked = getCertificate(ORDER_KEY, cert.id);
    expect(sumValueInclusionCommercialLines(locked.commercialLines)).toBe(4000);
    expect(calculateValueInclusionCertifiedToDate(ORDER_KEY, event.id)).toBe(4000);
  });

  it('rejected certificate does not count toward certified amount', () => {
    const event = seedApprovedEvent();
    const cert = createDraftCertificate();
    addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);
    submitCertificate(ORDER_KEY, cert.id);
    rejectCertificate(ORDER_KEY, cert.id, 'Rejected for test');
    expect(calculateValueInclusionCertifiedToDate(ORDER_KEY, event.id)).toBe(0);
  });
});

describe('BL-025.4 £10k partial/full worked example', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  it('£4k then £6k across two certificates', () => {
    const event = seedApprovedEvent({ value: 10000, description: 'Approved Variation' });
    approveCertWithLine(event.id, 4000);
    let stored = getCommercialEventById(DEV_ID, event.id);
    expect(stored.certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
    );
    const presentation = getCommercialEventCertificationPresentation(stored, ORDER_KEY);
    expect(presentation.badgeLabel).toBe('Part Certified');
    expect(presentation.remainingAmount).toBe(6000);

    approveCertWithLine(event.id, 6000);
    stored = getCommercialEventById(DEV_ID, event.id);
    expect(stored.certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
    expect(getCommercialEventCertificationPresentation(stored, ORDER_KEY).badgeLabel).toBe(
      'Fully Certified'
    );
  });
});
