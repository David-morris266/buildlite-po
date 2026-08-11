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
  COMMERCIAL_EVENTS_STORAGE_KEY,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  getCommercialEventById,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import {
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import {
  addCommercialLineToCertificate,
  approveCertificate,
  createCertificate,
  getCertificate,
  rejectCertificate,
  submitCertificate,
} from '../payments/paymentCertificateStore';
import { COMMERCIAL_ASSISTANT_CONFIG } from './commercialAssistantConfig';
import {
  buildPackageCertificatesNavigationTarget,
  resolveCommercialAssistantNavigation,
} from './commercialAssistantNavigation';
import {
  buildAssistantRecommendationSnapshot,
  clearRecommendationProvidersForTests,
  collectDerivedRecommendations,
  registerRecommendationProvider,
} from './recommendationEngine';
import {
  buildCertificateRecommendations,
  CERTIFICATE_RULE_ID,
  certificateRecommendationProvider,
  evaluateOutstandingRecoveryCertificateRecommendation,
} from './certificateRecommendationProvider';
import {
  buildCommercialEventsRecommendations,
  COMMERCIAL_EVENTS_RULE_ID,
} from './commercialEventsRecommendationProvider';
import {
  ensureCommercialAssistantProvidersRegistered,
  resetCommercialAssistantProvidersForTests,
} from './registerCommercialAssistantProviders';
import { RECOMMENDATION_CATEGORY, RECOMMENDATION_SOURCE_MODULE } from './commercialAssistantTypes';

const DEV_ID = 'dev-cert-assistant';
const OTHER_DEV_ID = 'dev-cert-other';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;
const OTHER_PACKAGE = `${OTHER_DEV_ID}::sup-9::0900`;

const packageRowA = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Alpha Plumbing',
  projectLabel: 'Oakwood',
  committedValue: 50000,
  poNumbers: ['S0001'],
};

const packageRowB = {
  orderKey: PACKAGE_B,
  developmentId: DEV_ID,
  supplierId: 'sup-2',
  costCode: '0200',
  supplierLabel: 'Beta Electrical',
  projectLabel: 'Oakwood',
  committedValue: 30000,
  poNumbers: ['S0002'],
};

const otherDevPackageRow = {
  orderKey: OTHER_PACKAGE,
  developmentId: OTHER_DEV_ID,
  supplierId: 'sup-9',
  costCode: '0900',
  supplierLabel: 'Other Dev Supplier',
  projectLabel: 'Other',
  committedValue: 10000,
  poNumbers: ['S0099'],
};

const baseOrder = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Alpha Plumbing',
  projectLabel: 'Oakwood',
  committedValue: 50000,
};

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
    value: 4200,
    dateRaised: '2026-01-15',
    ...overrides,
  };
}

function assistantContext(packages = [packageRowA]) {
  return { developmentId: DEV_ID, packages };
}

function patchCertificateApprovedAt(orderKey, certificateId, approvedAt) {
  const raw = localStorage.getItem('buildlite_subcontract_packages_v1');
  const all = raw ? JSON.parse(raw) : {};
  const record = all[orderKey];
  if (!record?.certificates) return;
  record.certificates = record.certificates.map((certificate) =>
    certificate.id === certificateId
      ? { ...certificate, approvedAt, certificateDate: approvedAt.slice(0, 10) }
      : certificate
  );
  all[orderKey] = record;
  localStorage.setItem('buildlite_subcontract_packages_v1', JSON.stringify(all));
}

function seedApprovedCertificate(orderKey, order, approvedAt) {
  const created = createCertificate(orderKey, order);
  submitCertificate(orderKey, created.certificate.id);
  approveCertificate(orderKey, created.certificate.id);
  if (approvedAt) {
    patchCertificateApprovedAt(orderKey, created.certificate.id, approvedAt);
  }
  return getCertificate(orderKey, created.certificate.id);
}

function patchCommercialEventCertificateStatus(developmentId, eventId, certificateStatus) {
  const raw = localStorage.getItem(COMMERCIAL_EVENTS_STORAGE_KEY);
  const all = raw ? JSON.parse(raw) : {};
  const bucket = all[developmentId];
  if (!bucket?.events) return;
  bucket.events = bucket.events.map((event) =>
    event.id === eventId ? { ...event, certificateStatus } : event
  );
  all[developmentId] = bucket;
  localStorage.setItem(COMMERCIAL_EVENTS_STORAGE_KEY, JSON.stringify(all));
}

