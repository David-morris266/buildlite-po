/**
 * @vitest-environment jsdom
 * BL-028B.2 — Certification & recovery overlay hardening tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
  canUseCommercialEventsForFinancials: () => !authorityEnabled.value,
}));

import { saveCompanySettings } from '../admin/companyStore';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  submitCommercialEvent,
  updateRecoveryStatus,
} from './commercialEventStore';
import {
  buildCommercialEventCertificationOverlay,
  getCommercialEventCertificationPresentation,
} from './commercialEventCertificationOverlay';
import {
  applyValueInclusionLifecycleOnCertificateApproval,
} from './commercialEventCertificateLifecycle';
import {
  getCommercialEventRecoveryPresentation,
  resolveCertificateDerivedRecoveredAmount,
} from './commercialEventRecoveryOverlay';
import {
  applyRecoveryDeductionsOnCertificateApproval,
  calculateRecoveryPreviouslyRecovered,
  isRecoveryEligibleForCertificate,
  listEligibleRecoveryEvents,
} from '../payments/certificateRecoveryLines';
import { buildPackageRecoverySummary } from './commercialEventPackageRecoveryKpis';
import {
  listEligibleCommercialEvents,
} from '../payments/certificateCommercialLines';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import { normalizeServerCommercialEvent } from './commercialEventServerMapper';
import { isCommercialEventAwaitingValuation } from '../commercialAssistant/certificateAssistantHelpers';
import {
  buildCertificateRecommendations,
  CERTIFICATE_RULE_ID,
} from '../commercialAssistant/certificateRecommendationProvider';
import {
  addCommercialLineToCertificate,
  addRecoveryLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  rejectCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import { ensurePackageRecord } from '../payments/subcontractPackageStore';

const DEV_ID = 'dev-bl028b2';
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

function seedApprovedRecovery(overrides = {}) {
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

function approveCertWithValueLine(eventId, amount) {
  const cert = createDraftCertificate();
  addCommercialLineToCertificate(ORDER_KEY, cert.id, eventId, amount, baseOrder);
  submitCertificate(ORDER_KEY, cert.id);
  approveCertificate(ORDER_KEY, cert.id, {
    grossWorksThisCertificate: 20000,
    netPayment: 20000 + amount,
  });
  return getCertificate(ORDER_KEY, cert.id);
}

function approveCertWithRecoveryLine(eventId, magnitude) {
  const cert = createDraftCertificate();
  addRecoveryLineToCertificate(ORDER_KEY, cert.id, eventId, magnitude, baseOrder);
  submitCertificate(ORDER_KEY, cert.id);
  approveCertificate(ORDER_KEY, cert.id, {
    grossWorksThisCertificate: 20000,
    netPayment: 20000 - magnitude,
  });
  return getCertificate(ORDER_KEY, cert.id);
}

function asServerEvent(localEvent, metadata = {}) {
  return normalizeServerCommercialEvent({
    ...localEvent,
    packageId: localEvent.packageId,
    orderKey: localEvent.packageId,
    ...metadata,
  });
}

describe('BL-028B.2 certification & recovery overlay', () => {
  beforeEach(() => {
    authorityEnabled.value = false;
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
    });
  });

  describe('certification overlay', () => {
    it('1. zero certified → Not Certified', () => {
      const event = seedApprovedEvent();
      const overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certificateStatus).toBe(
        COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
      );
      expect(getCommercialEventCertificationPresentation(event, ORDER_KEY).badgeLabel).toBe(
        'Not Certified'
      );
    });

    it('2. partial certification', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 4000);
      const overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(4000);
      expect(overlay.remainingToCertify).toBe(6000);
      expect(overlay.certificateStatus).toBe(
        COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
      );
      expect(getCommercialEventCertificationPresentation(event, ORDER_KEY).badgeLabel).toBe(
        'Part Certified'
      );
    });

    it('3. full certification', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 4000);
      approveCertWithValueLine(event.id, 6000);
      const overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(10000);
      expect(overlay.remainingToCertify).toBe(0);
      expect(getCommercialEventCertificationPresentation(event, ORDER_KEY).badgeLabel).toBe(
        'Fully Certified'
      );
    });

    it('4. negative/credit event certification overlay', () => {
      const event = seedApprovedEvent({
        eventType: COMMERCIAL_EVENT_TYPES.credit.key,
        value: -5000,
      });
      approveCertWithValueLine(event.id, -2000);
      const overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(-2000);
      expect(overlay.certificateStatus).toBe(
        COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
      );
    });

    it('5-7. draft/submitted/rejected certs excluded from overlay', () => {
      const event = seedApprovedEvent();
      const cert = createDraftCertificate();
      addCommercialLineToCertificate(ORDER_KEY, cert.id, event.id, 4000, baseOrder);

      let overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(0);

      submitCertificate(ORDER_KEY, cert.id);
      overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(0);

      rejectCertificate(ORDER_KEY, cert.id, 'Not ready');
      overlay = buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY });
      expect(overlay.certifiedToDate).toBe(0);
    });

    it('8. approved cert counted', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 4000);
      expect(
        buildCommercialEventCertificationOverlay({ event, orderKey: ORDER_KEY }).certifiedToDate
      ).toBe(4000);
    });

    it('9. server certificateStatus does not override local history', () => {
      const local = seedApprovedEvent();
      const serverEvent = asServerEvent(local, {
        certificateStatus: COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key,
      });
      const overlay = buildCommercialEventCertificationOverlay({
        event: serverEvent,
        orderKey: ORDER_KEY,
      });
      expect(overlay.certificateStatus).toBe(
        COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key
      );
    });

    it('10. certificate selector remaining value correct', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 4000);
      const cert = createDraftCertificate();
      const eligible = listEligibleCommercialEvents(DEV_ID, ORDER_KEY, cert);
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe(event.id);
    });

    it('11. fully certified event not eligible', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 10000);
      const cert = createDraftCertificate();
      expect(listEligibleCommercialEvents(DEV_ID, ORDER_KEY, cert)).toHaveLength(0);
    });
  });

  describe('recovery overlay', () => {
    it('12. zero recovered', () => {
      const event = seedApprovedRecovery();
      const presentation = getCommercialEventRecoveryPresentation(event, ORDER_KEY);
      expect(presentation.recoveredToDate).toBe(0);
      expect(presentation.remainingRecovery).toBe(7500);
      expect(presentation.certificateDerivedStatus).toBe(
        COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
      );
    });

    it('13. partial recovery', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 3000);
      const presentation = getCommercialEventRecoveryPresentation(event, ORDER_KEY);
      expect(presentation.recoveredToDate).toBe(3000);
      expect(presentation.remainingRecovery).toBe(4500);
      expect(presentation.certificateDerivedStatus).toBe(
        COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key
      );
    });

    it('14. full recovery', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 3000);
      approveCertWithRecoveryLine(event.id, 4500);
      const presentation = getCommercialEventRecoveryPresentation(event, ORDER_KEY);
      expect(presentation.recoveredToDate).toBe(7500);
      expect(presentation.remainingRecovery).toBe(0);
      expect(presentation.certificateDerivedStatus).toBe(
        COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key
      );
    });

    it('15. server recoveredAmount does not double count when authority ON', () => {
      authorityEnabled.value = true;
      const local = seedApprovedRecovery();
      approveCertWithRecoveryLine(local.id, 3000);
      const serverEvent = asServerEvent(local, { recoveredAmount: 7500 });
      const presentation = getCommercialEventRecoveryPresentation(serverEvent, ORDER_KEY);
      expect(presentation.recoveredToDate).toBe(3000);
      expect(presentation.remainingRecovery).toBe(4500);
    });

    it('16. server partiallyRecovered does not override local certificate evidence', () => {
      authorityEnabled.value = true;
      const local = seedApprovedRecovery();
      const serverEvent = asServerEvent(local, {
        recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
        recoveredAmount: 5000,
      });
      const presentation = getCommercialEventRecoveryPresentation(serverEvent, ORDER_KEY);
      expect(presentation.recoveredToDate).toBe(0);
      expect(presentation.remainingRecovery).toBe(7500);
    });

    it('17. recovery deduction selector remaining correct', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 3000);
      const cert = createDraftCertificate();
      const eligible = listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, cert);
      expect(eligible).toHaveLength(1);
      expect(isRecoveryEligibleForCertificate(event, ORDER_KEY)).toBe(true);
    });

    it('18. fully recovered event not eligible', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 7500);
      const cert = createDraftCertificate();
      expect(listEligibleRecoveryEvents(DEV_ID, ORDER_KEY, cert)).toHaveLength(0);
      expect(isRecoveryEligibleForCertificate(event, ORDER_KEY)).toBe(false);
    });

    it('19. recovery KPI uses overlay', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 3000);
      const summary = buildPackageRecoverySummary([event], ORDER_KEY);
      expect(summary.recoveredValue).toBe(3000);
      expect(summary.outstandingRecoveries).toBe(4500);
    });
  });

  describe('assistant & independence', () => {
    it('20. assistant certification recommendation uses overlay', () => {
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 10000);
      const recs = buildCertificateRecommendations(DEV_ID, [
        {
          orderKey: ORDER_KEY,
          supplierLabel: 'Sup',
          costCode: '0120',
          committedValue: 100000,
        },
      ]);
      expect(
        recs.some((rec) => rec.ruleId === CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation)
      ).toBe(false);
      expect(isCommercialEventAwaitingValuation(event, ORDER_KEY)).toBe(false);
    });

    it('21. assistant recovery recommendation uses overlay', () => {
      const event = seedApprovedRecovery();
      approveCertWithRecoveryLine(event.id, 7500);
      const recs = buildCertificateRecommendations(DEV_ID, [
        {
          orderKey: ORDER_KEY,
          supplierLabel: 'Sup',
          costCode: '0120',
          committedValue: 100000,
        },
      ]);
      expect(
        recs.some((rec) => rec.ruleId === CERTIFICATE_RULE_ID.outstandingRecovery)
      ).toBe(false);
    });

    it('22. origin/recovery independence', () => {
      const originDraft = createCommercialEvent(DEV_ID, {
        packageId: PACKAGE_B,
        poNumber: 'S0002',
        supplierId: 'sup-2',
        costCode: '0200',
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        category: 'commercial',
        subcategory: 'scopeChange',
        responsibility: 'commercial',
        description: 'Origin',
        value: 2500,
        potentialContraCharge: true,
      });
      submitCommercialEvent(DEV_ID, originDraft.event.id);
      approveCommercialEvent(DEV_ID, originDraft.event.id);
      const origin = getCommercialEventById(DEV_ID, originDraft.event.id);

      const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
        recoveryPackageId: ORDER_KEY,
      });
      expect(linked.ok).toBe(true);
      submitCommercialEvent(DEV_ID, linked.recovery.id);
      approveCommercialEvent(DEV_ID, linked.recovery.id);

      const originEvent = getCommercialEventById(DEV_ID, origin.id);
      const recoveryEvent = getCommercialEventById(DEV_ID, linked.recovery.id);

      approveCertWithRecoveryLine(recoveryEvent.id, 2500);

      const originOverlay = buildCommercialEventCertificationOverlay({
        event: originEvent,
        orderKey: PACKAGE_B,
      });
      expect(originOverlay.certifiedToDate).toBe(0);

      const recoveryPresentation = getCommercialEventRecoveryPresentation(
        recoveryEvent,
        ORDER_KEY
      );
      expect(recoveryPresentation.recoveredToDate).toBe(2500);
    });
  });

  describe('authority modes', () => {
    it('23. local authority OFF regression — CE store still updated on approval', () => {
      authorityEnabled.value = false;
      const event = seedApprovedEvent();
      approveCertWithValueLine(event.id, 4000);
      expect(getCommercialEventById(DEV_ID, event.id).certificateStatus).toBe(
        COMMERCIAL_EVENT_CERTIFICATE_STATUSES.partiallyIncluded.key
      );
    });

    it('24. server authority ON fixture parity for presentation', () => {
      authorityEnabled.value = true;
      const local = seedApprovedEvent();
      approveCertWithValueLine(local.id, 4000);
      const serverEvent = asServerEvent(local, {
        certificateStatus: COMMERCIAL_EVENT_CERTIFICATE_STATUSES.notIncluded.key,
      });

      const localPresentation = getCommercialEventCertificationPresentation(local, ORDER_KEY);
      const serverPresentation = getCommercialEventCertificationPresentation(
        serverEvent,
        ORDER_KEY
      );
      expect(serverPresentation.badgeLabel).toBe(localPresentation.badgeLabel);
      expect(serverPresentation.certifiedAmount).toBe(4000);
    });

    it('25. certificate approval creates no CE server mutation when authority ON', () => {
      authorityEnabled.value = true;
      const event = seedApprovedEvent();
      const cert = approveCertWithValueLine(event.id, 4000);
      const result = applyValueInclusionLifecycleOnCertificateApproval({
        developmentId: DEV_ID,
        orderKey: ORDER_KEY,
        certificate: cert,
      });
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('server-ce-authority');
    });

    it('26. recovery certificate approval creates no CE mutation when authority ON', () => {
      authorityEnabled.value = true;
      const event = seedApprovedRecovery();
      const cert = approveCertWithRecoveryLine(event.id, 3000);
      const result = applyRecoveryDeductionsOnCertificateApproval({
        developmentId: DEV_ID,
        orderKey: ORDER_KEY,
        certificate: cert,
      });
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('server-ce-authority');
      expect(calculateRecoveryPreviouslyRecovered(ORDER_KEY, event.id)).toBe(3000);
    });
  });

  describe('legacy fallback', () => {
    it('legacy recoveredAmount fallback when authority OFF and no certificate history', () => {
      const event = seedApprovedRecovery();
      updateRecoveryStatus(DEV_ID, event.id, 'partiallyRecovered', {
        recoveredAmount: 2000,
      });
      const updated = getCommercialEventById(DEV_ID, event.id);
      expect(resolveCertificateDerivedRecoveredAmount(updated, ORDER_KEY)).toBe(2000);
    });
  });
});
