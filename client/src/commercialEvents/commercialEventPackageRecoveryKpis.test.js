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
  listCommercialEventsByPackage,
  submitCommercialEvent,
  updateRecoveryStatus,
} from './commercialEventStore';
import {
  buildPackageRecoverySummary,
  buildPackageRecoverySummaryForPackage,
  buildPackageRecoverySummaryFromOrder,
  countOpenRecoveryItems,
  sumTotalContraCharges,
} from './commercialEventPackageRecoveryKpis';
import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import { buildPackageViewModel } from '../payments/subcontractPackage';
import {
  PackageRecoveryPosition,
  SubcontractPackageDashboard,
} from '../components/SubcontractPackageOverview';
import {
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

const DEV_ID = 'dev-recovery-kpi';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;

const baseOrder = {
  orderKey: PACKAGE_B,
  developmentId: DEV_ID,
  supplierId: 'sup-2',
  costCode: '0200',
  supplierLabel: 'Beta Brickwork',
  projectLabel: 'Oakwood',
  committedValue: 40000,
  certifiedToDate: 0,
  poNumbers: ['S0002'],
  pos: [],
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
    description: 'Origin scope change',
    value: 5000,
    dateRaised: '2026-01-15',
    ...overrides,
  };
}

function createApprovedOrigin(overrides = {}) {
  const draft = createCommercialEvent(
    DEV_ID,
    basePayload({
      potentialContraCharge: true,
      potentialContraChargeNotes: 'Recover from brickwork',
      ...overrides,
    })
  );
  submitCommercialEvent(DEV_ID, draft.event.id);
  approveCommercialEvent(DEV_ID, draft.event.id);
  return getCommercialEventById(DEV_ID, draft.event.id);
}

function createApprovedRecoveryOnPackage(packageId, originOverrides = {}) {
  const origin = createApprovedOrigin(originOverrides);
  const linked = createLinkedRecoveryFromOrigin(DEV_ID, origin.id, {
    recoveryPackageId: packageId,
  });
  submitCommercialEvent(DEV_ID, linked.recovery.id);
  approveCommercialEvent(DEV_ID, linked.recovery.id);
  return getCommercialEventById(DEV_ID, linked.recovery.id);
}

