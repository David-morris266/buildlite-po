import { describe, expect, it } from 'vitest';
import {
  effectiveExpectedLiability,
  enrichExpectedLiabilityReadModel,
  potentialLiability,
  validateExpectedLiabilityIntent,
} from './commercialEventExpectedLiability';
import { COMMERCIAL_EVENT_STATUSES } from './commercialEventTypes';

function event(overrides = {}) {
  return {
    id: 'ce-1',
    eventType: 'variation',
    financialTreatment: 'contractAmendment',
    relationshipType: null,
    status: COMMERCIAL_EVENT_STATUSES.submitted.key,
    value: 20000,
    expectedTreatment: 'default',
    ...overrides,
  };
}

describe('commercialEventExpectedLiability', () => {
  it('draft expected is 0', () => {
    const draft = event({ status: COMMERCIAL_EVENT_STATUSES.draft.key });
    expect(effectiveExpectedLiability(draft)).toBe(0);
    expect(potentialLiability(draft)).toBe(0);
  });

  it('submitted default equals CE value', () => {
    expect(effectiveExpectedLiability(event())).toBe(20000);
  });

  it('override above submitted warns but is allowed', () => {
    const ce = event({
      expectedTreatment: 'override',
      expectedAmount: 25000,
      expectedReason: 'Extra instruction',
    });
    const read = enrichExpectedLiabilityReadModel(ce);
    expect(read.expectedLiability).toBe(25000);
    expect(read.warningAboveSubmitted).toBe(true);
  });

  it('hold and exclude are 0', () => {
    expect(
      effectiveExpectedLiability(event({ expectedTreatment: 'hold', expectedReason: 'Wait' }))
    ).toBe(0);
    expect(
      effectiveExpectedLiability(event({ expectedTreatment: 'exclude', expectedReason: 'Out' }))
    ).toBe(0);
  });

  it('recovery is not eligible', () => {
    expect(
      validateExpectedLiabilityIntent(
        { treatment: 'override', expectedAmount: 1, reason: 'x' },
        event({ financialTreatment: 'recoverableDeduction' })
      ).ok
    ).toBe(false);
  });
});
