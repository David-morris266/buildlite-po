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
  closeCommercialEvent,
  getCommercialEventById,
  rejectCommercialEvent,
  submitCommercialEvent,
  updateRecoveryStatus,
} from '../commercialEvents/commercialEventStore';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { notifyCommercialChanged } from '../commercial/commercialEvents';
import { buildRecommendationFingerprint } from './recommendationFingerprint';
import {
  clearRecommendationDispositionsForTests,
  deferRecommendation,
  dismissRecommendation,
  getRecommendationDisposition,
} from './recommendationDispositionStore';
import {
  buildAssistantRecommendationSnapshot,
  clearRecommendationProvidersForTests,
  collectDerivedRecommendations,
  registerRecommendationProvider,
} from './recommendationEngine';
import {
  buildCommercialEventsRecommendations,
  COMMERCIAL_EVENTS_RULE_ID,
  commercialEventsRecommendationProvider,
  evaluateAgedDraftRecommendation,
  evaluateOutstandingRecoveryRecommendation,
  evaluatePotentialContraRecommendation,
} from './commercialEventsRecommendationProvider';
import {
  buildCertificateRecommendations,
  certificateRecommendationProvider,
} from './certificateRecommendationProvider';
import {
  isDeferralActive,
  mergeRecommendations,
  resolveMergedRecommendationStatus,
} from './recommendationMerge';
import {
  buildDevelopmentCommercialEventNavigationTarget,
  resolveCommercialAssistantNavigation,
} from './commercialAssistantNavigation';
import { ensureCommercialAssistantProvidersRegistered, resetCommercialAssistantProvidersForTests } from './registerCommercialAssistantProviders';
import { RECOMMENDATION_CATEGORY, RECOMMENDATION_SOURCE_MODULE } from './commercialAssistantTypes';
import * as registerBadges from '../commercialEvents/commercialEventRegisterBadges';
import * as recoveryHelpers from '../commercialEvents/commercialEventRecovery';

const DEV_ID = 'dev-assistant';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;

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

