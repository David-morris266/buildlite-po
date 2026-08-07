import { describe, expect, it, vi } from 'vitest';
import {
  buildAssistantPackageOrderKeys,
  buildAssistantPackagesForDevelopment,
  buildAssistantScopeFromOrder,
  resolveOrderDevelopmentId,
} from './commercialAssistantPackageScope';
import { buildCertificateRecommendations, CERTIFICATE_RULE_ID } from './certificateRecommendationProvider';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  createLinkedRecoveryFromOrigin,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { COMMERCIAL_EVENT_TYPES } from '../commercialEvents/commercialEventTypes';
import { saveCompanySettings } from '../admin/companyStore';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

const DEV_ID = 'dev-scope';
const PACKAGE_A = `${DEV_ID}::sup-1::0100`;
const PACKAGE_B = `${DEV_ID}::sup-2::0200`;
const OTHER_DEV = 'dev-other::sup-9::0900';

const orderA = {
  orderKey: PACKAGE_A,
  developmentId: DEV_ID,
  supplierId: 'sup-1',
  costCode: '0100',
  supplierLabel: 'Alpha',
};

describe('commercialAssistantPackageScope', () => {
  it('resolves developmentId from canonical order fields', () => {
    expect(resolveOrderDevelopmentId(orderA)).toBe(DEV_ID);
    expect(resolveOrderDevelopmentId({ orderKey: PACKAGE_A, scopeId: DEV_ID })).toBe(DEV_ID);
    expect(resolveOrderDevelopmentId({ orderKey: 'missing-development' })).toBeNull();
  });

  it('filters package rows to a development', () => {
    const packages = [
      orderA,
      { orderKey: PACKAGE_B, developmentId: DEV_ID },
      { orderKey: OTHER_DEV, developmentId: 'dev-other' },
    ];

    expect(buildAssistantPackagesForDevelopment(DEV_ID, packages)).toHaveLength(2);
    expect(buildAssistantPackagesForDevelopment(DEV_ID, packages).map((row) => row.orderKey)).toEqual(
      [PACKAGE_A, PACKAGE_B]
    );
  });

  it('builds assistant scope from the current package order', () => {
    const scope = buildAssistantScopeFromOrder(orderA, {
      developmentPackages: [orderA, { orderKey: PACKAGE_B, developmentId: DEV_ID }],
    });

    expect(scope.developmentId).toBe(DEV_ID);
    expect(scope.packages).toHaveLength(2);
  });

  it('falls back to the current order when no development package list is supplied', () => {
    const scope = buildAssistantScopeFromOrder(orderA);
    expect(scope.packages).toEqual([orderA]);
  });

  it('builds stable package order keys for scope comparison', () => {
    expect(
      buildAssistantPackageOrderKeys([
        { orderKey: PACKAGE_B },
        { orderKey: PACKAGE_A },
      ])
    ).toBe(`${PACKAGE_A}|${PACKAGE_B}`);
  });

  it('returns identical recommendations when standalone scope uses the same development package list', () => {
    storage.clear();
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test Manager');

    const packages = [orderA, { orderKey: PACKAGE_B, developmentId: DEV_ID }];
    const draft = createCommercialEvent(DEV_ID, {
      packageId: PACKAGE_A,
      poNumber: 'PO-1',
      supplierId: 'sup-1',
      costCode: '0100',
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      category: 'commercial',
      subcategory: 'scopeChange',
      responsibility: 'commercial',
      description: 'Origin',
      value: 3800,
      dateRaised: '2026-01-15',
      potentialContraCharge: true,
    });
    submitCommercialEvent(DEV_ID, draft.event.id);
    approveCommercialEvent(DEV_ID, draft.event.id);
    const linked = createLinkedRecoveryFromOrigin(DEV_ID, draft.event.id, {
      recoveryPackageId: PACKAGE_B,
    });
    expect(linked.ok).toBe(true);
    submitCommercialEvent(DEV_ID, linked.recovery.id);
    approveCommercialEvent(DEV_ID, linked.recovery.id);

    const developmentContext = buildAssistantScopeFromOrder(orderA, { developmentPackages: packages });
    const recommendations = buildCertificateRecommendations(developmentContext);

    expect(
      recommendations.some((item) => item.ruleId === CERTIFICATE_RULE_ID.outstandingRecovery)
    ).toBe(true);
    expect(buildCertificateRecommendations(developmentContext).map((item) => item.fingerprint)).toEqual(
      recommendations.map((item) => item.fingerprint)
    );
  });
});
