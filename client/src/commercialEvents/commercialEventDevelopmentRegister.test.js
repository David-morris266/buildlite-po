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
  listCommercialEventsByDevelopment,
  listCommercialEventsByPackage,
  submitCommercialEvent,
  updateCommercialEventDraft,
  updateRecoveryStatus,
} from './commercialEventStore';
import {
  buildDevelopmentCommercialEventPackageLaunch,
  buildDevelopmentCommercialEventSummary,
  buildDevelopmentCommercialEventPackageOptions,
  buildDevelopmentPackageLookup,
  createDevelopmentCommercialNavigationSnapshot,
  enrichDevelopmentCommercialEventRow,
  filterDevelopmentCommercialEventRows,
  isValidDevelopmentPackageIdentity,
  listEnrichedDevelopmentCommercialEvents,
  resolveDevelopmentLinkedEventNavigation,
  sortDevelopmentCommercialEventRows,
  sumNetApprovedCommercialMovement,
  sumOutstandingRecoveryAmount,
} from './commercialEventDevelopmentRegister';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import { notifyCommercialChanged, subscribeCommercialChanged } from '../commercial/commercialEvents';

const DEV_A = 'dev-register-a';
const DEV_B = 'dev-register-b';
const PACKAGE_A = `${DEV_A}::sup-1::0100`;
const PACKAGE_B = `${DEV_A}::sup-2::0200`;

const packageRowA = {
  orderKey: PACKAGE_A,
  developmentId: DEV_A,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Alpha Plumbing',
  projectLabel: 'Oakwood',
  committedValue: 50000,
  poNumbers: ['S0001'],
};

const packageRowB = {
  orderKey: PACKAGE_B,
  developmentId: DEV_A,
  supplierId: 'sup-2',
  costCode: '0200',
  supplierLabel: 'Beta Electrical',
  projectLabel: 'Oakwood',
  committedValue: 30000,
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
    description: 'Additional glazing scope',
    value: 4200,
    dateRaised: '2026-01-15',
    ...overrides,
  };
}

function createApprovedOrigin(overrides = {}) {
  const draft = createCommercialEvent(DEV_A, basePayload(overrides));
  updateCommercialEventDraft(DEV_A, draft.event.id, {
    potentialContraCharge: true,
    potentialContraChargeNotes: 'Damage claim pending',
  });
  submitCommercialEvent(DEV_A, draft.event.id);
  approveCommercialEvent(DEV_A, draft.event.id);
  return getCommercialEventById(DEV_A, draft.event.id);
}

