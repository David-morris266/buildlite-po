/**
 * @vitest-environment jsdom
 * BL-028B.3 — Server CE authority cutover tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));
const apiMocks = vi.hoisted(() => ({
  createCommercialEvent: vi.fn(),
  updateCommercialEvent: vi.fn(),
  submitCommercialEvent: vi.fn(),
  approveCommercialEvent: vi.fn(),
  rejectCommercialEvent: vi.fn(),
  closeCommercialEvent: vi.fn(),
  dismissPotentialContra: vi.fn(),
  createLinkedRecovery: vi.fn(),
  listCommercialEvents: vi.fn(),
}));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => authorityEnabled.value,
  canUseCommercialEventsForFinancials: (developmentId) =>
    !authorityEnabled.value || Boolean(developmentId),
}));

vi.mock('../api/commercialEvents', () => ({
  CommercialEventApiError: class CommercialEventApiError extends Error {
    constructor(message, { status = 0, body = null } = {}) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  listCommercialEvents: (...args) => apiMocks.listCommercialEvents(...args),
  createCommercialEvent: (...args) => apiMocks.createCommercialEvent(...args),
  updateCommercialEvent: (...args) => apiMocks.updateCommercialEvent(...args),
  submitCommercialEvent: (...args) => apiMocks.submitCommercialEvent(...args),
  approveCommercialEvent: (...args) => apiMocks.approveCommercialEvent(...args),
  rejectCommercialEvent: (...args) => apiMocks.rejectCommercialEvent(...args),
  closeCommercialEvent: (...args) => apiMocks.closeCommercialEvent(...args),
  dismissPotentialContra: (...args) => apiMocks.dismissPotentialContra(...args),
  createLinkedRecovery: (...args) => apiMocks.createLinkedRecovery(...args),
}));

import {
  COMMERCIAL_EVENTS_STORAGE_KEY,
  clearCommercialEventsStore,
  approveCommercialEvent,
  closeCommercialEvent,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  listCommercialEventsByDevelopment,
  markPotentialContraChargeNotRequired,
  rejectCommercialEvent,
  submitCommercialEvent,
  updateCommercialEventCertificateStatus,
  updateCommercialEventDraft,
} from './commercialEventStore';
import {
  __resetCommercialEventServerCacheForTests,
  listCachedCommercialEventsByDevelopment,
  patchCachedCommercialEvent,
} from './commercialEventServerCache';
import {
  exportTestSite1CommercialEventsFromLocalStorage,
  validateCommercialEventRelationshipIntegrity,
} from './commercialEventExportImport';
import { VERSION_CONFLICT_MESSAGE } from './commercialEventServerMutations';
import { CommercialEventApiError } from '../api/commercialEvents';

const DEV_ID = 'dev-bl028b3';
const ORDER_KEY = `${DEV_ID}::sup-1::0120`;

function seedLocalEvent() {
  storage.set(
    COMMERCIAL_EVENTS_STORAGE_KEY,
    JSON.stringify({
      [DEV_ID]: {
        events: [
          {
            id: 'ce-local-1',
            eventNumber: 'CE-0099',
            developmentId: DEV_ID,
            packageId: ORDER_KEY,
            eventType: 'variation',
            category: 'commercial',
            subcategory: 'scopeChange',
            responsibility: 'commercial',
            description: 'Local only',
            value: 1000,
            status: 'draft',
            version: 1,
            auditHistory: [],
          },
        ],
      },
    })
  );
}

function serverDocument(overrides = {}) {
  return {
    id: 'ce-server-1',
    eventNumber: 'CE-0100',
    developmentId: DEV_ID,
    packageId: ORDER_KEY,
    orderKey: ORDER_KEY,
    eventType: 'variation',
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Server event',
    value: 5000,
    status: 'draft',
    version: 1,
    certificateStatus: 'notIncluded',
    recoveryStatus: 'notApplicable',
    recoveredAmount: 0,
    auditHistory: [],
    ...overrides,
  };
}

describe('BL-028B.3 server CE authority cutover', () => {
  beforeEach(() => {
    authorityEnabled.value = false;
    storage.clear();
    clearCommercialEventsStore();
    __resetCommercialEventServerCacheForTests();
    Object.values(apiMocks).forEach((mock) => mock.mockReset());
    localStorage.setItem('userName', 'Test QS');
  });

  it('reads from server cache when authority ON', () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(DEV_ID, serverDocument());

    expect(listCommercialEventsByDevelopment(DEV_ID)).toHaveLength(1);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.eventNumber).toBe('CE-0100');
    expect(listCachedCommercialEventsByDevelopment(DEV_ID)[0].packageId).toBe(ORDER_KEY);
  });

  it('does not read localStorage fallback when authority ON', () => {
    authorityEnabled.value = true;
    seedLocalEvent();

    expect(listCommercialEventsByDevelopment(DEV_ID)).toHaveLength(0);
  });

  it('does not write localStorage on create when authority ON', async () => {
    authorityEnabled.value = true;
    apiMocks.createCommercialEvent.mockResolvedValue(serverDocument());

    const result = await createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      eventType: 'variation',
      category: 'commercial',
      responsibility: 'commercial',
      description: 'New',
      value: 2500,
    });

    expect(result.ok).toBe(true);
    expect(JSON.parse(storage.get(COMMERCIAL_EVENTS_STORAGE_KEY) || '{}')[DEV_ID]).toBeUndefined();
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')).not.toBeNull();
    expect(apiMocks.createCommercialEvent).toHaveBeenCalledTimes(1);
  });

  it('patches cache after edit and surfaces version conflict', async () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(DEV_ID, serverDocument());

    apiMocks.updateCommercialEvent.mockResolvedValue(
      serverDocument({ description: 'Updated', version: 2 })
    );

    const updated = await updateCommercialEventDraft(DEV_ID, 'ce-server-1', {
      description: 'Updated',
    });
    expect(updated.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.description).toBe('Updated');

    apiMocks.updateCommercialEvent.mockRejectedValue(
      new CommercialEventApiError('Commercial event version conflict.', { status: 409 })
    );

    const conflict = await updateCommercialEventDraft(DEV_ID, 'ce-server-1', {
      description: 'Stale',
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.errors[0]).toBe(VERSION_CONFLICT_MESSAGE);
  });

  it('updates cache on submit workflow action', async () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(DEV_ID, serverDocument());
    apiMocks.submitCommercialEvent.mockResolvedValue(
      serverDocument({ status: 'submitted', version: 2 })
    );

    const result = await submitCommercialEvent(DEV_ID, 'ce-server-1');
    expect(result.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.status).toBe('submitted');
  });

  it('export tooling preserves raw local events without deletion', () => {
    seedLocalEvent();
    const payload = exportTestSite1CommercialEventsFromLocalStorage(DEV_ID);

    expect(payload.eventCount).toBe(1);
    expect(payload.events[0].id).toBe('ce-local-1');
    expect(validateCommercialEventRelationshipIntegrity(payload.events).ok).toBe(true);
    expect(JSON.parse(storage.get(COMMERCIAL_EVENTS_STORAGE_KEY))[DEV_ID].events).toHaveLength(1);
  });

  it('local authority OFF retains localStorage compatibility', () => {
    authorityEnabled.value = false;

    const result = createCommercialEvent(DEV_ID, {
      packageId: ORDER_KEY,
      poNumber: 'S0001',
      supplierId: 'sup-1',
      costCode: '0120',
      eventType: 'variation',
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Legacy create',
      value: 1500,
    });

    expect(result.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, result.event.id)?.value).toBe(1500);
    expect(JSON.parse(storage.get(COMMERCIAL_EVENTS_STORAGE_KEY))[DEV_ID].events).toHaveLength(1);
  });

  it('updates cache on approve, reject, close, and dismiss workflow actions', async () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(DEV_ID, serverDocument({ potentialContraCharge: true }));

    apiMocks.approveCommercialEvent.mockResolvedValue(
      serverDocument({ status: 'approved', version: 2 })
    );
    const approved = await approveCommercialEvent(DEV_ID, 'ce-server-1');
    expect(approved.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.status).toBe('approved');

    patchCachedCommercialEvent(
      DEV_ID,
      serverDocument({ status: 'submitted', potentialContraCharge: true })
    );
    apiMocks.rejectCommercialEvent.mockResolvedValue(
      serverDocument({ status: 'rejected', version: 3, potentialContraCharge: true })
    );
    const rejected = await rejectCommercialEvent(DEV_ID, 'ce-server-1');
    expect(rejected.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.status).toBe('rejected');

    patchCachedCommercialEvent(
      DEV_ID,
      serverDocument({ status: 'approved', potentialContraCharge: true })
    );
    apiMocks.closeCommercialEvent.mockResolvedValue(
      serverDocument({ status: 'closed', version: 4, potentialContraCharge: true })
    );
    const closed = await closeCommercialEvent(DEV_ID, 'ce-server-1');
    expect(closed.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.status).toBe('closed');

    patchCachedCommercialEvent(
      DEV_ID,
      serverDocument({ status: 'approved', potentialContraCharge: true })
    );
    apiMocks.dismissPotentialContra.mockResolvedValue(
      serverDocument({
        status: 'approved',
        potentialContraCharge: false,
        version: 5,
      })
    );
    const dismissed = await markPotentialContraChargeNotRequired(DEV_ID, 'ce-server-1');
    expect(dismissed.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.potentialContraCharge).toBe(false);
  });

  it('patches both origin and recovery on linked recovery atomic response', async () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(
      DEV_ID,
      serverDocument({
        id: 'ce-origin',
        eventNumber: 'CE-0200',
        financialTreatment: 'contractAmendment',
        relationshipType: 'origin',
      })
    );

    apiMocks.createLinkedRecovery.mockResolvedValue({
      origin: serverDocument({
        id: 'ce-origin',
        eventNumber: 'CE-0200',
        linkedEventId: 'ce-recovery',
        relationshipType: 'origin',
        version: 2,
      }),
      recovery: serverDocument({
        id: 'ce-recovery',
        eventNumber: 'CE-0201',
        packageId: `${DEV_ID}::sup-2::0121`,
        linkedEventId: 'ce-origin',
        relationshipType: 'recovery',
        financialTreatment: 'recoverableDeduction',
        value: 2500,
        status: 'draft',
      }),
    });

    const result = await createLinkedRecoveryFromOrigin(DEV_ID, 'ce-origin', {
      recoveryPackageId: `${DEV_ID}::sup-2::0121`,
    });

    expect(result.ok).toBe(true);
    expect(getCommercialEventById(DEV_ID, 'ce-origin')?.linkedEventId).toBe('ce-recovery');
    expect(getCommercialEventById(DEV_ID, 'ce-recovery')?.relationshipType).toBe('recovery');
    expect(listCommercialEventsByDevelopment(DEV_ID)).toHaveLength(2);
  });

  it('skips certificate-status CE persistence when authority ON', () => {
    authorityEnabled.value = true;
    patchCachedCommercialEvent(DEV_ID, serverDocument({ certificateStatus: 'notIncluded' }));

    const result = updateCommercialEventCertificateStatus(DEV_ID, 'ce-server-1', 'partCertified');
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('server-ce-authority');
    expect(getCommercialEventById(DEV_ID, 'ce-server-1')?.certificateStatus).toBe('notIncluded');
  });
});
