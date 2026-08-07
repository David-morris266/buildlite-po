import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const setItemSpy = vi.fn((key, value) => storage.set(key, value));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: setItemSpy,
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
  submitCommercialEvent,
  updateCommercialEventDraft,
} from './commercialEventStore';
import {
  COMMERCIAL_EVENTS_PACKAGE_TAB,
  buildCommercialEventTarget,
  buildLinkedCommercialEventLaunch,
  createCommercialEventNavigationSnapshot,
  getLinkedEventNavigationLabel,
  resolveLinkedCommercialEventNavigation,
} from './commercialEventNavigation';
import {
  PACKAGE_OPENED_FROM,
  buildPackageWorkspaceLaunchContext,
  resolvePackageWorkspaceBackTarget,
} from '../payments/packageWorkspaceLaunch';
import {
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

const DEV_ID = 'dev-nav-001';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;

const packageRowA = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Supplier One',
  projectLabel: 'Oakwood',
  committedValue: 50000,
  certificateCount: 0,
  poNumbers: ['S0001'],
};

const packageRowB = {
  orderKey: PACKAGE_B,
  developmentId: DEV_ID,
  supplierId: 'sup-2',
  costCode: '0200',
  supplierLabel: 'Supplier Two',
  projectLabel: 'Oakwood',
  committedValue: 30000,
  certificateCount: 0,
  poNumbers: ['S0002'],
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
    description: 'Origin variation',
    value: 3800,
    ...overrides,
  };
}

function createApprovedOrigin() {
  const draft = createCommercialEvent(DEV_ID, basePayload());
  updateCommercialEventDraft(DEV_ID, draft.event.id, {
    potentialContraCharge: true,
    potentialContraChargeNotes: 'Subcontractor damage',
  });
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

function createOriginRecoveryPair(recoveryPackageId = PACKAGE_B) {
  const origin = createApprovedOrigin();
  const recoveryResult = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
    recoveryPackageId,
  });
  expect(recoveryResult.ok).toBe(true);
  return {
    origin: recoveryResult.origin,
    recovery: recoveryResult.recovery,
  };
}

