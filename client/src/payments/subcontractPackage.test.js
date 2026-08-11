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
import { COMMERCIAL_EVENT_FINANCIAL_TREATMENTS } from '../commercialEvents/commercialEventFinancialTreatment';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import {
  SubcontractPackageDashboard,
} from '../components/SubcontractPackageOverview';
import {
  approveCertificate,
  createCertificate,
  submitCertificate,
} from './paymentCertificateStore';
import { ensurePackageRecord } from './subcontractPackageStore';
import { calculatePackageCertifiedValue } from '../cvr/cvrCertifiedValue';
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

function approveCertGross(gross, net = gross * 1.14) {
  const created = createCertificate(ORDER_KEY, baseOrder);
  submitCertificate(ORDER_KEY, created.certificate.id);
  approveCertificate(ORDER_KEY, created.certificate.id, {
    grossThisCertificate: gross,
    netPayment: net,
  });
}

describe('buildPackageViewModel commercial display fields', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
    ensurePackageRecord(ORDER_KEY, baseOrder);
  });

  it('increases current package value for a positive approved event', () => {
    const draft = seedEvent({ value: 2000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.originalOrderValue).toBe(12000);
    expect(pkg.originalPoCommitment).toBe(12000);
    expect(pkg.approvedCommercialMovement).toBe(2000);
    expect(pkg.currentContractValue).toBe(14000);
    expect(pkg.currentPackageValue).toBe(14000);
    expect(pkg.adjustedContract).toBe(14000);
  });

  it('reduces current package value for an approved contract amendment contra', () => {
    const draft = seedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      value: -1500,
      description: 'Contra charge',
      financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.contractAmendment.key,
    });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.approvedCommercialMovement).toBe(-1500);
    expect(pkg.currentContractValue).toBe(10500);
  });

  it('shows pending events separately from current contract value', () => {
    const approved = seedEvent({ value: 1000, description: 'Approved scope' });
    submitCommercialEvent(DEV_ID, approved.id);
    approveCommercialEvent(DEV_ID, approved.id);
    seedEvent({
      value: 500,
      description: 'Pending scope',
    });

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.pendingCommercialMovement).toBe(500);
    expect(pkg.currentContractValue).toBe(13000);
  });

  it('ignores rejected events for approved movement and current value', () => {
    const draft = seedEvent({ value: 9000, description: 'Rejected scope' });
    submitCommercialEvent(DEV_ID, draft.id);
    rejectCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.approvedCommercialMovement).toBe(0);
    expect(pkg.currentContractValue).toBe(12000);
    expect(pkg.pendingCommercialMovement).toBe(0);
  });

  it('aliases legacy fields to canonical BL-025.1 values', () => {
    const draft = seedEvent({ value: 3000 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.adjustedContract).toBe(pkg.currentContractValue);
    expect(pkg.approvedVariations).toBe(pkg.approvedCommercialMovement);
    expect(pkg.certifiedToDate).toBe(pkg.certifiedGrossToDate);
    expect(pkg.overallProgress).toBe(pkg.commercialProgressPct);
  });

  it('preserves legacy package display when no commercial events exist', () => {
    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.originalOrderValue).toBe(12000);
    expect(pkg.approvedCommercialMovement).toBe(0);
    expect(pkg.currentContractValue).toBe(12000);
    expect(pkg.pendingCommercialMovement).toBe(0);
    expect(pkg.certifiedGrossToDate).toBe(0);
    expect(pkg.certifiedNetPaymentToDate).toBe(0);
    expect(pkg.remainingContractValue).toBe(12000);
  });

  it('feeds canonical fields to the package dashboard', () => {
    const draft = seedEvent({ value: 2500 });
    submitCommercialEvent(DEV_ID, draft.id);
    approveCommercialEvent(DEV_ID, draft.id);

    const pkg = buildPackageViewModel(baseOrder);
    const dashboard = SubcontractPackageDashboard({ pkg });
    const labels = findTextContent(dashboard).join(' ');

    expect(labels).toContain('Original order');
    expect(labels).toContain('Approved events');
    expect(labels).toContain('Current contract');
    expect(labels).toContain('Certified gross');
    expect(labels).toContain('Remaining');
    expect(labels).toContain('+£2.5k');
    expect(labels).not.toContain('Approved variations');
  });
});