function patchCommercialEventDates(developmentId, eventId, { createdAt, updatedAt }) {
  const raw = localStorage.getItem(COMMERCIAL_EVENTS_STORAGE_KEY);
  const all = raw ? JSON.parse(raw) : {};
  const bucket = all[developmentId];
  if (!bucket?.events) return;
  bucket.events = bucket.events.map((event) =>
    event.id === eventId ? { ...event, createdAt, updatedAt } : event
  );
  all[developmentId] = bucket;
  localStorage.setItem(COMMERCIAL_EVENTS_STORAGE_KEY, JSON.stringify(all));
}

function createApprovedOrigin(overrides = {}) {
  const draft = createCommercialEvent(DEV_ID, basePayload(overrides));
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

describe('BL-024A.2 Certificate intelligence provider', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    resetCommercialAssistantProvidersForTests();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensureCommercialAssistantProvidersRegistered();
  });

  it('registers the certificate provider by default', () => {
    expect(certificateRecommendationProvider.id).toBe('certificates');
    const derived = collectDerivedRecommendations(assistantContext());
    expect(Array.isArray(derived)).toBe(true);
  });

  it('does not create noise for packages with no certificates and no valuation anchor', () => {
    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());
    expect(recommendations).toEqual([]);
  });

  it('triggers certificate due after the configured reminder threshold', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');

    const recommendations = buildCertificateRecommendations(
      assistantContext(),
      new Date('2026-02-01T00:00:00.000Z')
    );

    const due = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.certificateDue
    );
    expect(due).toBeTruthy();
    expect(due.category).toBe(RECOMMENDATION_CATEGORY.warning);
    expect(due.priority).toBe('medium');
    expect(due.recommendation).toContain('Consider preparing the next payment certificate');
  });

  it('suppresses certificate due when an active draft certificate exists', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');
    createCertificate(PACKAGE_A, baseOrder);

    const recommendations = buildCertificateRecommendations(
      assistantContext(),
      new Date('2026-02-01T00:00:00.000Z')
    );

    expect(
      recommendations.some((item) => item.ruleId === CERTIFICATE_RULE_ID.certificateDue)
    ).toBe(false);
    expect(
      recommendations.some((item) => item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval)
    ).toBe(true);
  });

  it('triggers certificate overdue only after reminder plus grace threshold', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');
    const reminderDays = COMMERCIAL_ASSISTANT_CONFIG.certificateReminderDays;
    const graceDays = COMMERCIAL_ASSISTANT_CONFIG.certificateOverdueGraceDays;

    const beforeOverdue = buildCertificateRecommendations(
      assistantContext(),
      new Date('2026-02-10T00:00:00.000Z')
    );
    expect(
      beforeOverdue.some((item) => item.ruleId === CERTIFICATE_RULE_ID.certificateOverdue)
    ).toBe(false);
    expect(
      beforeOverdue.some((item) => item.ruleId === CERTIFICATE_RULE_ID.certificateDue)
    ).toBe(true);

    const overdueAt = new Date('2026-01-01T00:00:00.000Z');
    overdueAt.setDate(overdueAt.getDate() + reminderDays + graceDays);
    const recommendations = buildCertificateRecommendations(assistantContext(), overdueAt);

    const overdue = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.certificateOverdue
    );
    expect(overdue).toBeTruthy();
    expect(overdue.category).toBe(RECOMMENDATION_CATEGORY.actionRequired);
    expect(
      recommendations.some((item) => item.ruleId === CERTIFICATE_RULE_ID.certificateDue)
    ).toBe(false);
  });

  it('uses operational overdue wording without statutory or contractual claims', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2025-12-01T00:00:00.000Z');

    const recommendations = buildCertificateRecommendations(
      assistantContext(),
      new Date('2026-03-01T00:00:00.000Z')
    );
    const overdue = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.certificateOverdue
    );

    expect(overdue.description).toContain('BuildLite valuation cycle');
    expect(overdue.description.toLowerCase()).not.toContain('statutory');
    expect(overdue.description.toLowerCase()).not.toContain('contract deadline');
    expect(overdue.description.toLowerCase()).not.toContain('payment notice overdue');
  });

  it('surfaces approved commercial events awaiting valuation when inclusion state is known', () => {
    createApprovedOrigin({ value: 2500, description: 'Awaiting valuation' });

    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());
    const awaiting = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation
    );

    expect(awaiting).toBeTruthy();
    expect(awaiting.evidence.some((item) => item.label === 'Approved event count')).toBe(true);
    expect(awaiting.evidence.some((item) => item.label === 'Signed net movement')).toBe(true);
  });

  it('excludes commercial events already fully certified through approved certificates', () => {
    const approved = createApprovedOrigin({ value: 1800 });
    const cert = createCertificate(PACKAGE_A, baseOrder).certificate;
    addCommercialLineToCertificate(PACKAGE_A, cert.id, approved.id, 1800, baseOrder);
    submitCertificate(PACKAGE_A, cert.id);
    approveCertificate(PACKAGE_A, cert.id);

    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());
    expect(
      recommendations.some(
        (item) => item.ruleId === CERTIFICATE_RULE_ID.approvedEventsAwaitingValuation
      )
    ).toBe(false);
  });

  it('uses outstanding recovery amount in certificate recovery recommendations', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(linked.ok).toBe(true);
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const recovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    const recommendation = evaluateOutstandingRecoveryCertificateRecommendation(
      recovery,
      DEV_ID
    );

    expect(recommendation.ruleId).toBe(CERTIFICATE_RULE_ID.outstandingRecovery);
    expect(recommendation.evidence.some((item) => item.label === 'Outstanding')).toBe(true);
    expect(recommendation.financialImpactValue).toBe(-3800);
  });

  it('does not treat origin events as recoveries', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());

    expect(
      recommendations.some(
        (item) =>
          item.ruleId === CERTIFICATE_RULE_ID.outstandingRecovery &&
          item.sourceRecordId === origin.id
      )
    ).toBe(false);
  });

  it('does not duplicate recovery recommendations between CE and certificate providers', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(linked.ok).toBe(true);
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const ceRecommendations = buildCommercialEventsRecommendations({ developmentId: DEV_ID });
    const allRecommendations = collectDerivedRecommendations(assistantContext());

    expect(
      ceRecommendations.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery
      )
    ).toBe(false);
    expect(
      allRecommendations.filter(
        (item) => item.ruleId === CERTIFICATE_RULE_ID.outstandingRecovery
      )
    ).toHaveLength(1);
  });

  it('surfaces draft certificates awaiting approval', () => {
    createCertificate(PACKAGE_A, baseOrder);

    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());
    const draft = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval
    );

    expect(draft).toBeTruthy();
    expect(draft.category).toBe(RECOMMENDATION_CATEGORY.information);
  });

  it('removes draft recommendation after certificate approval', () => {
    const created = createCertificate(PACKAGE_A, baseOrder);
    submitCertificate(PACKAGE_A, created.certificate.id);
    approveCertificate(PACKAGE_A, created.certificate.id);

    const recommendations = buildCertificateRecommendations(assistantContext(), new Date());
    expect(
      recommendations.some((item) => item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval)
    ).toBe(false);
  });

  it('returns submitted certificate recommendation to draft information after rejection', () => {
    const created = createCertificate(PACKAGE_A, baseOrder);
    submitCertificate(PACKAGE_A, created.certificate.id);

    const submitted = buildCertificateRecommendations(assistantContext(), new Date());
    const submittedRec = submitted.find(
      (item) =>
        item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval &&
        item.sourceRecordId === created.certificate.id
    );
    expect(submittedRec?.category).toBe(RECOMMENDATION_CATEGORY.warning);

    rejectCertificate(PACKAGE_A, created.certificate.id, 'Needs revision');

    const afterReject = buildCertificateRecommendations(assistantContext(), new Date());
    const draftRec = afterReject.find(
      (item) =>
        item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval &&
        item.sourceRecordId === created.certificate.id
    );
    expect(draftRec?.category).toBe(RECOMMENDATION_CATEGORY.information);
  });

  it('includes correct evidence values on certificate due recommendations', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');

    const recommendations = buildCertificateRecommendations(
      assistantContext(),
      new Date('2026-02-01T00:00:00.000Z')
    );
    const due = recommendations.find(
      (item) => item.ruleId === CERTIFICATE_RULE_ID.certificateDue
    );

    expect(due.evidence.find((item) => item.label === 'Supplier')?.value).toBe('Alpha Plumbing');
    expect(due.evidence.find((item) => item.label === 'Cost code')?.value).toBe('0100');
    expect(due.evidence.find((item) => item.label === 'Days since last certificate')?.value).toBe(
      '31'
    );
    expect(due.evidence.find((item) => item.label === 'Last certificate date')?.value).toBe(
      '2026-01-01'
    );
  });

  it('resolves package certificate navigation to the certificates tab', () => {
    const target = buildPackageCertificatesNavigationTarget({
      developmentId: DEV_ID,
      orderKey: PACKAGE_A,
    });

    const resolution = resolveCommercialAssistantNavigation(target, {
      developmentId: DEV_ID,
      packages: [packageRowA],
    });

    expect(resolution.ok).toBe(true);
    expect(resolution.launch.initialTab).toBe('certificates');
    expect(resolution.launch.orderKey).toBe(PACKAGE_A);
  });

  it('opens a specific certificate from navigation target', () => {
    const created = createCertificate(PACKAGE_A, baseOrder);
    const target = buildPackageCertificatesNavigationTarget({
      developmentId: DEV_ID,
      orderKey: PACKAGE_A,
      certificateId: created.certificate.id,
    });

    const resolution = resolveCommercialAssistantNavigation(target, {
      developmentId: DEV_ID,
      packages: [packageRowA],
    });

    expect(resolution.ok).toBe(true);
    expect(resolution.launch.certificateTarget.certificateId).toBe(created.certificate.id);
  });

  it('isolates certificate provider failures', () => {
    registerRecommendationProvider({
      id: 'broken-cert-provider',
      getRecommendations: () => {
        throw new Error('certificate provider failure');
      },
    });

    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');
    const context = assistantContext();

    expect(() => collectDerivedRecommendations(context)).not.toThrow();
    const recommendations = collectDerivedRecommendations(context);
    expect(
      recommendations.some(
        (item) =>
          item.ruleId === CERTIFICATE_RULE_ID.certificateDue ||
          item.ruleId === CERTIFICATE_RULE_ID.certificateOverdue
      )
    ).toBe(true);
  });

  it('excludes certificates from another development', () => {
    seedApprovedCertificate(OTHER_PACKAGE, {
      ...baseOrder,
      orderKey: OTHER_PACKAGE,
      developmentId: OTHER_DEV_ID,
      supplierId: 'sup-9',
      costCode: '0900',
    }, '2026-01-01T00:00:00.000Z');

    const recommendations = buildCertificateRecommendations(
      { developmentId: DEV_ID, packages: [packageRowA, otherDevPackageRow] },
      new Date('2026-03-01T00:00:00.000Z')
    );

    expect(recommendations.every((item) => item.sourceRecordId !== OTHER_PACKAGE)).toBe(true);
    expect(
      recommendations.some((item) => item.evidence?.some((evidence) => evidence.value === 'Other Dev Supplier'))
    ).toBe(false);
  });

  it('handles legacy or missing certificate data safely', () => {
    createCertificate(PACKAGE_A, baseOrder);
    const raw = localStorage.getItem('buildlite_subcontract_packages_v1');
    const all = raw ? JSON.parse(raw) : {};
    all[PACKAGE_A].certificates[0] = {
      ...all[PACKAGE_A].certificates[0],
      certificateDate: null,
      createdAt: null,
      approvedAt: null,
    };
    localStorage.setItem('buildlite_subcontract_packages_v1', JSON.stringify(all));

    expect(() => buildCertificateRecommendations(assistantContext(), new Date())).not.toThrow();
  });

  it('does not mutate certificate records when building recommendations', () => {
    seedApprovedCertificate(PACKAGE_A, baseOrder, '2026-01-01T00:00:00.000Z');
    const before = localStorage.getItem('buildlite_subcontract_packages_v1');

    buildCertificateRecommendations(assistantContext(), new Date('2026-02-01T00:00:00.000Z'));
    buildAssistantRecommendationSnapshot(assistantContext(), new Date('2026-02-01T00:00:00.000Z'));

    expect(localStorage.getItem('buildlite_subcontract_packages_v1')).toBe(before);
  });

  it('leaves existing CE recommendations unchanged aside from recovery ownership', () => {
    const draft = createCommercialEvent(DEV_ID, basePayload({ description: 'Stale draft' }));
    patchCommercialEventDates(DEV_ID, draft.event.id, {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    createApprovedOrigin({ value: 3800, potentialContraCharge: true });

    const snapshot = buildAssistantRecommendationSnapshot(
      assistantContext([packageRowA, packageRowB]),
      new Date('2026-01-20T00:00:00.000Z')
    );

    expect(
      snapshot.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge
      )
    ).toBe(true);
    expect(
      snapshot.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent
      )
    ).toBe(true);
    expect(
      snapshot.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery
      )
    ).toBe(false);
  });

  it('refreshes recommendations after certificate workflow mutations', () => {
    const context = assistantContext();
    const before = buildAssistantRecommendationSnapshot(context);
    expect(before.visible.some((item) => item.sourceModule === RECOMMENDATION_SOURCE_MODULE.certificates)).toBe(false);

    createCertificate(PACKAGE_A, baseOrder);
    notifyCommercialChanged({ developmentId: DEV_ID, source: 'certificate', action: 'created' });

    const after = buildAssistantRecommendationSnapshot(context);
    expect(
      after.visible.some((item) => item.ruleId === CERTIFICATE_RULE_ID.draftAwaitingApproval)
    ).toBe(true);
  });
});