describe('BL-021B.3.2 development commercial events register', () => {
  beforeEach(() => {
    storage.clear();
    setItemSpy.mockClear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('lists all development events and excludes other developments', () => {
    createCommercialEvent(DEV_A, basePayload({ description: 'Dev A event' }));
    createCommercialEvent(DEV_B, basePayload({ packageId: `${DEV_B}::sup-9::0900` }));

    const rows = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]);
    expect(rows).toHaveLength(1);
    expect(rows[0].event.description).toBe('Dev A event');
    expect(listCommercialEventsByDevelopment(DEV_B)).toHaveLength(1);
  });

  it('enriches rows from canonical orderKey package lookup', () => {
    createCommercialEvent(DEV_A, basePayload());
    const lookup = buildDevelopmentPackageLookup([packageRowA]);
    const [event] = listCommercialEventsByDevelopment(DEV_A);
    const row = enrichDevelopmentCommercialEventRow(event, lookup, DEV_A);

    expect(row.supplierName).toBe('Alpha Plumbing');
    expect(row.costCode).toBe('0100');
    expect(row.poNumbers).toEqual(['S0001']);
    expect(row.packageLabel).toBe('Alpha Plumbing – Oakwood');
    expect(row.currentPackageValue).toBe(50000);
  });

  it('calculates KPI counts and net approved movement from signed approved values', () => {
    createCommercialEvent(
      DEV_A,
      basePayload({
        description: 'Draft one',
        value: 1000,
        dateRaised: '2026-01-01',
      })
    );

    const submitted = createCommercialEvent(
      DEV_A,
      basePayload({ value: 2000, dateRaised: '2026-01-05' })
    );
    submitCommercialEvent(DEV_A, submitted.event.id);

    createCommercialEvent(
      DEV_A,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        value: -1500,
        dateRaised: '2026-01-10',
      })
    );
    const approvedPositive = createCommercialEvent(
      DEV_A,
      basePayload({ value: 3000, dateRaised: '2026-01-12' })
    );
    submitCommercialEvent(DEV_A, approvedPositive.event.id);
    approveCommercialEvent(DEV_A, approvedPositive.event.id);

    const summary = buildDevelopmentCommercialEventSummary(DEV_A, [packageRowA]);

    expect(summary.totalEvents).toBe(4);
    expect(summary.draftCount).toBe(2);
    expect(summary.submittedCount).toBe(1);
    expect(summary.approvedCount).toBe(1);
    expect(summary.netApprovedMovement).toBe(3000);
    expect(sumNetApprovedCommercialMovement(listCommercialEventsByDevelopment(DEV_A))).toBe(
      3000
    );
  });

  it('sums outstanding recovery from recovery events only using recoveredAmount', () => {
    const origin = createApprovedOrigin({ value: 5000 });
    const linked = createLinkedRecoveryFromOrigin(DEV_A, origin.id, {
      recoveryPackageId: PACKAGE_B,
    });
    submitCommercialEvent(DEV_A, linked.recovery.id);
    const approvedRecovery = approveCommercialEvent(DEV_A, linked.recovery.id).event;

    updateRecoveryStatus(
      DEV_A,
      approvedRecovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 1200 }
    );

    const events = listCommercialEventsByDevelopment(DEV_A);
    expect(sumOutstandingRecoveryAmount(events)).toBe(3800);
    expect(sumOutstandingRecoveryAmount(events.filter((event) => event.id === origin.id))).toBe(
      0
    );
  });

  it('counts approved potential contra origins without linked recovery', () => {
    createApprovedOrigin();
    createApprovedOrigin({ description: 'Already linked' });
    const second = listCommercialEventsByDevelopment(DEV_A).find(
      (event) => event.description === 'Already linked'
    );
    createLinkedRecoveryFromOrigin(DEV_A, second.id, { recoveryPackageId: PACKAGE_B });

    const summary = buildDevelopmentCommercialEventSummary(DEV_A, [packageRowA, packageRowB]);
    expect(summary.potentialContraNotRaisedCount).toBe(1);
  });

  it('applies each filter independently', () => {
    createCommercialEvent(
      DEV_A,
      basePayload({ description: 'Draft alpha', dateRaised: '2026-02-01' })
    );
    const submitted = createCommercialEvent(
      DEV_A,
      basePayload({
        description: 'Submitted beta',
        eventType: COMMERCIAL_EVENT_TYPES.credit.key,
        value: -800,
        dateRaised: '2026-02-02',
      })
    );
    submitCommercialEvent(DEV_A, submitted.event.id);

    const rows = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]);

    expect(filterDevelopmentCommercialEventRows(rows, { commercialStatus: 'draft' })).toHaveLength(
      1
    );
    expect(filterDevelopmentCommercialEventRows(rows, { eventType: 'credit' })).toHaveLength(1);
    expect(
      filterDevelopmentCommercialEventRows(rows, { recoveryStatus: 'notApplicable' })
    ).toHaveLength(2);
    expect(filterDevelopmentCommercialEventRows(rows, { supplier: 'Alpha' })).toHaveLength(2);
    expect(filterDevelopmentCommercialEventRows(rows, { packageId: PACKAGE_A })).toHaveLength(2);
  });

  it('applies combined filters and text search across required fields', () => {
    createCommercialEvent(
      DEV_A,
      basePayload({
        description: 'Searchable glazing note',
        poNumber: 'PO-SEARCH-1',
        dateRaised: '2026-03-01',
      })
    );
    createCommercialEvent(
      DEV_A,
      basePayload({
        description: 'Other package item',
        packageId: PACKAGE_B,
        supplierId: 'sup-2',
        costCode: '0200',
        dateRaised: '2026-03-02',
      })
    );

    const rows = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA, packageRowB]);
    const filtered = filterDevelopmentCommercialEventRows(rows, {
      commercialStatus: 'draft',
      packageId: PACKAGE_A,
      search: 'glazing',
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].event.description).toMatch(/glazing/i);

    expect(
      filterDevelopmentCommercialEventRows(rows, { search: 'S0002' })
    ).toHaveLength(1);
    expect(
      filterDevelopmentCommercialEventRows(rows, { search: '0200' })
    ).toHaveLength(1);
  });

  it('sorts newest date raised first by default', () => {
    createCommercialEvent(DEV_A, basePayload({ dateRaised: '2026-01-01', description: 'Old' }));
    createCommercialEvent(DEV_A, basePayload({ dateRaised: '2026-06-01', description: 'New' }));

    const rows = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]);
    const sorted = sortDevelopmentCommercialEventRows(rows);

    expect(sorted[0].event.description).toBe('New');
    expect(sorted[1].event.description).toBe('Old');
  });

  it('resolves package launch for Open Package', () => {
    const draft = createCommercialEvent(DEV_A, basePayload());
    const result = buildDevelopmentCommercialEventPackageLaunch({
      event: draft.event,
      packages: [packageRowA],
      developmentId: DEV_A,
    });

    expect(result.ok).toBe(true);
    expect(result.launch.orderKey).toBe(PACKAGE_A);
    expect(result.launch.commercialEventTarget.eventId).toBe(draft.event.id);
  });

  it('reuses B.3.1 linked-event navigation for cross-package events', () => {
    const origin = createApprovedOrigin();
    createLinkedRecoveryFromOrigin(DEV_A, origin.id, { recoveryPackageId: PACKAGE_B });
    const linkedOrigin = getCommercialEventById(DEV_A, origin.id);

    const navigation = resolveDevelopmentLinkedEventNavigation({
      developmentId: DEV_A,
      sourceEvent: linkedOrigin,
      packages: [packageRowA, packageRowB],
    });

    expect(navigation.ok).toBe(true);
    expect(navigation.kind).toBe('cross-package');
    expect(navigation.launch.orderKey).toBe(PACKAGE_B);
  });

  it('creates development commercial navigation snapshots for back restoration', () => {
    const draft = createCommercialEvent(DEV_A, basePayload());
    const snapshot = createDevelopmentCommercialNavigationSnapshot(draft.event.id);

    expect(snapshot.kind).toBe('development-commercial');
    expect(snapshot.developmentCommercialTarget.eventId).toBe(draft.event.id);
  });

  it('renders legacy and missing package data safely', () => {
    createCommercialEvent(
      DEV_A,
      basePayload({
        packageId: `${DEV_A}::missing::9999`,
        supplierId: null,
        costCode: '',
        linkedEventId: 'orphan-id',
        relationshipType: undefined,
        recoveryStatus: 'pending',
        eventType: COMMERCIAL_EVENT_TYPES.other.key,
      })
    );

    const row = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA])[0];
    expect(row.packageMissing).toBe(true);
    expect(row.supplierName).toBe('Unknown supplier');
    expect(row.linkedEventUnavailable).toBe(true);
  });

  it('does not mutate commercial events when building register data', () => {
    createCommercialEvent(DEV_A, basePayload());
    const before = JSON.stringify(listCommercialEventsByDevelopment(DEV_A));
    const writesBefore = setItemSpy.mock.calls.length;

    listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]);
    buildDevelopmentCommercialEventSummary(DEV_A, [packageRowA]);
    filterDevelopmentCommercialEventRows(
      listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]),
      { search: 'glazing' }
    );

    expect(JSON.stringify(listCommercialEventsByDevelopment(DEV_A))).toBe(before);
    expect(setItemSpy.mock.calls.length).toBe(writesBefore);
  });

  it('builds valid package options with canonical orderKey and display context', () => {
    const options = buildDevelopmentCommercialEventPackageOptions([
      packageRowA,
      packageRowB,
      { orderKey: PACKAGE_A, developmentId: DEV_A, supplierId: '', costCode: '0100' },
      { orderKey: 'orphan', developmentId: DEV_A, supplierId: 'sup-9', costCode: '' },
    ]);

    expect(options).toHaveLength(2);
    expect(options[0].orderKey).toBe(PACKAGE_A);
    expect(options[0].supplierLabel).toBe('Alpha Plumbing');
    expect(options[0].poNumbers).toEqual(['S0001']);
    expect(options[0].currentPackageValue).toBe(50000);
    expect(options[1].orderKey).toBe(PACKAGE_B);
  });

  it('excludes invalid package identities from development create options', () => {
    expect(
      isValidDevelopmentPackageIdentity({
        orderKey: PACKAGE_A,
        developmentId: DEV_A,
        supplierId: 'sup-1',
        costCode: '0100',
      })
    ).toBe(true);
    expect(
      isValidDevelopmentPackageIdentity({
        orderKey: '',
        developmentId: DEV_A,
        supplierId: 'sup-1',
        costCode: '0100',
      })
    ).toBe(false);
    expect(
      isValidDevelopmentPackageIdentity({
        orderKey: PACKAGE_A,
        developmentId: DEV_A,
        supplierId: 'sup-1',
        costCode: '',
      })
    ).toBe(false);
  });
});

