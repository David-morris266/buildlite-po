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
  rejectCommercialEvent,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import {
  COMMERCIAL_EVENT_TYPES,
} from '../commercialEvents/commercialEventTypes';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  SubcontractPackageDashboard,
} from '../components/SubcontractPackageOverview';
import { buildPackageViewModel } from '../payments/subcontractPackage';

const DEV_ID = 'dev-001';
const ORDER_KEY = 'dev-001::sup-1::0120';

const baseOrder = {
  orderKey: ORDER_KEY,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0120',
  supplierLabel: 'PlumbCo',
  projectLabel: 'Test Site 1',
  committedValue: 12000,
  certifiedToDate: 0,
  poNumbers: ['S0004'],
  pos: [],
};

function seedEvent(overrides = {}) {
  const created = createCommercialEvent(DEV_ID, {
    packageId: ORDER_KEY,
    poNumber: 'S0004',
    supplierId: 'sup-1',
    costCode: '0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Scope change',
    value: 2000,
    ...overrides,
  });
  return created.event;
}

describe('buildPackageViewModel commercial display fields', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  it('increases current package value for a positive approved event', () => {
    const draft = seedEvent({ value: 2000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.originalPoCommitment).toBe(12000);
    expect(pkg.approvedCommercialEventMovement).toBe(2000);
    expect(pkg.currentPackageValue).toBe(14000);
    expect(pkg.adjustedContract).toBe(12000);
  });

  it('reduces current package value for an approved contra charge', () => {
    const draft = seedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      value: -1500,
      description: 'Contra charge',
    });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.approvedCommercialEventMovement).toBe(-1500);
    expect(pkg.currentPackageValue).toBe(10500);
  });

  it('shows pending events separately from current package value', () => {
    const approved = seedEvent({ value: 1000, description: 'Approved scope' });
    submitCommercialEvent(DEV_ID, approved.id);
    approveCommercialEvent(DEV_ID, approved.id);
    seedEvent({
      value: 500,
      description: 'Pending scope',
    });

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.pendingCommercialEventValue).toBe(500);
    expect(pkg.currentPackageValue).toBe(13000);
  });

  it('ignores rejected events for approved movement and current value', () => {
    const draft = seedEvent({ value: 9000, description: 'Rejected scope' });
    submitCommercialEvent(DEV_ID, draft.id);
    rejectCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.approvedCommercialEventMovement).toBe(0);
    expect(pkg.currentPackageValue).toBe(12000);
    expect(pkg.pendingCommercialEventValue).toBe(0);
  });

  it('leaves certificate-facing adjustedContract unchanged', () => {
    const draft = seedEvent({ value: 3000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.adjustedContract).toBe(12000);
    expect(pkg.approvedVariations).toBe(0);
  });

  it('preserves legacy package display when no commercial events exist', () => {
    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.originalPoCommitment).toBe(12000);
    expect(pkg.approvedCommercialEventMovement).toBe(0);
    expect(pkg.currentPackageValue).toBe(12000);
    expect(pkg.pendingCommercialEventValue).toBe(0);
  });

  it('feeds event-adjusted fields to the package dashboard without hard-coded zero', () => {
    const draft = seedEvent({ value: 2500 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    const dashboard = SubcontractPackageDashboard({ pkg });
    const labels = findTextContent(dashboard).join(' ');

    expect(labels).toContain('Original PO commitment');
    expect(labels).toContain('Approved commercial events');
    expect(labels).toContain('Current package value');
    expect(labels).toContain('+£2.5k');
    expect(labels).not.toContain('Approved variations');
  });
});

describe('buildPackageCommercialDisplayFields for Developments packages table', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
  });

  it('shows original PO commitment, approved movement and current package value', () => {
    const draft = seedEvent({ value: 2000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const display = buildPackageCommercialDisplayFields(baseOrder);
    expect(display.originalPoCommitment).toBe(12000);
    expect(display.approvedCommercialEventMovement).toBe(2000);
    expect(display.currentPackageValue).toBe(14000);
  });
});

describe('CVR commitment remains PO-only', () => {
  it('does not mutate source order committedValue used by CVR paths', () => {
    const draft = seedEvent({ value: 5000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    buildPackageViewModel(baseOrder);

    expect(baseOrder.committedValue).toBe(12000);
  });
});

function findTextContent(element) {
  if (!element) return [];
  const parts = [];
  if (typeof element === 'string' || typeof element === 'number') {
    parts.push(String(element));
  }
  const children = Array.isArray(element?.props?.children)
    ? element.props.children
    : element?.props?.children != null
      ? [element.props.children]
      : [];
  for (const child of children) {
    parts.push(...findTextContent(child));
  }
  return parts;
}