describe('BL-021B.3.3 package recovery KPIs', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('includes approved contra charge in total contra charges', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const events = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);
    const summary = buildPackageRecoverySummary(events);

    expect(sumTotalContraCharges(events)).toBe(3800);
    expect(summary.totalContraCharges).toBe(3800);
  });

  it('does not count origin events as recoveries', () => {
    createApprovedOrigin({ value: 4200 });

    const packageAEvents = listCommercialEventsByPackage(DEV_ID, PACKAGE_A);
    const summary = buildPackageRecoverySummary(packageAEvents);

    expect(summary.hasRecoveries).toBe(false);
    expect(summary.totalContraCharges).toBe(0);
    expect(summary.outstandingRecoveries).toBe(0);
  });

  it('calculates outstanding as abs(value) minus recoveredAmount for active statuses', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 5000 });
    const [recovery] = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);

    updateRecoveryStatus(
      DEV_ID,
      recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 1200 }
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(summary.outstandingRecoveries).toBe(3800);
  });

  it('calculates partial recovery correctly', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 2500 });
    const [recovery] = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);

    updateRecoveryStatus(
      DEV_ID,
      recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 1000 }
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(summary.recoveredValue).toBe(1000);
    expect(summary.outstandingRecoveries).toBe(1500);
    expect(summary.partiallyRecoveredCount).toBe(1);
  });

  it('reports zero outstanding for fully recovered items', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 1800 });
    const [recovery] = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);

    updateRecoveryStatus(
      DEV_ID,
      recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
      { recoveredAmount: 1800 }
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(summary.outstandingRecoveries).toBe(0);
    expect(summary.recoveredValue).toBe(1800);
    expect(summary.fullyRecoveredCount).toBe(1);
  });

  it('reports written-off value separately', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3000 });
    const [recovery] = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);

    updateRecoveryStatus(
      DEV_ID,
      recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.partiallyRecovered.key,
      { recoveredAmount: 500 }
    );
    updateRecoveryStatus(
      DEV_ID,
      recovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.writtenOff.key,
      { recoveredAmount: 500 }
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(summary.writtenOff).toBe(2500);
    expect(summary.recoveredValue).toBe(500);
  });

  it('excludes terminal recovery states from open item count', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 1000, description: 'Open one' });
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 2000, description: 'Closed one' });

    const events = listCommercialEventsByPackage(DEV_ID, PACKAGE_B);
    const closedRecovery = events.find(
      (event) => event.description === 'Closed one'
    );
    updateRecoveryStatus(
      DEV_ID,
      closedRecovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.fullyRecovered.key,
      { recoveredAmount: 2000 }
    );
    updateRecoveryStatus(
      DEV_ID,
      closedRecovery.id,
      COMMERCIAL_EVENT_RECOVERY_STATUSES.closed.key,
      { recoveredAmount: 2000 }
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(countOpenRecoveryItems(listCommercialEventsByPackage(DEV_ID, PACKAGE_B))).toBe(
      1
    );
    expect(summary.openRecoveryItems).toBe(1);
  });

  it('aggregates multiple recoveries correctly', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800, description: 'Recovery A' });
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 2200, description: 'Recovery B' });

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_B)
    );
    expect(summary.totalContraCharges).toBe(6000);
    expect(summary.outstandingRecoveries).toBe(6000);
    expect(summary.openRecoveryItems).toBe(2);
  });

  it('handles legacy events without relationshipType safely', () => {
    createCommercialEvent(
      DEV_ID,
      basePayload({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        value: -900,
        description: 'Legacy contra',
        linkedEventId: 'legacy-linked-ref',
      })
    );

    const summary = buildPackageRecoverySummary(
      listCommercialEventsByPackage(DEV_ID, PACKAGE_A)
    );
    expect(summary.hasRecoveries).toBe(false);
    expect(summary.totalContraCharges).toBe(0);
  });

  it('returns empty summary for packages with no recoveries', () => {
    createCommercialEvent(DEV_ID, basePayload({ description: 'Plain variation' }));

    const summary = buildPackageRecoverySummaryForPackage(DEV_ID, PACKAGE_A);
    expect(summary.hasRecoveries).toBe(false);
    expect(summary.totalContraCharges).toBe(0);
    expect(summary.outstandingRecoveries).toBe(0);
    expect(summary.recoveredValue).toBe(0);
    expect(summary.openRecoveryItems).toBe(0);
    expect(summary.writtenOff).toBe(0);
  });

  it('builds summary from order via package store lookup', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const summary = buildPackageRecoverySummaryFromOrder(baseOrder);
    expect(summary.totalContraCharges).toBe(3800);
    expect(summary.outstandingRecoveries).toBe(3800);
  });

  it('feeds recovery summary through buildPackageViewModel for overview display', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.recoverySummary.totalContraCharges).toBe(3800);

    const section = PackageRecoveryPosition({ summary: pkg.recoverySummary });
    const text = findTextContent(section).join(' ');
    expect(text).toContain('Recovery Position');
    expect(text).toContain('Outstanding');
    expect(text).toContain('£3.8k');
    expect(text).toContain('Recovery records open');
  });

  it('does not change current package value when recovery KPIs are calculated', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const before = buildPackageCommercialDisplayFields(baseOrder);
    buildPackageRecoverySummaryFromOrder(baseOrder);
    const after = buildPackageCommercialDisplayFields(baseOrder);

    expect(after.currentPackageValue).toBe(before.currentPackageValue);
    expect(after.currentPackageValue).toBe(40000);
  });

  it('does not change payment certificate contract fields on the package view model', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.adjustedContract).toBe(pkg.currentContractValue);
    expect(pkg.currentContractValue).toBe(40000);
    expect(pkg.approvedCommercialMovement).toBe(0);
    expect(pkg.committedValue).toBe(40000);
  });

  it('does not change CVR source order committedValue', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    buildPackageRecoverySummaryFromOrder(baseOrder);
    buildPackageViewModel(baseOrder);

    expect(baseOrder.committedValue).toBe(40000);
  });

  it('shows quiet empty state when package has no recoveries', () => {
    const section = PackageRecoveryPosition({
      summary: buildPackageRecoverySummary([]),
    });
    const text = findTextContent(section).join(' ');
    expect(text).toContain('No recovery or contra charge events');
    expect(text).not.toContain('£0');
  });

  it('leaves core package dashboard KPIs unchanged', () => {
    createApprovedRecoveryOnPackage(PACKAGE_B, { value: 3800 });

    const pkg = buildPackageViewModel(baseOrder);
    const dashboard = SubcontractPackageDashboard({ pkg, compact: false });
    const labels = findTextContent(dashboard).join(' ');

    expect(labels).toContain('Current contract');
    expect(labels).toContain('£40k');
    expect(labels).toContain('Approved events');
    expect(labels).toContain('£0');
  });
});

function findTextContent(element) {
  if (element == null || typeof element === 'boolean') return [];
  if (typeof element === 'string' || typeof element === 'number') {
    return [String(element)];
  }
  if (Array.isArray(element)) {
    return element.flatMap(findTextContent);
  }
  return findTextContent(element.props?.children);
}
