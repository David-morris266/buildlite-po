import { beforeEach, describe, expect, it } from 'vitest';
import {
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_TYPES,
} from './commercialEventTypes';
import {
  isCommercialEventCertifiable,
  getCommercialEventCertifiabilityReason,
} from './commercialEventCertifiability';

function makeEvent(overrides = {}) {
  return {
    id: 'ce-1',
    eventNumber: 'CE-0001',
    packageId: 'dev-001::sup-1::0120',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    status: 'approved',
    value: 10000,
    description: 'Test event',
    ...overrides,
  };
}

describe('commercialEventCertifiability', () => {
  it('allows approved variation events', () => {
    expect(isCommercialEventCertifiable(makeEvent())).toBe(true);
  });

  it('allows approved credit events', () => {
    expect(
      isCommercialEventCertifiable(
        makeEvent({ eventType: COMMERCIAL_EVENT_TYPES.credit.key, value: -5000 })
      )
    ).toBe(true);
  });

  it('allows approved sales upgrade events', () => {
    expect(
      isCommercialEventCertifiable(
        makeEvent({ eventType: COMMERCIAL_EVENT_TYPES.salesUpgrade.key })
      )
    ).toBe(true);
  });

  it('excludes draft events', () => {
    expect(isCommercialEventCertifiable(makeEvent({ status: 'draft' }))).toBe(false);
  });

  it('excludes submitted events', () => {
    expect(isCommercialEventCertifiable(makeEvent({ status: 'submitted' }))).toBe(false);
  });

  it('excludes budget transfer events', () => {
    expect(
      isCommercialEventCertifiable(
        makeEvent({ eventType: COMMERCIAL_EVENT_TYPES.budgetTransfer.key })
      )
    ).toBe(false);
  });

  it('excludes recovery relationship events', () => {
    expect(
      isCommercialEventCertifiable(
        makeEvent({
          relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
        })
      )
    ).toBe(false);
  });

  it('excludes potential contra charge origins', () => {
    expect(
      isCommercialEventCertifiable(
        makeEvent({ potentialContraCharge: true })
      )
    ).toBe(false);
  });

  it('returns a readable reason for excluded events', () => {
    expect(getCommercialEventCertifiabilityReason(makeEvent({ status: 'draft' }))).toMatch(
      /approved/i
    );
  });
});
