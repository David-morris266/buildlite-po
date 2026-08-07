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
  listCommercialEventsByPackage,
  markPotentialContraChargeNotRequired,
  submitCommercialEvent,
  updateRecoveryStatus,
} from './commercialEventStore';
import {
  buildCertificateHistoryEntries,
  buildCommercialEventHistoryEntries,
  buildMatrixHistoryEntries,
  buildPackageCommercialHistory,
  buildPoHistoryEntries,
  filterPackageHistoryEntries,
  PACKAGE_HISTORY_FILTER,
  PACKAGE_HISTORY_SOURCE,
  sortPackageHistoryEntriesNewestFirst,
} from './packageCommercialHistory';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import {
  approveCertificate,
  createCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import { ensurePackageRecord, getPackageRecord, recordMatrixSaved } from '../payments/subcontractPackageStore';
import { loadOrderMatrix, saveOrderMatrix } from '../payments/orderMatrixStore';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

const DEV_ID = 'dev-history';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;

const baseOrder = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Alpha Plumbing',
  projectLabel: 'Oakwood',
  committedValue: 50000,
  certifiedToDate: 0,
  poNumbers: ['S0001'],
  pos: [
    {
      poNumber: 'S0001',
      approval: {
        status: 'approved',
        decidedAt: '2026-01-05T10:00:00.000Z',
        history: [
          {
            at: '2026-01-04T09:00:00.000Z',
            by: 'Commercial Manager',
            action: 'SENT',
            note: 'Sent for approval',
          },
          {
            at: '2026-01-05T10:00:00.000Z',
            by: 'Director',
            action: 'APPROVED',
            note: 'Approved for issue',
          },
        ],
      },
    },
  ],
};

function basePayload(overrides = {}) {
  return {
    packageId: PACKAGE_A,
    poNumber: 'S0001',
    supplierId: 'sup-1',
    costCode: '0100',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Additional glazing scope',
    value: 4200,
    dateRaised: '2026-01-15',
    ...overrides,
  };
}

function createApprovedOrigin() {
  const draft = createCommercialEvent(
    DEV_ID,
    basePayload({
      potentialContraCharge: true,
      value: 3800,
    })
  );
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return draft.event;
}

