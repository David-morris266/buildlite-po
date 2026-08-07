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
  listCommercialEventsByPackage,
  markPotentialContraChargeNotRequired,
  submitCommercialEvent,
  updateCommercialEventDraft,
} from './commercialEventStore';
import {
  buildRecoveryPackageOptions,
} from './commercialEventRecoveryPackages';
import {
  canShowPotentialContraBanner,
  getCommercialEventLinkBadges,
} from './commercialEventRegisterBadges';
import {
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

const DEV_ID = 'dev-001';
const PACKAGE_A = 'dev-001::sup-1::0100';
const PACKAGE_B = 'dev-001::sup-2::0200';

function makeApprovedPo(overrides = {}) {
  return {
    poNumber: overrides.poNumber || 'PO-0001',
    type: 'S',
    approval: { status: 'approved' },
    supplierId: overrides.supplierId || 'sup-1',
    supplierName: overrides.supplierName || 'Supplier One',
    developmentId: DEV_ID,
    costRef: { costCode: overrides.costCode || '0100' },
    subtotal: overrides.subtotal || 50000,
    ...overrides,
  };
}

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
    description: 'Rectification glazing',
    value: 3800,
    ...overrides,
  };
}

describe('BL-021B.2 potential contra charge workflow', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('1. saves Potential Contra Charge flag and notes on draft origin', () => {
    const created = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
        potentialContraChargeNotes: 'Likely brickwork damage',
      })
    );

    expect(created.ok).toBe(true);
    expect(created.event.potentialContraCharge).toBe(true);
    expect(created.event.potentialContraChargeNotes).toBe('Likely brickwork damage');

    const updated = updateCommercialEventDraft(DEV_ID, created.event.id, {
      potentialContraChargeNotes: 'Confirm with site manager',
    });
    expect(updated.ok).toBe(true);
    expect(updated.event.potentialContraChargeNotes).toBe('Confirm with site manager');
  });

  it('2. does not create a recovery event while origin is draft or submitted', () => {
    const draft = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;

    expect(
      listCommercialEventsByDevelopment(DEV_ID).filter(
        (event) => event.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key
      )
    ).toHaveLength(0);

    submitCommercialEvent(DEV_ID, draft.id);
    expect(listCommercialEventsByDevelopment(DEV_ID)).toHaveLength(1);
  });

  it('3. shows create contra action state for approved flagged origin', () => {
    const created = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;
    submitCommercialEvent(DEV_ID, created.id);
    approveCommercialEvent(DEV_ID, created.id);

    const approved = getCommercialEventById(DEV_ID, created.id);
    expect(canShowPotentialContraBanner(approved)).toBe(true);
  });

  it('4. mark not required clears the flag and writes audit history', () => {
    const created = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;
    submitCommercialEvent(DEV_ID, created.id);
    approveCommercialEvent(DEV_ID, created.id);

    const dismissed = markPotentialContraChargeNotRequired(DEV_ID, created.id, {
      comment: 'Employer funded',
    });

    expect(dismissed.ok).toBe(true);
    expect(dismissed.event.potentialContraCharge).toBe(false);
    expect(canShowPotentialContraBanner(dismissed.event)).toBe(false);
    expect(
      dismissed.event.auditHistory.some(
        (entry) => entry.action === 'POTENTIAL_CONTRA_CHARGE_DISMISSED'
      )
    ).toBe(true);
  });

  it('5. package picker excludes the current origin package', () => {
    const pos = [
      makeApprovedPo({ supplierId: 'sup-1', costCode: '0100', poNumber: 'PO-A' }),
      makeApprovedPo({ supplierId: 'sup-2', costCode: '0200', poNumber: 'PO-B', supplierName: 'Supplier Two' }),
    ];

    const options = buildRecoveryPackageOptions(DEV_ID, PACKAGE_A, pos);
    expect(options).toHaveLength(1);
    expect(options[0].orderKey).toBe(PACKAGE_B);
    expect(options[0].poNumbers).toContain('PO-B');
  });

  it('6. creates linked recovery against selected canonical package', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true, value: 3800 })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    expect(linked.ok).toBe(true);
    expect(linked.recovery.packageId).toBe(PACKAGE_B);
    expect(linked.recovery.supplierId).toBe('sup-2');
    expect(linked.recovery.costCode).toBe('0200');
  });

  it('7. stores bidirectional links on origin and recovery', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    expect(linked.origin.linkedEventId).toBe(linked.recovery.id);
    expect(linked.recovery.linkedEventId).toBe(linked.origin.id);
  });

  it('8. opens recovery as editable draft with copied origin content', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
        description: 'Replace damaged glazing',
        value: 3800,
      })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    expect(linked.recovery.status).toBe(COMMERCIAL_EVENT_STATUSES.draft.key);
    expect(linked.recovery.description).toBe('Replace damaged glazing');
    expect(linked.recovery.eventType).toBe(COMMERCIAL_EVENT_TYPES.contraCharge.key);
  });

  it('9. keeps recovery value negative and allows draft edits while negative', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true, value: 3800 })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    expect(linked.recovery.value).toBe(-3800);

    const updated = updateCommercialEventDraft(DEV_ID, linked.recovery.id, {
      value: -3500,
      description: 'Adjusted contra wording',
    });
    expect(updated.ok).toBe(true);
    expect(updated.event.value).toBe(-3500);
    expect(updated.event.description).toBe('Adjusted contra wording');

    const invalid = updateCommercialEventDraft(DEV_ID, linked.recovery.id, {
      value: 3500,
    });
    expect(invalid.ok).toBe(false);
  });

  it('10. does not mutate approved origin commercial fields when linking', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
        description: 'Replace damaged glazing',
        value: 3800,
      })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const before = getCommercialEventById(DEV_ID, origin.id);
    createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    const after = getCommercialEventById(DEV_ID, origin.id);

    expect(after.description).toBe(before.description);
    expect(after.value).toBe(before.value);
    expect(after.status).toBe(COMMERCIAL_EVENT_STATUSES.approved.key);
    expect(after.relationshipType).toBe(COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key);
  });

  it('11. blocks duplicate contra charge creation', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const first = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(first.ok).toBe(true);

    const duplicate = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(duplicate.ok).toBe(false);
  });

  it('12. refreshes both package registers after linked recovery creation', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });

    expect(listCommercialEventsByPackage(DEV_ID, PACKAGE_A)).toHaveLength(1);
    expect(listCommercialEventsByPackage(DEV_ID, PACKAGE_B)).toHaveLength(1);
    expect(getCommercialEventById(DEV_ID, origin.id).relationshipType).toBe(
      COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key
    );
  });

  it('13. leaves normal commercial event workflow unchanged', () => {
    const created = createCommercialEvent(DEV_ID, basePayload({ value: 1200 }));
    submitCommercialEvent(DEV_ID, created.event.id);
    const approved = approveCommercialEvent(DEV_ID, created.event.id);

    expect(approved.ok).toBe(true);
    expect(approved.event.potentialContraCharge).toBe(false);
    expect(approved.event.linkedEventId).toBeNull();
    expect(getCommercialEventLinkBadges(approved.event)).toEqual([]);
  });

  it('14. renders legacy events safely through normalisation', () => {
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
              auditHistory: [],
            },
          ],
        },
      })
    );

    const [legacy] = listCommercialEventsByPackage(DEV_ID, PACKAGE_A);
    expect(legacy.potentialContraCharge).toBe(false);
    expect(getCommercialEventLinkBadges(legacy)).toEqual([]);
    expect(canShowPotentialContraBanner(legacy)).toBe(false);
  });

  it('sets recovery status to outstanding when linked contra is approved', () => {
    const origin = createCommercialEvent(
      DEV_ID,
      basePayload({ potentialContraCharge: true, value: 3800 })
    ).event;
    submitCommercialEvent(DEV_ID, origin.id);
    approveCommercialEvent(DEV_ID, origin.id);

    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    const approved = approveCommercialEvent(DEV_ID, linked.recovery.id);

    expect(approved.event.recoveryStatus).toBe(
      COMMERCIAL_EVENT_RECOVERY_STATUSES.outstanding.key
    );
    expect(listCommercialEventsByPackage(DEV_ID, PACKAGE_B)).toHaveLength(1);
  });
});