describe('BL-021B.3.2 development register UI wiring', () => {
  it('uses CommercialEventDrawer in the development register component', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/CommercialEventDrawer/);
    expect(String(source.default)).not.toMatch(/delete/i);
  });

  it('shows recovery lifecycle separately from commercial status in both registers', async () => {
    const development = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    const packageRegister = await import('../components/PackageCommercialEvents.jsx?raw');
    expect(String(development.default)).toMatch(/RecoveryLifecycleBadge/);
    expect(String(packageRegister.default)).toMatch(/RecoveryLifecycleBadge/);
    expect(String(development.default)).toMatch(/presentationRecoveryStatus/);
    expect(String(packageRegister.default)).toMatch(/presentationRecoveryStatus/);
  });

  it('presents completed recovery facts without an abandonment action', async () => {
    const drawer = await import('../components/CommercialEventDrawer.jsx?raw');
    expect(String(drawer.default)).toMatch(/Recovery complete/);
    expect(String(drawer.default)).toMatch(/Recovery value/);
    expect(String(drawer.default)).toMatch(/Recovered to date/);
    expect(String(drawer.default)).toMatch(/!recoveryComplete/);
  });

  it('shows New Commercial Event on the development register', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/New Commercial Event/);
    expect(String(source.default)).toMatch(/openCreatePackagePicker/);
    expect(String(source.default)).toMatch(/buildDevelopmentCommercialEventPackageOptions/);
  });

  it('requires package selection before opening the create drawer', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/packagePickerOpen/);
    expect(String(source.default)).toMatch(/confirmPackageSelection/);
    expect(String(source.default)).toMatch(/Select the package this commercial event belongs to/);
  });

  it('opens the existing CommercialEventDrawer with selected package order', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/<CommercialEventDrawer/);
    expect(String(source.default)).toMatch(/createPackageOrder/);
    expect(String(source.default)).toMatch(/drawerMode === 'create'/);
  });

  it('persists created events against canonical package orderKey in both registers', () => {
    const draft = createCommercialEvent(
      DEV_A,
      basePayload({
        packageId: PACKAGE_A,
        description: 'Development register create',
      })
    );

    const developmentRows = listEnrichedDevelopmentCommercialEvents(DEV_A, [packageRowA]);
    const packageEvents = listCommercialEventsByPackage(DEV_A, PACKAGE_A);

    expect(draft.event.packageId).toBe(PACKAGE_A);
    expect(developmentRows).toHaveLength(1);
    expect(developmentRows[0].event.id).toBe(draft.event.id);
    expect(packageEvents).toHaveLength(1);
    expect(packageEvents[0].id).toBe(draft.event.id);
  });

  it('leaves package-level New Commercial Event flow unchanged', async () => {
    const source = await import('../components/PackageCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/New Commercial Event/);
    expect(String(source.default)).toMatch(/function openCreateDrawer/);
    expect(String(source.default)).not.toMatch(/packagePickerOpen/);
    expect(String(source.default)).not.toMatch(/buildDevelopmentCommercialEventPackageOptions/);
  });

  it('subscribes to commercial change notifications for refresh', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/subscribeCommercialChanged/);
  });

  it('opens drawer rows through selected event state', async () => {
    const source = await import('../components/DevelopmentCommercialEvents.jsx?raw');
    expect(String(source.default)).toMatch(/openEventDrawer/);
    expect(String(source.default)).toMatch(/setDrawerOpen\(true\)/);
  });

  it('refreshes register when commercial change notification fires', () => {
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

    const handler = vi.fn();
    const unsubscribe = subscribeCommercialChanged(handler);

    notifyCommercialChanged();
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