describe('BL-021B.3.4 package commercial history', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensurePackageRecord(PACKAGE_A, baseOrder);
  });

  it('includes PO approval audit entries', () => {
    const entries = buildPoHistoryEntries(baseOrder);
    expect(entries).toHaveLength(2);
    expect(entries.some((entry) => entry.label.includes('sent for approval'))).toBe(true);
    expect(entries.some((entry) => entry.label.includes('approved'))).toBe(true);
    expect(entries.every((entry) => entry.source === PACKAGE_HISTORY_SOURCE.po)).toBe(true);
  });

  it('supports legacy approved PO records without approval history', () => {
    const legacyOrder = {
      ...baseOrder,
      pos: [
        {
          poNumber: 'S0099',
          status: 'approved',
          approval: { status: 'approved', decidedAt: '2026-02-01T12:00:00.000Z' },
        },
      ],
    };

    const entries = buildPoHistoryEntries(legacyOrder);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Purchase Order S0099 approved');
    expect(entries[0].id).toContain('po-legacy');
  });

  it('includes commercial event audit entries newest first in full history', () => {
    const draft = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);

    const history = buildPackageCommercialHistory(baseOrder);
    const commercialEntries = history.filter(
      (entry) => entry.source === PACKAGE_HISTORY_SOURCE.commercialEvent
    );

    expect(commercialEntries.length).toBeGreaterThanOrEqual(3);
    expect(commercialEntries.some((entry) => entry.label.includes('created'))).toBe(true);
    expect(commercialEntries.some((entry) => entry.label.includes('approved'))).toBe(true);
    expect(new Date(history[0].when).getTime()).toBeGreaterThanOrEqual(
      new Date(history[1].when).getTime()
    );
  });

  it('includes recovery lifecycle audit entries separately from origin events', () => {
    const origin = createApprovedOrigin();
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);
    updateRecoveryStatus(
      DEV_ID,
      linked.recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 1200 }
    );

    const packageBEvents = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);
    const recoveryEntries = buildCommercialEventHistoryEntries(packageBEvents).filter(
      (entry) => entry.source === PACKAGE_HISTORY_SOURCE.recovery
    );

    expect(recoveryEntries.some((entry) => entry.label.includes('created'))).toBe(true);
    expect(
      recoveryEntries.some((entry) => entry.label.includes('recovery status changed'))
    ).toBe(true);

    const packageAHistory = buildPackageCommercialHistory({
      ...baseOrder,
      orderKey: PACKAGE_A,
    });
    expect(
      packageAHistory.some((entry) => entry.source === PACKAGE_HISTORY_SOURCE.recovery)
    ).toBe(false);
  });

  it('includes payment certificate audit entries', () => {
    const created = createCertificate(PACKAGE_A, baseOrder);
    submitCertificate(PACKAGE_A, created.certificate.id);
    approveCertificate(PACKAGE_A, created.certificate.id, {
      grossThisCertificate: 10000,
      netPayment: 9500,
    });

    const entries = buildCertificateHistoryEntries(PACKAGE_A);
    expect(entries.some((entry) => entry.label.includes('created'))).toBe(true);
    expect(entries.some((entry) => entry.label.includes('submitted'))).toBe(true);
    expect(entries.some((entry) => entry.label.includes('approved'))).toBe(true);
  });

  it('includes matrix activity from package record', () => {
    recordMatrixSaved(PACKAGE_A, { isFirstSave: true });

    const entries = buildMatrixHistoryEntries(
      ensurePackageRecord(PACKAGE_A, baseOrder),
      null
    );

    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Order Matrix created');
    expect(entries[0].source).toBe(PACKAGE_HISTORY_SOURCE.matrix);
  });

  it('falls back to legacy matrix timestamp when no matrix activity exists', () => {
    saveOrderMatrix(PACKAGE_A, {
      layout: 'plot-stage',
      plots: [{ id: 'plot-1' }],
      rows: [],
      updatedAt: '2026-03-10T08:00:00.000Z',
    });

    const entries = buildMatrixHistoryEntries(getPackageRecord(PACKAGE_A), loadOrderMatrix(PACKAGE_A));
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Order Matrix updated');
  });

  it('sorts entries newest first', () => {
    const entries = sortPackageHistoryEntriesNewestFirst([
      { id: 'a', when: '2026-01-01T00:00:00.000Z', label: 'Older' },
      { id: 'b', when: '2026-02-01T00:00:00.000Z', label: 'Newer' },
    ]);

    expect(entries[0].label).toBe('Newer');
    expect(entries[1].label).toBe('Older');
  });

  it('handles legacy commercial events without audit history safely', () => {
    const entries = buildCommercialEventHistoryEntries([
      {
        id: 'legacy-ce',
        eventNumber: 'CE-LEG-1',
        createdAt: '2026-04-01T09:00:00.000Z',
        raisedBy: 'Legacy QS',
        description: 'Legacy variation',
        relationshipType: null,
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].label).toContain('CE-LEG-1');
    expect(entries[0].label).toContain('recorded');
  });

  it('filters history by source category', () => {
    createCommercialEvent(DEV_ID, basePayload());
    createCertificate(PACKAGE_A, baseOrder);

    const history = buildPackageCommercialHistory(baseOrder);
    expect(
      filterPackageHistoryEntries(history, PACKAGE_HISTORY_FILTER.commercial).length
    ).toBeGreaterThan(0);
    expect(filterPackageHistoryEntries(history, PACKAGE_HISTORY_FILTER.po).length).toBe(2);
    expect(
      filterPackageHistoryEntries(history, PACKAGE_HISTORY_FILTER.certificate).length
    ).toBeGreaterThan(0);
  });

  it('returns empty history for packages with no activity', () => {
    const emptyOrder = {
      ...baseOrder,
      orderKey: `${DEV_ID}::sup-9::0900`,
      pos: [],
    };
    ensurePackageRecord(emptyOrder.orderKey, emptyOrder);

    expect(buildPackageCommercialHistory(emptyOrder)).toEqual([]);
  });

  it('records potential contra dismissal in commercial history', () => {
    const origin = createApprovedOrigin();
    markPotentialContraChargeNotRequired(DEV_ID, origin.id, {
      comment: 'No recovery required',
    });

    const history = buildPackageCommercialHistory(baseOrder);
    expect(
      history.some((entry) => entry.label.includes('potential contra charge dismissed'))
    ).toBe(true);
  });

  it('does not change current package value when history is built', () => {
    const draft = createCommercialEvent(DEV_ID, basePayload({ value: 2500 }));
    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);

    const before = buildPackageCommercialDisplayFields(baseOrder);
    buildPackageCommercialHistory(baseOrder);
    const after = buildPackageCommercialDisplayFields(baseOrder);

    expect(after.currentPackageValue).toBe(before.currentPackageValue);
    expect(after.currentPackageValue).toBe(52500);
  });

  it('does not change payment certificate contract fields on the package view model', () => {
    createCertificate(PACKAGE_A, baseOrder);

    const before = buildPackageViewModel(baseOrder);
    buildPackageCommercialHistory(baseOrder);
    const after = buildPackageViewModel(baseOrder);

    expect(after.adjustedContract).toBe(before.adjustedContract);
    expect(after.committedValue).toBe(50000);
  });

  it('does not mutate CVR source order committedValue', () => {
    buildPackageCommercialHistory(baseOrder);
    expect(baseOrder.committedValue).toBe(50000);
  });
});
