import { describe, expect, it } from 'vitest';
import {
  buildPackageCommercialEventSummary,
  buildPackageCommercialEventSummaryForPackage,
  findLinkedCommercialEvents,
  resolveCurrentPackageValue,
} from './commercialEventPackageValue';
import {
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';

const PACKAGE_ID = 'dev-001::sup-1::0100';

function makeEvent(overrides = {}) {
  return {
    id: overrides.id || `ce-${Math.random()}`,
    packageId: PACKAGE_ID,
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    status: COMMERCIAL_EVENT_STATUSES.draft.key,
    value: 0,
    ...overrides,
  };
}

describe('commercialEventPackageValue', () => {
  it('preserves original order value for legacy packages with no events', () => {
    const summary = buildPackageCommercialEventSummary(125000, []);
    expect(summary.originalOrderValue).toBe(125000);
    expect(summary.currentPackageValue).toBe(125000);
    expect(summary.pendingEventValue).toBe(0);
    expect(summary.netCommercialEventMovement).toBe(0);
  });

  it('excludes pending events from current package value', () => {
    const events = [
      makeEvent({ status: COMMERCIAL_EVENT_STATUSES.draft.key, value: 10000 }),
      makeEvent({ status: COMMERCIAL_EVENT_STATUSES.submitted.key, value: 5000 }),
      makeEvent({ status: COMMERCIAL_EVENT_STATUSES.approved.key, value: 2500 }),
    ];

    const summary = buildPackageCommercialEventSummary(100000, events);
    expect(summary.pendingEventValue).toBe(15000);
    expect(summary.netCommercialEventMovement).toBe(2500);
    expect(summary.currentPackageValue).toBe(102500);
  });

  it('reconciles package value from original plus approved movement', () => {
    const events = [
      makeEvent({
        eventType: COMMERCIAL_EVENT_TYPES.variation.key,
        status: COMMERCIAL_EVENT_STATUSES.approved.key,
        value: 8000,
      }),
      makeEvent({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        status: COMMERCIAL_EVENT_STATUSES.approved.key,
        value: -3000,
      }),
      makeEvent({
        eventType: COMMERCIAL_EVENT_TYPES.credit.key,
        status: COMMERCIAL_EVENT_STATUSES.approved.key,
        value: -500,
      }),
      makeEvent({
        status: COMMERCIAL_EVENT_STATUSES.rejected.key,
        value: 99999,
      }),
    ];

    const summary = buildPackageCommercialEventSummary(50000, events);
    expect(summary.approvedVariationValue).toBe(8000);
    expect(summary.approvedContraChargeValue).toBe(-3000);
    expect(summary.approvedCreditValue).toBe(-500);
    expect(summary.netCommercialEventMovement).toBe(4500);
    expect(summary.currentPackageValue).toBe(54500);
  });

  it('includes closed and certificate statuses in committed movement', () => {
    const events = [
      makeEvent({
        status: COMMERCIAL_EVENT_STATUSES.includedInCertificate.key,
        value: 1000,
      }),
      makeEvent({ status: COMMERCIAL_EVENT_STATUSES.closed.key, value: 500 }),
    ];

    const summary = buildPackageCommercialEventSummary(20000, events);
    expect(summary.currentPackageValue).toBe(21500);
  });

  it('filters events by package when calculating summary', () => {
    const events = [
      makeEvent({ packageId: PACKAGE_ID, status: COMMERCIAL_EVENT_STATUSES.approved.key, value: 1000 }),
      makeEvent({
        id: 'other',
        packageId: 'other-package',
        status: COMMERCIAL_EVENT_STATUSES.approved.key,
        value: 9000,
      }),
    ];

    const summary = buildPackageCommercialEventSummaryForPackage(10000, events, PACKAGE_ID);
    expect(summary.currentPackageValue).toBe(11000);
  });

  it('reduces package value when an approved contra charge is negative', () => {
    const events = [
      makeEvent({
        eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
        status: COMMERCIAL_EVENT_STATUSES.approved.key,
        value: -7500,
      }),
    ];

    expect(resolveCurrentPackageValue(60000, events, PACKAGE_ID)).toBe(52500);
  });

  it('finds linked event groups through linkedEventId', () => {
    const rectifying = makeEvent({ id: 'rect-1', value: 4000 });
    const contra = makeEvent({
      id: 'contra-1',
      linkedEventId: 'rect-1',
      value: -4000,
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
    });

    const linked = findLinkedCommercialEvents([rectifying, contra], 'rect-1');
    expect(linked).toHaveLength(2);
    expect(linked.map((event) => event.id).sort()).toEqual(['contra-1', 'rect-1']);
  });
});