describe('BL-025.1 canonical package value and certified totals', () => {
  beforeEach(() => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');
  });

  const po100Order = {
    orderKey: 'dev-bl25::sup-1::brick',
    developmentId: 'dev-bl25',
    supplierId: 'sup-1',
    costCode: 'brick',
    supplierLabel: 'BrickCo',
    projectLabel: 'BL-025 Site',
    committedValue: 100000,
    poNumbers: ['S100'],
    pos: [],
  };

  function approveVariation(value) {
    ensurePackageRecord(po100Order.orderKey, po100Order);
    const event = createCommercialEvent('dev-bl25', {
      packageId: po100Order.orderKey,
      poNumber: 'S100',
      supplierId: 'sup-1',
      costCode: 'brick',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Approved variation',
      value,
    }).event;
    submitCommercialEvent('dev-bl25', event.id);
    approveCommercialEvent('dev-bl25', event.id);
  }

  it('does not add approved CE value to certified gross (no double counting)', () => {
    ensurePackageRecord(po100Order.orderKey, po100Order);
    approveVariation(10000);

    const created = createCertificate(po100Order.orderKey, po100Order);
    submitCertificate(po100Order.orderKey, created.certificate.id);
    approveCertificate(po100Order.orderKey, created.certificate.id, {
      grossThisCertificate: 40000,
      netPayment: 45600,
    });

    const pkg = buildPackageViewModel(po100Order);
    expect(pkg.originalOrderValue).toBe(100000);
    expect(pkg.approvedCommercialMovement).toBe(10000);
    expect(pkg.currentContractValue).toBe(110000);
    expect(pkg.certifiedGrossToDate).toBe(40000);
    expect(pkg.certifiedNetPaymentToDate).toBe(45600);
    expect(pkg.remainingContractValue).toBe(70000);
    expect(pkg.commercialProgressPct).toBe(36);
  });

  it('reduces current contract for approved credit without affecting certified gross', () => {
    ensurePackageRecord(po100Order.orderKey, po100Order);
    const credit = createCommercialEvent('dev-bl25', {
      packageId: po100Order.orderKey,
      poNumber: 'S100',
      supplierId: 'sup-1',
      costCode: 'brick',
      eventType: COMMERCIAL_EVENT_TYPES.credit.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Credit note',
      value: -5000,
    }).event;
    submitCommercialEvent('dev-bl25', credit.id);
    approveCommercialEvent('dev-bl25', credit.id);

    const pkg = buildPackageViewModel(po100Order);
    expect(pkg.currentContractValue).toBe(95000);
    expect(pkg.certifiedGrossToDate).toBe(0);
    expect(pkg.remainingContractValue).toBe(95000);
  });

  it('sums multiple approved certificate gross values', () => {
    ensurePackageRecord(po100Order.orderKey, po100Order);
    approveCertGross(25000, 28000);
    approveCertGross(15000, 16800);

    const pkg = buildPackageViewModel({ ...baseOrder, orderKey: ORDER_KEY });
    expect(pkg.certifiedGrossToDate).toBe(40000);
    expect(pkg.certifiedNetPaymentToDate).toBe(44800);
  });

  it('does not mutate source order committedValue', () => {
    ensurePackageRecord(po100Order.orderKey, po100Order);
    approveVariation(5000);
    buildPackageViewModel(po100Order);
    expect(po100Order.committedValue).toBe(100000);
  });

  it('leaves CVR calculatePackageCertifiedValue net-preferred semantics unchanged', () => {
    ensurePackageRecord(ORDER_KEY, baseOrder);
    approveCertGross(40000, 45600);
    expect(calculatePackageCertifiedValue(ORDER_KEY)).toBe(45600);
    const pkg = buildPackageViewModel(baseOrder);
    expect(pkg.certifiedGrossToDate).toBe(40000);
    expect(pkg.certifiedGrossToDate).not.toBe(calculatePackageCertifiedValue(ORDER_KEY));
  });

  it('handles zero current contract value without dividing by zero', () => {
    const zeroOrder = {
      ...baseOrder,
      orderKey: 'dev-zero::sup-1::000',
      committedValue: 0,
    };
    ensurePackageRecord(zeroOrder.orderKey, zeroOrder);
    const pkg = buildPackageViewModel(zeroOrder);
    expect(pkg.currentContractValue).toBe(0);
    expect(pkg.commercialProgressPct).toBe(0);
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
  if (element == null || typeof element === 'boolean') return [];
  if (typeof element === 'string' || typeof element === 'number') {
    return [String(element)];
  }
  if (Array.isArray(element)) {
    return element.flatMap(findTextContent);
  }
  return findTextContent(element.props?.children);
}