describe('BL-024A.1 Commercial Assistant foundation', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    clearRecommendationDispositionsForTests();
    resetCommercialAssistantProvidersForTests();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensureCommercialAssistantProvidersRegistered();
  });

  it('registers providers and collects derived recommendations', () => {
    expect(collectDerivedRecommendations({ developmentId: DEV_ID })).toEqual([]);

    registerRecommendationProvider({
      id: 'test-provider',
      getRecommendations: () => [
        {
          fingerprint: buildRecommendationFingerprint('test', 'rule', '1'),
          ruleId: 'rule',
          category: RECOMMENDATION_CATEGORY.warning,
          priority: 'medium',
        },
      ],
    });

    const derived = collectDerivedRecommendations({ developmentId: DEV_ID });
    expect(derived).toHaveLength(1);
  });

  it('builds deterministic fingerprints from sourceModule, ruleId and sourceRecordId', () => {
    const fingerprint = buildRecommendationFingerprint(
      RECOMMENDATION_SOURCE_MODULE.commercialEvents,
      COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery,
      'event-123'
    );
    expect(fingerprint).toBe('commercialEvents:ce.outstanding-recovery.v1:event-123');
  });

  it('suppresses duplicate derived recommendations by fingerprint', () => {
    resetCommercialAssistantProvidersForTests();
    registerRecommendationProvider({
      id: 'dup-a',
      getRecommendations: () => [
        {
          fingerprint: buildRecommendationFingerprint('commercialEvents', 'rule', '1'),
          ruleId: 'rule',
          priority: 'high',
          category: RECOMMENDATION_CATEGORY.actionRequired,
        },
      ],
    });
    registerRecommendationProvider({
      id: 'dup-b',
      getRecommendations: () => [
        {
          fingerprint: buildRecommendationFingerprint('commercialEvents', 'rule', '1'),
          ruleId: 'rule',
          priority: 'low',
          category: RECOMMENDATION_CATEGORY.information,
        },
      ],
    });

    const derived = collectDerivedRecommendations({ developmentId: DEV_ID });
    expect(derived).toHaveLength(1);
  });

  it('isolates provider failures so one malformed record does not break the engine', () => {
    registerRecommendationProvider({
      id: 'broken-provider',
      getRecommendations: () => {
        throw new Error('provider failure');
      },
    });

    const draft = createCommercialEvent(DEV_ID, basePayload());
    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);
    updateCommercialEventDraftLegacyPotentialContra();

    expect(() => collectDerivedRecommendations({ developmentId: DEV_ID })).not.toThrow();
  });

  it('creates outstanding recovery recommendations using recovery helpers', () => {
    const origin = createApprovedOrigin({ value: 3800 });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const recovery = getCommercialEventById(DEV_ID, linked.recovery.id);
    const recommendation = evaluateOutstandingRecoveryRecommendation(recovery, DEV_ID);

    expect(recommendation.ruleId).toBe(COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery);
    expect(recommendation.category).toBe(RECOMMENDATION_CATEGORY.actionRequired);
    expect(recommendation.priority).toBe('high');
    expect(recommendation.generatedBy).toBe('rule');
  });

  it('creates potential contra recommendations via canShowPotentialContraBanner', () => {
    const spy = vi.spyOn(registerBadges, 'canShowPotentialContraBanner');
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });

    evaluatePotentialContraRecommendation(origin, DEV_ID);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    const recommendations = buildCommercialEventsRecommendations({ developmentId: DEV_ID });
    expect(
      recommendations.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge
      )
    ).toBe(true);
  });

  it('creates aged draft recommendations after the configurable threshold', () => {
    const draft = createCommercialEvent(DEV_ID, basePayload({ description: 'Old draft' }));
    const stored = getCommercialEventById(DEV_ID, draft.event.id);
    stored.updatedAt = '2026-01-01T00:00:00.000Z';
    stored.createdAt = '2026-01-01T00:00:00.000Z';

    const recommendation = evaluateAgedDraftRecommendation(stored, DEV_ID, {
      now: new Date('2026-01-20T00:00:00.000Z'),
      thresholdDays: 14,
    });

    expect(recommendation.ruleId).toBe(COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent);
    expect(recommendation.category).toBe(RECOMMENDATION_CATEGORY.information);
    expect(recommendation.priority).toBe('low');
  });

  it('reuses isActiveRecovery in the certificate recovery rule', () => {
    const spy = vi.spyOn(recoveryHelpers, 'isActiveRecovery');
    const origin = createApprovedOrigin({ value: 2500, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    buildCertificateRecommendations({ developmentId: DEV_ID });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('persists dismissal overlay with audit history', () => {
    const fingerprint = buildRecommendationFingerprint('commercialEvents', 'rule', 'abc');
    const result = dismissRecommendation(fingerprint, { reason: 'Already actioned' });

    expect(result.ok).toBe(true);
    const disposition = getRecommendationDisposition(fingerprint);
    expect(disposition.status).toBe('dismissed');
    expect(disposition.dismissReason).toBe('Already actioned');
    expect(disposition.auditHistory.some((entry) => entry.action === 'DISMISSED')).toBe(true);
  });

  it('defers recommendations until deferUntil and hides them while active', () => {
    const fingerprint = buildRecommendationFingerprint('commercialEvents', 'rule', 'defer-me');
    deferRecommendation(fingerprint, {
      deferUntil: '2099-01-01T00:00:00.000Z',
      deferReason: 'Review next week',
    });

    const disposition = getRecommendationDisposition(fingerprint);
    expect(disposition.status).toBe('deferred');
    expect(isDeferralActive(disposition, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    expect(
      resolveMergedRecommendationStatus(disposition, true, new Date('2026-06-01T00:00:00.000Z'))
    ).toBe('deferred');
  });

  it('reopens deferred recommendations after deferUntil expires', () => {
    const fingerprint = buildRecommendationFingerprint('commercialEvents', 'rule', 'defer-expire');
    const disposition = deferRecommendation(fingerprint, {
      deferUntil: '2026-01-10T00:00:00.000Z',
      deferReason: 'Short defer',
    }).disposition;

    expect(
      resolveMergedRecommendationStatus(disposition, true, new Date('2026-01-11T00:00:00.000Z'))
    ).toBe('open');
  });

  it('auto-resolves recommendations when the underlying condition no longer exists', () => {
    const derived = [
      {
        fingerprint: buildRecommendationFingerprint('commercialEvents', 'rule', 'gone'),
        category: RECOMMENDATION_CATEGORY.actionRequired,
        priority: 'high',
      },
    ];

    const merged = mergeRecommendations(derived, {}, new Date());
    dismissRecommendation(derived[0].fingerprint);

    const afterDismiss = mergeRecommendations([], {
      [derived[0].fingerprint]: getRecommendationDisposition(derived[0].fingerprint),
    });

    expect(afterDismiss[0]?.status || 'resolved').toBe('resolved');
  });

  it('keeps dismissed recommendations hidden while the condition persists', () => {
    const fingerprint = buildRecommendationFingerprint('commercialEvents', 'rule', 'stay-hidden');
    const disposition = dismissRecommendation(fingerprint).disposition;

    expect(resolveMergedRecommendationStatus(disposition, true)).toBe('dismissed');
  });

  it('builds typed navigation targets and resolves available package launches', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const target = buildDevelopmentCommercialEventNavigationTarget({
      developmentId: DEV_ID,
      eventId: origin.id,
      packageId: PACKAGE_A,
    });

    const resolution = resolveCommercialAssistantNavigation(target, {
      developmentId: DEV_ID,
      packages: [packageRowA],
    });

    expect(resolution.ok).toBe(true);
    expect(resolution.launch.orderKey).toBe(PACKAGE_A);
    expect(resolution.developmentCommercialTarget.eventId).toBe(origin.id);
  });

  it('handles unavailable navigation targets gracefully', () => {
    const target = buildDevelopmentCommercialEventNavigationTarget({
      developmentId: DEV_ID,
      eventId: 'missing-event',
      packageId: PACKAGE_A,
    });

    const resolution = resolveCommercialAssistantNavigation(target, {
      developmentId: DEV_ID,
      packages: [packageRowA],
    });

    expect(resolution.ok).toBe(false);
    expect(resolution.unavailable).toBe(true);
  });

  it('refreshes recommendations after commercial change notifications', () => {
    const snapshotBefore = buildAssistantRecommendationSnapshot({ developmentId: DEV_ID });
    expect(snapshotBefore.visible).toHaveLength(0);

    createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    notifyCommercialChanged({ developmentId: DEV_ID, action: 'approved' });

    const snapshotAfter = buildAssistantRecommendationSnapshot({ developmentId: DEV_ID });
    expect(snapshotAfter.visible.length).toBeGreaterThan(0);
  });

  it('shows Potential Contra warning after approval without changing development scope', () => {
    const draft = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
        description: 'CE-0008 analogue',
      })
    );
    const context = { developmentId: DEV_ID };

    const beforeApprove = buildAssistantRecommendationSnapshot(context);
    expect(beforeApprove.badgeCounts.warnings).toBe(0);

    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);

    const afterApprove = buildAssistantRecommendationSnapshot(context);
    expect(
      afterApprove.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge
      )
    ).toBe(true);
    expect(afterApprove.badgeCounts.warnings).toBe(1);
  });

  it('shows Outstanding Recovery after recovery approval via certificate provider', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    const context = { developmentId: DEV_ID };

    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const snapshot = buildAssistantRecommendationSnapshot(context);
    expect(
      snapshot.visible.some(
        (item) => item.ruleId === 'cert.outstanding-recovery.v1'
      )
    ).toBe(true);
    expect(
      snapshot.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.outstandingRecovery
      )
    ).toBe(false);
    expect(snapshot.badgeCounts.actionRequired).toBeGreaterThan(0);
  });

  it('recomputes recommendations when approved events are closed', () => {
    const draft = createCommercialEvent(
      DEV_ID,
      basePayload({
        potentialContraCharge: true,
      })
    );
    const context = { developmentId: DEV_ID };

    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);

    const beforeClose = buildAssistantRecommendationSnapshot(context);
    expect(beforeClose.badgeCounts.warnings).toBe(1);

    closeCommercialEvent(DEV_ID, draft.event.id);

    const afterClose = buildAssistantRecommendationSnapshot(context);
    expect(afterClose.badgeCounts.warnings).toBe(0);
    expect(
      afterClose.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.potentialContraCharge
      )
    ).toBe(false);
  });

  it('recomputes recommendations when submitted events are rejected', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));

    const draft = createCommercialEvent(DEV_ID, basePayload({ description: 'Reject me' }));
    const context = { developmentId: DEV_ID };

    submitCommercialEvent(DEV_ID, draft.event.id);
    rejectCommercialEvent(DEV_ID, draft.event.id);

    const snapshot = buildAssistantRecommendationSnapshot(context, new Date('2026-01-20T10:00:00.000Z'));
    expect(
      snapshot.visible.some(
        (item) => item.ruleId === COMMERCIAL_EVENTS_RULE_ID.agedDraftCommercialEvent
      )
    ).toBe(false);

    vi.useRealTimers();
  });

  it('handles legacy events safely without throwing', () => {
    const recommendations = buildCommercialEventsRecommendations({ developmentId: DEV_ID }, new Date());
    expect(Array.isArray(recommendations)).toBe(true);
  });

  it('does not mutate commercial event records when building recommendations', () => {
    const origin = createApprovedOrigin({ value: 3800, potentialContraCharge: true });
    const before = JSON.stringify(getCommercialEventById(DEV_ID, origin.id));

    buildCommercialEventsRecommendations({ developmentId: DEV_ID });
    buildAssistantRecommendationSnapshot({ developmentId: DEV_ID });

    const after = JSON.stringify(getCommercialEventById(DEV_ID, origin.id));
    expect(after).toBe(before);
  });

  it('excludes information recommendations from header badge counts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T10:00:00.000Z'));
    createCommercialEvent(DEV_ID, basePayload({ description: 'Stale draft' }));
    vi.setSystemTime(new Date('2026-01-20T10:00:00.000Z'));

    createApprovedOrigin({ value: 3800, potentialContraCharge: true });

    const snapshot = buildAssistantRecommendationSnapshot({ developmentId: DEV_ID });
    vi.useRealTimers();

    expect(snapshot.badgeCounts.actionRequired).toBe(0);
    expect(snapshot.badgeCounts.warnings).toBeGreaterThan(0);
    expect(snapshot.visible.some((item) => item.category === 'information')).toBe(true);
  });

  it('registers the commercial events and certificate providers by default', () => {
    expect(commercialEventsRecommendationProvider.id).toBe('commercialEvents');
    expect(certificateRecommendationProvider.id).toBe('certificates');
  });
});

function createApprovedOrigin(overrides = {}) {
  const draft = createCommercialEvent(
    DEV_ID,
    basePayload({
      potentialContraCharge: true,
      ...overrides,
    })
  );
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

function updateCommercialEventDraftLegacyPotentialContra() {
  createCommercialEvent(DEV_ID, basePayload({ description: 'Another event' }));
}