describe('BL-021B.3.1 commercial event navigation', () => {
  beforeEach(() => {
    storage.clear();
    setItemSpy.mockClear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('labels origin navigation as Open Related Event and recovery as Open Origin Event', () => {
    const { origin, recovery } = createOriginRecoveryPair();

    expect(getLinkedEventNavigationLabel(origin)).toBe('Open Related Event');
    expect(getLinkedEventNavigationLabel(recovery)).toBe('Open Origin Event');
  });

  it('navigates from origin to recovery on another package', () => {
    const { origin, recovery } = createOriginRecoveryPair();

    const result = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: origin,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA, packageRowB],
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('cross-package');
    expect(result.linkedEvent.id).toBe(recovery.id);
    expect(result.launch.orderKey).toBe(PACKAGE_B);
    expect(result.launch.initialTab).toBe(COMMERCIAL_EVENTS_PACKAGE_TAB);
    expect(result.launch.openedFrom).toBe(PACKAGE_OPENED_FROM.CommercialEventLink);
    expect(result.launch.commercialEventTarget.eventId).toBe(recovery.id);
  });

  it('navigates from recovery back to origin on another package', () => {
    const { origin, recovery } = createOriginRecoveryPair();

    const result = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: recovery,
      currentPackageId: PACKAGE_B,
      packages: [packageRowA, packageRowB],
    });

    expect(result.ok).toBe(true);
    expect(result.kind).toBe('cross-package');
    expect(result.linkedEvent.id).toBe(origin.id);
    expect(result.launch.orderKey).toBe(PACKAGE_A);
    expect(result.launch.commercialEventTarget.eventId).toBe(origin.id);
  });

  it('navigates within the same package without building a cross-package launch', () => {
    const originDraft = createCommercialEvent(DEV_ID, basePayload());
    const recoveryDraft = createCommercialEvent(
      DEV_ID,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
        linkedEventId: originDraft.event.id,
        value: -3800,
        description: 'Same-package recovery',
      })
    );
    updateCommercialEventDraft(DEV_ID, originDraft.event.id, {
      linkedEventId: recoveryDraft.event.id,
      relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.origin.key,
    });

    const origin = getCommercialEventById(DEV_ID, originDraft.event.id);
    const recovery = getCommercialEventById(DEV_ID, recoveryDraft.event.id);

    const toRecovery = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: origin,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA],
    });

    expect(toRecovery.ok).toBe(true);
    expect(toRecovery.kind).toBe('same-package');
    expect(toRecovery.linkedEvent.id).toBe(recovery.id);
    expect(toRecovery.launch).toBeUndefined();

    const toOrigin = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: recovery,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA],
    });

    expect(toOrigin.ok).toBe(true);
    expect(toOrigin.kind).toBe('same-package');
    expect(toOrigin.linkedEvent.id).toBe(origin.id);
  });

  it('reports missing linked event without mutating the store', () => {
    const origin = createApprovedOrigin();
    const writesBefore = setItemSpy.mock.calls.length;

    const broken = {
      ...origin,
      linkedEventId: 'missing-event-id',
    };

    const result = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: broken,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA, packageRowB],
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/no longer available/i);
    expect(setItemSpy.mock.calls.length).toBe(writesBefore);
  });

  it('reports missing responsible package for cross-package navigation', () => {
    const { origin } = createOriginRecoveryPair();

    const result = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: origin,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA],
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/not found/i);
  });

  it('buildLinkedCommercialEventLaunch rejects events without package identity', () => {
    const launch = buildLinkedCommercialEventLaunch({
      packages: [packageRowA],
      linkedEvent: { id: 'evt-1', packageId: null },
      developmentId: DEV_ID,
    });

    expect(launch.ok).toBe(false);
    expect(launch.errors[0]).toMatch(/package identity/i);
  });

  it('creates a navigation snapshot that restores package tab and event drawer target', () => {
    const { origin } = createOriginRecoveryPair();
    const packageLaunch = buildPackageWorkspaceLaunchContext({
      packageRow: packageRowB,
      openedFrom: PACKAGE_OPENED_FROM.CommercialEventLink,
      initialTab: COMMERCIAL_EVENTS_PACKAGE_TAB,
      commercialEventTarget: buildCommercialEventTarget(origin.id, 'view', 'nav-1'),
    });

    const snapshot = createCommercialEventNavigationSnapshot(packageLaunch, origin.id);

    expect(snapshot.kind).toBe('package');
    expect(snapshot.packageLaunch.orderKey).toBe(PACKAGE_B);
    expect(snapshot.packageLaunch.initialTab).toBe(COMMERCIAL_EVENTS_PACKAGE_TAB);
    expect(snapshot.packageLaunch.commercialEventTarget.eventId).toBe(origin.id);
    expect(snapshot.packageLaunch.commercialEventTarget.mode).toBe('view');
  });

  it('simulates back navigation by popping the commercial navigation stack', () => {
    const { origin, recovery } = createOriginRecoveryPair();

    const originLaunch = buildPackageWorkspaceLaunchContext({
      packageRow: packageRowA,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
      commercialEventTarget: buildCommercialEventTarget(origin.id, 'view', 'origin-view'),
    });

    const stack = [createCommercialEventNavigationSnapshot(originLaunch, origin.id)];

    const crossPackage = resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: origin,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA, packageRowB],
    });

    expect(crossPackage.ok).toBe(true);

    let currentLaunch = crossPackage.launch;
    expect(currentLaunch.commercialEventTarget.eventId).toBe(recovery.id);

    const previous = stack[stack.length - 1];
    const restoredStack = stack.slice(0, -1);
    currentLaunch = previous.packageLaunch;

    expect(restoredStack).toHaveLength(0);
    expect(currentLaunch.orderKey).toBe(PACKAGE_A);
    expect(currentLaunch.commercialEventTarget.eventId).toBe(origin.id);
    expect(currentLaunch.initialTab).toBe(COMMERCIAL_EVENTS_PACKAGE_TAB);
  });

  it('does not mutate commercial events during navigation resolution', () => {
    const { origin, recovery } = createOriginRecoveryPair();
    const originBefore = JSON.stringify(origin);
    const recoveryBefore = JSON.stringify(recovery);
    const writesBefore = setItemSpy.mock.calls.length;

    resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: origin,
      currentPackageId: PACKAGE_A,
      packages: [packageRowA, packageRowB],
    });

    resolveLinkedCommercialEventNavigation({
      developmentId: DEV_ID,
      sourceEvent: recovery,
      currentPackageId: PACKAGE_B,
      packages: [packageRowA, packageRowB],
    });

    expect(JSON.stringify(getCommercialEventById(DEV_ID, origin.id))).toBe(originBefore);
    expect(JSON.stringify(getCommercialEventById(DEV_ID, recovery.id))).toBe(recoveryBefore);
    expect(setItemSpy.mock.calls.length).toBe(writesBefore);
  });
});

describe('BL-021B.3.1 package workspace launch integration', () => {
  it('preserves existing DevelopmentPackages navigation behaviour', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow: packageRowA,
      openedFrom: PACKAGE_OPENED_FROM.DevelopmentPackages,
    });

    expect(launch.initialTab).toBe('overview');
    expect(launch.commercialEventTarget).toBeNull();
    expect(
      resolvePackageWorkspaceBackTarget(PACKAGE_OPENED_FROM.DevelopmentPackages)
    ).toBe('development-packages');
  });

  it('routes CommercialEventLink back through commercial navigation context', () => {
    expect(
      resolvePackageWorkspaceBackTarget(PACKAGE_OPENED_FROM.CommercialEventLink)
    ).toBe('commercial-event-link');
  });

  it('carries commercialEventTarget on linked-event package launch', () => {
    const launch = buildPackageWorkspaceLaunchContext({
      packageRow: packageRowB,
      openedFrom: PACKAGE_OPENED_FROM.CommercialEventLink,
      initialTab: COMMERCIAL_EVENTS_PACKAGE_TAB,
      commercialEventTarget: buildCommercialEventTarget('evt-recovery-1', 'view'),
    });

    expect(launch.initialTab).toBe('variations');
    expect(launch.commercialEventTarget).toEqual(
      expect.objectContaining({ eventId: 'evt-recovery-1', mode: 'view' })
    );
  });
});
