/**
 * BL-038B — Pure CE expected-liability derivation (HD-001 / HD-038).
 * Client mirror of server/services/commercialEventExpectedLiability.js.
 * Does not write CVR money. BL-038C consumes the derived value in the CVR engine.
 */

import { COMMERCIAL_EVENT_RELATIONSHIP_TYPES, COMMERCIAL_EVENT_STATUSES } from './commercialEventTypes';

export const EXPECTED_LIABILITY_TREATMENTS = Object.freeze({
  default: 'default',
  override: 'override',
  hold: 'hold',
  exclude: 'exclude',
});

export const EXPECTED_LIABILITY_AUDIT_ACTION = 'EXPECTED_LIABILITY_CHANGED';

export const EXPECTED_LIABILITY_TREATMENT_OPTIONS = [
  { key: 'default', label: 'Default — full submitted value' },
  { key: 'override', label: 'Override' },
  { key: 'hold', label: 'Hold' },
  { key: 'exclude', label: 'Exclude' },
];

export function roundMoney(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function parseTreatment(value) {
  const key = String(value || '').trim();
  return EXPECTED_LIABILITY_TREATMENTS[key] || null;
}

export function normalizeTreatment(value) {
  return parseTreatment(value) || EXPECTED_LIABILITY_TREATMENTS.default;
}

function statusKey(event) {
  return event?.status?.key || event?.status || null;
}

export function isEligibleContractValueEvent(event) {
  if (!event) return false;
  if (event.relationshipType === COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key) {
    return false;
  }
  if (event.financialTreatment === 'recoverableDeduction') {
    return false;
  }
  return true;
}

export function isExpectedTreatmentEditable(event) {
  return (
    isEligibleContractValueEvent(event) &&
    statusKey(event) === COMMERCIAL_EVENT_STATUSES.submitted.key
  );
}

function storedOverrideAmount(event) {
  if (normalizeTreatment(event?.expectedTreatment) !== EXPECTED_LIABILITY_TREATMENTS.override) {
    return null;
  }
  return roundMoney(event?.expectedAmount);
}

export function potentialLiability(event) {
  if (!isEligibleContractValueEvent(event)) return 0;
  if (statusKey(event) !== COMMERCIAL_EVENT_STATUSES.submitted.key) return 0;
  return roundMoney(event.value) ?? 0;
}

export function effectiveExpectedLiability(event) {
  if (!isEligibleContractValueEvent(event)) return 0;
  if (statusKey(event) !== COMMERCIAL_EVENT_STATUSES.submitted.key) return 0;

  const treatment = normalizeTreatment(event.expectedTreatment);
  if (
    treatment === EXPECTED_LIABILITY_TREATMENTS.hold ||
    treatment === EXPECTED_LIABILITY_TREATMENTS.exclude
  ) {
    return 0;
  }
  if (treatment === EXPECTED_LIABILITY_TREATMENTS.override) {
    return roundMoney(event.expectedAmount) ?? 0;
  }
  return roundMoney(event.value) ?? 0;
}

export function expectedExceedsSubmitted(event, expectedValue = null) {
  if (!isEligibleContractValueEvent(event)) return false;
  if (statusKey(event) !== COMMERCIAL_EVENT_STATUSES.submitted.key) return false;
  const submitted = roundMoney(event.value) ?? 0;
  const expected =
    expectedValue != null ? roundMoney(expectedValue) : effectiveExpectedLiability(event);
  if (expected == null) return false;
  return expected > submitted + 0.005;
}

export function enrichExpectedLiabilityReadModel(event = {}) {
  const treatment = normalizeTreatment(event.expectedTreatment);
  const expectedLiability = effectiveExpectedLiability(event);
  const potential = potentialLiability(event);
  const editable = isExpectedTreatmentEditable(event);
  const isDefaultTreatment = treatment === EXPECTED_LIABILITY_TREATMENTS.default;
  const requiresReason = !isDefaultTreatment;
  const warningAboveSubmitted = expectedExceedsSubmitted(event, expectedLiability);

  return {
    ...event,
    expectedTreatment: treatment,
    expectedAmount:
      treatment === EXPECTED_LIABILITY_TREATMENTS.override
        ? storedOverrideAmount({ ...event, expectedTreatment: treatment })
        : null,
    expectedReason: isDefaultTreatment ? null : String(event.expectedReason || '').trim() || null,
    expectedUpdatedAt: event.expectedUpdatedAt ?? null,
    expectedUpdatedBy: event.expectedUpdatedBy ?? null,
    potentialLiability: potential,
    expectedLiability,
    effectiveExpectedLiability: expectedLiability,
    isDefaultTreatment,
    isExpectedTreatmentEditable: editable,
    canEditExpectedLiability: editable,
    requiresReason,
    warningAboveSubmitted,
    expectedWarning: warningAboveSubmitted ? 'above_submitted' : null,
  };
}

export function validateExpectedLiabilityIntent(body = {}, event) {
  const errors = [];
  if (!event) {
    return { ok: false, errors: ['Commercial event not found.'] };
  }
  if (!isEligibleContractValueEvent(event)) {
    return {
      ok: false,
      errors: ['Expected liability applies only to contract-value Commercial Events.'],
    };
  }
  if (statusKey(event) !== COMMERCIAL_EVENT_STATUSES.submitted.key) {
    return {
      ok: false,
      errors: ['Expected liability can only be changed while the Commercial Event is submitted.'],
    };
  }

  const treatment = parseTreatment(body.treatment || body.expectedTreatment);
  if (!treatment) {
    errors.push('Choose Default, Override, Hold, or Exclude.');
  }

  const reason = String(body.reason || body.expectedReason || '').trim();
  let expectedAmount = null;

  if (treatment === EXPECTED_LIABILITY_TREATMENTS.default) {
    expectedAmount = null;
  } else if (treatment === EXPECTED_LIABILITY_TREATMENTS.override) {
    if (body.expectedAmount == null && body.amount == null && body.expectedAmount !== 0) {
      errors.push('Enter an expected amount for Override.');
    } else {
      expectedAmount = roundMoney(body.expectedAmount ?? body.amount);
      if (expectedAmount == null) {
        errors.push('Expected amount must be a number.');
      }
    }
    if (!reason) errors.push('A reason is required for Override.');
  } else if (
    treatment === EXPECTED_LIABILITY_TREATMENTS.hold ||
    treatment === EXPECTED_LIABILITY_TREATMENTS.exclude
  ) {
    expectedAmount = null;
    if (!reason) errors.push(`A reason is required for ${treatment === 'hold' ? 'Hold' : 'Exclude'}.`);
  }

  if (errors.length || !treatment) {
    return { ok: false, errors };
  }

  const nextEvent = {
    ...event,
    expectedTreatment: treatment,
    expectedAmount,
    expectedReason: treatment === EXPECTED_LIABILITY_TREATMENTS.default ? null : reason,
  };
  const nextRead = enrichExpectedLiabilityReadModel(nextEvent);

  return {
    ok: true,
    treatment,
    expectedAmount,
    expectedReason: nextRead.expectedReason,
    warningAboveSubmitted: nextRead.warningAboveSubmitted,
    nextEffectiveExpected: nextRead.expectedLiability,
  };
}
