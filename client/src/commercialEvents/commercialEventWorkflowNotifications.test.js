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
  COMMERCIAL_CHANGED,
  notifyCommercialChanged,
  subscribeCommercialChanged,
} from '../commercial/commercialEvents';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  closeCommercialEvent,
  createCommercialEvent,
  rejectCommercialEvent,
  submitCommercialEvent,
  updateCommercialEventDraft,
} from './commercialEventStore';
import { COMMERCIAL_EVENT_TYPES } from './commercialEventTypes';

const DEV_ID = 'dev-notify';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;

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
    description: 'Notification test event',
    value: 4200,
    dateRaised: '2026-02-01',
    ...overrides,
  };
}

function installCommercialChangedBus() {
  const handlers = new Map();

  vi.stubGlobal('window', {
    dispatchEvent: (event) => {
      handlers.get(event.type)?.forEach((handler) => handler(event));
      return true;
    },
    addEventListener: (type, handler) => {
      const list = handlers.get(type) || [];
      list.push(handler);
      handlers.set(type, list);
    },
    removeEventListener: (type, handler) => {
      const list = handlers.get(type) || [];
      handlers.set(
        type,
        list.filter((item) => item !== handler)
      );
    },
  });

  return {
    subscribe(handler) {
      return subscribeCommercialChanged(handler);
    },
  };
}

describe('BL-024A.1.3 commercial event workflow notifications', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    installCommercialChangedBus();
  });

  it('submitCommercialEvent emits commercial-change notification after success', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    handler.mockClear();

    submitCommercialEvent(DEV_ID, created.event.id);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        developmentId: DEV_ID,
        eventId: created.event.id,
        action: 'submitted',
      })
    );
    unsubscribe();
  });

  it('approveCommercialEvent emits notification after success', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, created.event.id);
    handler.mockClear();

    approveCommercialEvent(DEV_ID, created.event.id);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        developmentId: DEV_ID,
        eventId: created.event.id,
        action: 'approved',
      })
    );
    unsubscribe();
  });

  it('rejectCommercialEvent emits notification after success', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, created.event.id);
    handler.mockClear();

    rejectCommercialEvent(DEV_ID, created.event.id, { comment: 'Insufficient detail' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        developmentId: DEV_ID,
        eventId: created.event.id,
        action: 'rejected',
      })
    );
    unsubscribe();
  });

  it('closeCommercialEvent emits notification after success', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, created.event.id);
    approveCommercialEvent(DEV_ID, created.event.id);
    handler.mockClear();

    closeCommercialEvent(DEV_ID, created.event.id, { comment: 'Closed out' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        developmentId: DEV_ID,
        eventId: created.event.id,
        action: 'closed',
      })
    );
    unsubscribe();
  });

  it('does not notify when the workflow transition fails validation', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());

    submitCommercialEvent(DEV_ID, created.event.id);
    handler.mockClear();

    const secondSubmit = submitCommercialEvent(DEV_ID, created.event.id);
    expect(secondSubmit.ok).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('emits only one notification per successful workflow transition', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    handler.mockClear();

    submitCommercialEvent(DEV_ID, created.event.id);
    expect(handler).toHaveBeenCalledTimes(1);

    approveCommercialEvent(DEV_ID, created.event.id);
    expect(handler).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('updateCommercialEventDraft continues to emit updated notifications', () => {
    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);
    const created = createCommercialEvent(DEV_ID, basePayload());
    handler.mockClear();

    updateCommercialEventDraft(DEV_ID, created.event.id, {
      description: 'Draft refresh check',
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].detail).toEqual(
      expect.objectContaining({
        developmentId: DEV_ID,
        eventId: created.event.id,
        action: 'updated',
      })
    );
    unsubscribe();
  });

  it('uses the existing commercial-changed event type', () => {
    expect(COMMERCIAL_CHANGED).toBe('buildlite:commercial-changed');
    const handler = vi.fn();
    window.addEventListener(COMMERCIAL_CHANGED, handler);
    notifyCommercialChanged({ developmentId: DEV_ID, action: 'probe' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
