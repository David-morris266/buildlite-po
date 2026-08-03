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
  listCommercialEventsByDevelopment,
  listCommercialEventsByPackage,
  rejectCommercialEvent,
  submitCommercialEvent,
  updateCommercialEventDraft,
} from './commercialEventStore';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

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

describe('commercialEventStore', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({
      numberingPrefixes: { commercialEvent: 'CE-' },
    });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('creates a canonical commercial event with CE numbering', () => {
    const result = createCommercialEvent(DEV_ID, basePayload());
    expect(result.ok).toBe(true);
    expect(result.event.eventNumber).toBe('CE-0001');
    expect(result.event.status).toBe(COMMERCIAL_EVENT_STATUSES.draft.key);
    expect(result.event.auditHistory).toHaveLength(1);
    expect(result.event.auditHistory[0].action).toBe('CREATED');
  });

  it('stores signed values on the event record', () => {
    const positive = createCommercialEvent(DEV_ID, basePayload({ value: 2500 }));
    const negative = createCommercialEvent(
      DEV_ID,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        value: -1200,
        description: 'Contra charge',
      })
    );

    expect(positive.event.value).toBe(2500);
    expect(negative.event.value).toBe(-1200);
  });

  it('runs draft → submitted → approved status transitions with audit entries', () => {
    const created = createCommercialEvent(DEV_ID, basePayload());
    const eventId = created.event.id;

    const submitted = submitCommercialEvent(DEV_ID, eventId, {
      actor: 'Reviewer',
      comment: 'Ready for approval',
    });
    expect(submitted.ok).toBe(true);
    expect(submitted.event.status).toBe(COMMERCIAL_EVENT_STATUSES.submitted.key);

    const approved = approveCommercialEvent(DEV_ID, eventId, {
      actor: 'Approver',
      comment: 'Approved',
    });
    expect(approved.ok).toBe(true);
    expect(approved.event.status).toBe(COMMERCIAL_EVENT_STATUSES.approved.key);
    expect(approved.event.auditHistory.length).toBeGreaterThanOrEqual(3);
  });

  it('prevents direct editing after approval', () => {
    const created = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, created.event.id);
    approveCommercialEvent(DEV_ID, created.event.id);

    const update = updateCommercialEventDraft(DEV_ID, created.event.id, {
      description: 'Changed after approval',
    });
    expect(update.ok).toBe(false);
    expect(update.errors[0]).toMatch(/immutable/i);
  });

  it('records reject workflow with comment', () => {
    const created = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, created.event.id);
    const rejected = rejectCommercialEvent(DEV_ID, created.event.id, {
      comment: 'Insufficient detail',
    });

    expect(rejected.ok).toBe(true);
    expect(rejected.event.status).toBe(COMMERCIAL_EVENT_STATUSES.rejected.key);
    const rejectAudit = rejected.event.auditHistory.find(
      (entry) => entry.action === 'REJECTED'
    );
    expect(rejectAudit.comment).toBe('Insufficient detail');
  });

  it('lists events by development and filters by package', () => {
    createCommercialEvent(DEV_ID, basePayload({ packageId: PACKAGE_A }));
    createCommercialEvent(
      DEV_ID,
      basePayload({ packageId: PACKAGE_B, supplierId: 'sup-2', costCode: '0200' })
    );

    expect(listCommercialEventsByDevelopment(DEV_ID)).toHaveLength(2);
    expect(listCommercialEventsByPackage(DEV_ID, PACKAGE_A)).toHaveLength(1);
    expect(listCommercialEventsByPackage(DEV_ID, PACKAGE_B)).toHaveLength(1);
  });

  it('supports linked contra event relationships through linkedEventId', () => {
    const rectifying = createCommercialEvent(
      DEV_ID,
      basePayload({
        packageId: PACKAGE_B,
        supplierId: 'sup-2',
        costCode: '0200',
        value: 3000,
        description: 'Rectification works',
      })
    );

    const contra = createCommercialEvent(
      DEV_ID,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        value: -3000,
        description: 'Contra to responsible contractor',
        linkedEventId: rectifying.event.id,
        recoveryPackageId: PACKAGE_A,
      })
    );

    const stored = getCommercialEventById(DEV_ID, contra.event.id);
    expect(stored.linkedEventId).toBe(rectifying.event.id);
    expect(stored.recoveryPackageId).toBe(PACKAGE_A);
    expect(stored.value).toBe(-3000);
  });

  it('increments event numbers globally across developments', () => {
    createCommercialEvent(DEV_ID, basePayload());
    createCommercialEvent('dev-002', basePayload({ packageId: 'dev-002::sup-1::0100' }));

    const events = [
      ...listCommercialEventsByDevelopment(DEV_ID),
      ...listCommercialEventsByDevelopment('dev-002'),
    ];
    expect(events.map((event) => event.eventNumber)).toEqual(['CE-0001', 'CE-0002']);
  });
});
