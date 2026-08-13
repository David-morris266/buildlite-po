/**
 * @vitest-environment jsdom
 * BL-028B.3 — Authority-ON certificate approval + stale recovery persistence regressions.
 * BL-028B.3b — API boundary mocked; live localhost:3001 fetch blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: true }));
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
  getCommercialEvent: vi.fn(),
  importCommercialEvents: vi.fn(),
}));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
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
  getCommercialEvent: (...args) => apiMocks.getCommercialEvent(...args),
  createCommercialEvent: (...args) => apiMocks.createCommercialEvent(...args),
  updateCommercialEvent: (...args) => apiMocks.updateCommercialEvent(...args),
  submitCommercialEvent: (...args) => apiMocks.submitCommercialEvent(...args),
  approveCommercialEvent: (...args) => apiMocks.approveCommercialEvent(...args),
  rejectCommercialEvent: (...args) => apiMocks.rejectCommercialEvent(...args),
  closeCommercialEvent: (...args) => apiMocks.closeCommercialEvent(...args),
  dismissPotentialContra: (...args) => apiMocks.dismissPotentialContra(...args),
  createLinkedRecovery: (...args) => apiMocks.createLinkedRecovery(...args),
  importCommercialEvents: (...args) => apiMocks.importCommercialEvents(...args),
}));

import { installNetworkGuard } from '../test/networkGuard';

import { saveCompanySettings } from '../admin/companyStore';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  closeCommercialEvent,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { summarizeCertificateProgress } from './paymentCertificateProgress';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import {
  addCommercialLineToCertificate,
  addRecoveryLineToCertificate,
  approveCertificate,
  canCreateNextCertificate,
  createCertificate,
  getCertificate,
  removeRecoveryLineFromCertificate,
  submitCertificate,
  updateCertificateCellProgress,
} from './paymentCertificateStore';
import {
  __resetCommercialEventServerCacheForTests,
  patchCachedCommercialEvent,
} from '../commercialEvents/commercialEventServerCache';
import { ensurePackageRecord } from './subcontractPackageStore';
import { saveOrderMatrix } from './orderMatrixStore';

const DEV_ID = 'dev-1785599776666-zck5pl';
const ORDER_KEY = `${DEV_ID}::sup-1786363489252::5215 — electrical — electrical`;

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1786363489252',
  costCode: '5215 — electrical — electrical',
  committedValue: 100000,
  pos: [{ subtotal: 100000, vatRateDefault: 0, retentionRateDefault: 0.05 }],
};

function seedMatrix() {
  saveOrderMatrix(ORDER_KEY, {
    layout: 'plot-stage',
    plots: [{ label: '1', values: [100000] }],
    stages: ['Stage 1'],
  });
}

function seedApprovedOrigin(overrides = {}) {
  const draft = createCommercialEvent(DEV_ID, {
    packageId: `${DEV_ID}::sup-1786369659922::5218 — drylining — drylining`,
    poNumber: 'S0008',
    supplierId: 'sup-1786369659922',
    costCode: '5218 — drylining — drylining',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Repair works after electrical correction',
    value: 1500,
    potentialContraCharge: true,
    ...overrides,
  });
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

function seedCe0019Recovery() {
  const origin = seedApprovedOrigin();
  const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
    recoveryPackageId: ORDER_KEY,
  });
  expect(linked.ok).toBe(true);
  submitCommercialEvent(DEV_ID, linked.recovery.id);
  approveCommercialEvent(DEV_ID, linked.recovery.id);
  return getCommercialEventById(DEV_ID, linked.recovery.id);
}

function closeRecoveryEvent(recovery) {
  closeCommercialEvent(DEV_ID, recovery.id);
  return getCommercialEventById(DEV_ID, recovery.id);
}

function seedCe0013Variation() {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0007',
    supplierId: 'sup-1786363489252',
    costCode: '5215 — electrical — electrical',
    eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Elec extras',
    value: 10000,
  });
  submitCommercialEvent(DEV_ID, created.event.id);
  approveCommercialEvent(DEV_ID, created.event.id);
  return getCommercialEventById(DEV_ID, created.event.id);
}

function createDraftCertificateThree() {
  const first = createCertificate(ORDER_KEY, baseOrder);
  expect(first.ok).toBe(true);
  submitCertificate(ORDER_KEY, first.certificate.id);
  approveCertificate(ORDER_KEY, first.certificate.id, {
    grossWorksThisCertificate: 1000,
    netPayment: 950,
  });

  const second = createCertificate(ORDER_KEY, baseOrder);
  expect(second.ok).toBe(true);
  submitCertificate(ORDER_KEY, second.certificate.id);
  approveCertificate(ORDER_KEY, second.certificate.id, {
    grossWorksThisCertificate: 1000,
    netPayment: 950,
  });

  const third = createCertificate(ORDER_KEY, baseOrder);
  expect(third.ok).toBe(true);
  return third.certificate;
}

function lineEventIds(certificate) {
  return normalizeLines(certificate).map((line) => line.commercialEventId);
}

function normalizeLines(certificate) {
  return Array.isArray(certificate?.commercialLines) ? certificate.commercialLines : [];
}

describe('BL-028B.3 authority-ON certificate approval regressions', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    storage.clear();
    authorityEnabled.value = false;
    __resetCommercialEventServerCacheForTests();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    ensurePackageRecord(ORDER_KEY, baseOrder);
    seedMatrix();
    for (const mockFn of Object.values(apiMocks)) {
      mockFn.mockReset();
      mockFn.mockImplementation(() => {
        throw new Error(
          'paymentCertificateAuthorityApproval.test.js: mocked commercial-events API must not be called without explicit setup'
        );
      });
    }
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  function withAuthorityOn(events = [], run) {
    authorityEnabled.value = true;
    for (const event of events) {
      if (event) {
        patchCachedCommercialEvent(DEV_ID, event);
      }
    }
    return run();
  }

  it('A. CE-0013 only: draft → add → submit → approve locks cert and allows Cert 4', () => {
    const variation = seedCe0013Variation();
    const certificate = createDraftCertificateThree();

    const added = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      variation.id,
      6000,
      baseOrder
    );
    expect(added.ok).toBe(true);

    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    submitCertificate(ORDER_KEY, certificate.id);

    withAuthorityOn([variation], () => {
      const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
      const approval = approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

      expect(approval.ok).toBe(true);
      expect(getCertificate(ORDER_KEY, certificate.id).status).toBe('locked');
      expect(getCertificate(ORDER_KEY, certificate.id).recoveryDeductionsApplied).toBe(true);
      expect(getCertificate(ORDER_KEY, certificate.id).valueInclusionLifecycleApplied).toBe(true);
      expect(canCreateNextCertificate(ORDER_KEY).ok).toBe(true);
    });
  });

  it('B. stale CE-0019 present blocks approval with Closed-specific message', () => {
    const recovery = seedCe0019Recovery();
    const variation = seedCe0013Variation();
    const certificate = createDraftCertificateThree();

    const recoveryAdd = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1500,
      baseOrder
    );
    expect(recoveryAdd.ok).toBe(true);
    const closedRecovery = closeRecoveryEvent(recovery);
    expect(closedRecovery.status).toBe(COMMERCIAL_EVENT_STATUSES.closed.key);

    addCommercialLineToCertificate(ORDER_KEY, certificate.id, variation.id, 6000, baseOrder);
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    submitCertificate(ORDER_KEY, certificate.id);

    withAuthorityOn([closedRecovery, variation], () => {
      const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
      const approval = approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

      expect(approval.ok).toBe(false);
      expect(approval.errors.join(' ')).toMatch(/Closed and can no longer be deducted/i);
      expect(getCertificate(ORDER_KEY, certificate.id).status).toBe('submitted');
      expect(canCreateNextCertificate(ORDER_KEY).ok).toBe(false);
    });
  });

  it('C. UAT sequence: remove stale CE-0019 → add CE-0013 → submit → approve succeeds', () => {
    const recovery = seedCe0019Recovery();
    const variation = seedCe0013Variation();
    const certificate = createDraftCertificateThree();

    const recoveryAdd = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1500,
      baseOrder
    );
    expect(recoveryAdd.ok).toBe(true);
    closeRecoveryEvent(recovery);
    expect(lineEventIds(getCertificate(ORDER_KEY, certificate.id))).toContain(recovery.id);

    const recoveryLine = getCertificate(ORDER_KEY, certificate.id).commercialLines.find(
      (line) => line.commercialEventId === recovery.id
    );
    const removed = removeRecoveryLineFromCertificate(
      ORDER_KEY,
      certificate.id,
      recoveryLine.id,
      baseOrder
    );
    expect(removed.ok).toBe(true);
    expect(lineEventIds(getCertificate(ORDER_KEY, certificate.id))).not.toContain(recovery.id);

    const added = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      variation.id,
      6000,
      baseOrder
    );
    expect(added.ok).toBe(true);

    const afterAdd = getCertificate(ORDER_KEY, certificate.id);
    expect(lineEventIds(afterAdd)).toEqual([variation.id]);
    expect(lineEventIds(afterAdd)).not.toContain(recovery.id);

    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 20);
    submitCertificate(ORDER_KEY, certificate.id);

    const submitted = getCertificate(ORDER_KEY, certificate.id);
    expect(submitted.status).toBe('submitted');
    expect(lineEventIds(submitted)).toEqual([variation.id]);

    withAuthorityOn([variation], () => {
      const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
      const approval = approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

      expect(approval.ok).toBe(true);
      expect(getCertificate(ORDER_KEY, certificate.id).status).toBe('locked');
      expect(getCertificate(ORDER_KEY, certificate.id).approvedAt).toBeTruthy();
      expect(canCreateNextCertificate(ORDER_KEY).ok).toBe(true);
    });
  });

  it('C2. adding CE-0013 without removing CE-0019 keeps both lines (stale tolerance, not removal)', () => {
    const recovery = seedCe0019Recovery();
    const variation = seedCe0013Variation();
    const certificate = createDraftCertificateThree();

    const recoveryAdd = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1500,
      baseOrder
    );
    expect(recoveryAdd.ok).toBe(true);
    closeRecoveryEvent(recovery);
    addCommercialLineToCertificate(ORDER_KEY, certificate.id, variation.id, 6000, baseOrder);

    expect(lineEventIds(getCertificate(ORDER_KEY, certificate.id))).toEqual([
      recovery.id,
      variation.id,
    ]);
  });

  it('C3. remove then add survives a stale pre-read snapshot (lost-update guard)', () => {
    const recovery = seedCe0019Recovery();
    const variation = seedCe0013Variation();
    const certificate = createDraftCertificateThree();

    const recoveryAdd = addRecoveryLineToCertificate(
      ORDER_KEY,
      certificate.id,
      recovery.id,
      1500,
      baseOrder
    );
    expect(recoveryAdd.ok).toBe(true);
    const staleSnapshot = [...getCertificate(ORDER_KEY, certificate.id).commercialLines];

    const recoveryLine = staleSnapshot.find((line) => line.commercialEventId === recovery.id);
    removeRecoveryLineFromCertificate(ORDER_KEY, certificate.id, recoveryLine.id, baseOrder);
    expect(getCertificate(ORDER_KEY, certificate.id).commercialLines).toHaveLength(0);

    void staleSnapshot;
    const added = addCommercialLineToCertificate(
      ORDER_KEY,
      certificate.id,
      variation.id,
      6000,
      baseOrder
    );
    expect(added.ok).toBe(true);

    const lines = getCertificate(ORDER_KEY, certificate.id).commercialLines;
    expect(lines).toHaveLength(1);
    expect(lines[0].commercialEventId).toBe(variation.id);
    expect(lines.some((line) => line.commercialEventId === recovery.id)).toBe(false);
  });

  it('D. authority ON with zero recovery lines approves successfully', () => {
    const certificate = createDraftCertificateThree();
    updateCertificateCellProgress(ORDER_KEY, certificate.id, '0::0', 15);
    submitCertificate(ORDER_KEY, certificate.id);

    withAuthorityOn([], () => {
      const totals = summarizeCertificateProgress(ORDER_KEY, certificate.id, baseOrder).totals;
      const approval = approveCertificate(ORDER_KEY, certificate.id, totals, baseOrder);

      expect(approval.ok).toBe(true);
      expect(getCertificate(ORDER_KEY, certificate.id).status).toBe('locked');
    });
  });

  it('regression: no real HTTP requests to localhost:3001 during this file', () => {
    const liveAttempts = networkGuard.getAttempts().filter((url) =>
      ['localhost:3001', '127.0.0.1:3001'].some((host) => url.includes(host))
    );
    expect(liveAttempts).toEqual([]);
    for (const mockFn of Object.values(apiMocks)) {
      expect(mockFn).not.toHaveBeenCalled();
    }
  });
});
