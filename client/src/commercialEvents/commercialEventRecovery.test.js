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
  markPotentialContraChargeNotRequired,
  submitCommercialEvent,
  updateRecoveryStatus,
} from './commercialEventStore';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import {
  getLinkedCommercialEvent,
  hasLinkedRecovery,
  isRecoveryOutstanding,
} from './commercialEventRecovery';

const DEV_ID = 'dev-001';
const PACKAGE_A = 'dev-001::sup-1::0100';
const PACKAGE_B = 'dev-001::sup-2::0200';

function basePayload(overrides = {}) {
  return {
    packageId: PACKAGE_A,
    poNumber: 'PO-000001',
    supplierId: 'sup-1',
    costCode: '0100',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Additional scope',
    value: 5000,
    ...overrides,
  };
}

function createApprovedOrigin(overrides = {}) {
  const created = createCommercialEvent(
    DEV_ID,
    basePayload({
      potentialContraCharge: true,
      potentialContraChargeNotes: 'Likely recover from brickwork',
      ...overrides,
    })
  );
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return getCommercialEventById(DEV_ID, created.event.id);
}

describe('BL-021B.1 commercial event foundation', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({
      numberingPrefixes: { commercialEvent: 'CE-' },
    });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('persists BL-021B.1 model extensions on create', () => {
    const result = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
        potentialContraChargeNotes: 'Check supplier responsibility',
        relationshipType: null,
        recoveredAmount: 0,
        certificateStatus: COMMERCIAL_EVENT_CERTIFICATE_STATUSES.pendingInclusion.key,
        recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key,
      })
    );

    expect(result.ok).toBe(true);
    expect(result.event.potentialContraCharge).toBe(true);
    expect(result.event.potentialContraChargeNotes).toBe('Check supplier responsibility');
    expect(result.event.relationshipType).toBeNull();
    expect(result.event.recoveredAmount).toBe(0);
    expect(result.event.certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.pendingInclusion.key
    );
    expect(result.event.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key
    );
  });

  it('creates a linked recovery from an approved origin with bidirectional links', () => {
    const origin = createApprovedOrigin({ value: 3800, description: 'Replace glazing' });

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
      comment: 'Raise contra on brickwork',
    });

    expect(linked.ok).toBe(true);
    expect(linked.origin.relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key
    );
    expect(linked.origin.linkedEventId).toBe(linked.recovery.id);
    expect(linked.origin.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key
    );
    expect(linked.recovery.relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
    );
    expect(linked.recovery.linkedEventId).toBe(origin.id);
    expect(linked.recovery.packageId).toBe(PACKAGE_B);
    expect(linked.recovery.eventType).toBe(COMMERCIAL_EVENT_TYPES.contraCharge.key);
    expect(linked.recovery.value).toBe(-3800);
    expect(linked.recovery.description).toBe('Replace glazing');
    expect(linked.recovery.responsibility).toBe('subcontractor');
    expect(linked.recovery.status).toBe(COMMERCIAL_EVENT_STATUSES.draft.key);

    const originAudit = linked.origin.auditHistory.find(
      (entry) => entry.action === 'LINKED_RECOVERY_CREATED'
    );
    expect(originAudit).toBeTruthy();

    const recoveryAudit = linked.recovery.auditHistory.find(
      (entry) => entry.action === 'LINKED_TO_ORIGIN'
    );
    expect(recoveryAudit).toBeTruthy();
  });

  it('sets recovery status to outstanding when a linked recovery is approved', () => {
    const origin = createApprovedOrigin({ value: 2500 });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    submitCommercialEvent(DEV_ID, linked.recovery.id);
    const approved = approveCommercialEvent(DEV_ID, linked.recovery.id);

    expect(approved.ok).toBe(true);
    expect(approved.event.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
    );
  });

  it('prevents self-linking and duplicate linked recoveries', () => {
    const origin = createApprovedOrigin();

    const selfLink = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_A,
    });
    expect(selfLink.ok).toBe(false);
    expect(selfLink.errors[0]).toMatch(/same as the origin package/i);

    const firstLink = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(firstLink.ok).toBe(true);

    const duplicate = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors[0]).toMatch(/already has a linked recovery/i);
  });

  it('rejects linked recovery creation unless origin is approved and flagged', () => {
    const draft = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;

    const fromDraft = createLinkedRecoveryFromOrigin(DEV_ID, draft.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(fromDraft.ok).toBe(false);
    expect(fromDraft.errors[0]).toMatch(/must be approved/i);

    const approvedUnflagged = createApprovedOrigin({ potentialContraCharge: false });
    const unflagged = createLinkedRecoveryFromOrigin(DEV_ID, approvedUnflagged.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(unflagged.ok).toBe(false);
    expect(unflagged.errors[0]).toMatch(/potential contra charge/i);
  });

  it('runs recovery status lifecycle updates with audit history', () => {
    const origin = createApprovedOrigin({ value: 4000 });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const included = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.includedInCertificate.key,
      { comment: 'Added to certificate 3' }
    );
    expect(included.ok).toBe(true);

    const partial = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 1500, comment: 'Part payment received' }
    );
    expect(partial.ok).toBe(true);
    expect(partial.event.recoveredAmount).toBe(1500);

    const full = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
      { recoveredAmount: 4000 }
    );
    expect(full.ok).toBe(true);
    expect(full.event.recoveredAmount).toBe(4000);

    const closed = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key
    );
    expect(closed.ok).toBe(true);

    const audit = closed.event.auditHistory.filter(
      (entry) => entry.action === 'RECOVERY_STATUS_CHANGED'
    );
    expect(audit.length).toBeGreaterThanOrEqual(3);
    expect(audit[0].priorRecoveryStatus).toBeDefined();
    expect(audit[0].newRecoveryStatus).toBeDefined();
  });

  it('validates partial and full recovered amounts', () => {
    const origin = createApprovedOrigin({ value: 3000 });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const invalidPartial = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 3000 }
    );
    expect(invalidPartial.ok).toBe(false);

    const invalidFull = updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
      { recoveredAmount: 1000 }
    );
    expect(invalidFull.ok).toBe(false);
  });

  it('dismisses potential contra charge when recovery is not required', () => {
    const origin = createApprovedOrigin();
    const dismissed = markPotentialContraChargeNotRequired(DEV_ID, origin.id, {
      comment: 'Employer funded',
    });

    expect(dismissed.ok).toBe(true);
    expect(dismissed.event.potentialContraCharge).toBe(false);
    expect(dismissed.event.potentialContraChargeNotes).toBe('');

    const audit = dismissed.event.auditHistory.find(
      (entry) => entry.action === 'POTENTIAL_CONTRA_CHARGE_DISMISSED'
    );
    expect(audit).toBeTruthy();
    expect(audit.comment).toBe('Employer funded');
  });

  it('exposes linked recovery query helpers', () => {
    const origin = createApprovedOrigin({ value: 1200 });
    expect(hasLinkedRecovery(origin)).toBe(false);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(hasLinkedRecovery(linked.origin)).toBe(true);
    expect(getLinkedCommercialEvent(DEV_ID, linked.origin)?.id).toBe(linked.recovery.id);
    expect(getLinkedCommercialEvent(DEV_ID, linked.recovery)?.id).toBe(linked.origin.id);

    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);
    const approvedRecovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    expect(isRecoveryOutstanding(approvedRecovery)).toBe(true);
  });

  it('normalises legacy BL-021A events without BL-021B.1 fields', () => {
    storage.set(
      'buildlite_commercial_events_v1',
      JSON.stringify({
        [DEV_ID]: {
          events: [
            {
              id: 'legacy-ce-1',
              eventNumber: 'CE-0001',
              developmentId: DEV_ID,
              packageId: PACKAGE_A,
              eventType: COMMERCIAL_EVENT_TYPES.variation.key,
              category: 'commercial',
              subcategory: 'scopeChange',
              responsibility: 'commercial',
              description: 'Legacy event',
              value: 1000,
              status: COMMERCIAL_EVENT_STATUSES.approved.key,
              linkedEventId: null,
              recoveryPackageId: null,
              certificateStatus: COMMERCIAL_EVENT_CERTIFICATE_STATUSES.included.key,
              recoveryStatus: COMMERCIAL_EVENT_RECOVERY_STATUSES.pending.key,
              auditHistory: [],
            },
          ],
        },
      })
    );

    const [legacy] = listCommercialEventsByDevelopment(DEV_ID);
    expect(legacy.potentialContraCharge).toBe(false);
    expect(legacy.potentialContraChargeNotes).toBe('');
    expect(legacy.relationshipType).toBeNull();
    expect(legacy.recoveredAmount).toBe(0);
    expect(legacy.certificateStatus).toBe(
      COMMERCIAL_EVENT_CERTIFICATE_STATUSES.fullyIncluded.key
    );
    expect(legacy.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.notApplicable.key
    );
  });

  it('preserves legacy linkedEventId records created before relationship types', () => {
    const rectifying = createCommercialEvent(
      DEV_ID,
      basePayload({
        packageId: PACKAGE_B,
        supplierId: 'sup-2',
        costCode: '0200',
        value: 3000,
      })
    );

    const contra = createCommercialEvent(
      DEV_ID,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        value: -3000,
        linkedEventId: rectifying.event.id,
        recoveryPackageId: PACKAGE_A,
      })
    );

    expect(hasLinkedRecovery(contra.event)).toBe(true);
    expect(getLinkedCommercialEvent(DEV_ID, contra.event)?.id).toBe(rectifying.event.id);
  });
});
