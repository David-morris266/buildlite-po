/**
 * BL-038B — Pure CE expected-liability derivation (HD-001 / HD-038).
 * Does not write CVR money. BL-038C consumes the derived value in the close engine.
 */

const {
  COMMERCIAL_EVENT_STATUSES,
  isRecoveryCommercialEvent,
} = require("./commercialEventConstants");

const EXPECTED_LIABILITY_TREATMENTS = Object.freeze({
  default: "default",
  override: "override",
  hold: "hold",
  exclude: "exclude",
});

const EXPECTED_LIABILITY_AUDIT_ACTION = "EXPECTED_LIABILITY_CHANGED";

function roundMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function parseTreatment(value) {
  const key = String(value || "").trim();
  return EXPECTED_LIABILITY_TREATMENTS[key] || null;
}

function normalizeTreatment(value) {
  return parseTreatment(value) || EXPECTED_LIABILITY_TREATMENTS.default;
}

function isEligibleContractValueEvent(event) {
  if (!event) return false;
  return !isRecoveryCommercialEvent(event);
}

function isExpectedTreatmentEditable(event) {
  return (
    isEligibleContractValueEvent(event) &&
    event.status === COMMERCIAL_EVENT_STATUSES.submitted
  );
}

function storedOverrideAmount(event) {
  if (normalizeTreatment(event?.expectedTreatment) !== EXPECTED_LIABILITY_TREATMENTS.override) {
    return null;
  }
  return roundMoney(event?.expectedAmount);
}

function potentialLiability(event) {
  if (!isEligibleContractValueEvent(event)) return 0;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.submitted) return 0;
  return roundMoney(event.value) ?? 0;
}

function effectiveExpectedLiability(event) {
  if (!isEligibleContractValueEvent(event)) return 0;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.submitted) return 0;

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

function expectedExceedsSubmitted(event, expectedValue = null) {
  if (!isEligibleContractValueEvent(event)) return false;
  if (event.status !== COMMERCIAL_EVENT_STATUSES.submitted) return false;
  const submitted = roundMoney(event.value) ?? 0;
  const expected =
    expectedValue != null ? roundMoney(expectedValue) : effectiveExpectedLiability(event);
  if (expected == null) return false;
  return expected > submitted + 0.005;
}

function enrichExpectedLiabilityReadModel(event = {}) {
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
    expectedReason: isDefaultTreatment ? null : String(event.expectedReason || "").trim() || null,
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
    expectedWarning: warningAboveSubmitted ? "above_submitted" : null,
  };
}

function validateExpectedLiabilityIntent(body = {}, event) {
  const errors = [];
  if (!event) {
    return { ok: false, status: 404, message: "Commercial event not found.", errors: ["not_found"] };
  }
  if (!isEligibleContractValueEvent(event)) {
    return {
      ok: false,
      status: 400,
      message: "Expected liability applies only to contract-value Commercial Events.",
      errors: ["not_contract_value"],
      code: "NOT_CONTRACT_VALUE",
    };
  }
  if (event.status !== COMMERCIAL_EVENT_STATUSES.submitted) {
    return {
      ok: false,
      status: 400,
      message: "Expected liability can only be changed while the Commercial Event is submitted.",
      errors: ["not_submitted"],
      code: "NOT_SUBMITTED",
    };
  }

  const treatment = parseTreatment(body.treatment || body.expectedTreatment);
  if (!treatment) {
    errors.push("treatment must be default, override, hold, or exclude");
  }

  const reason = String(body.reason || body.expectedReason || "").trim();
  let expectedAmount = null;

  if (treatment === EXPECTED_LIABILITY_TREATMENTS.default) {
    expectedAmount = null;
  } else if (treatment === EXPECTED_LIABILITY_TREATMENTS.override) {
    if (body.expectedAmount == null && body.amount == null) {
      errors.push("expectedAmount is required for override");
    } else {
      expectedAmount = roundMoney(body.expectedAmount ?? body.amount);
      if (expectedAmount == null) {
        errors.push("expectedAmount must be a number");
      }
    }
    if (!reason) errors.push("reason is required for override");
  } else if (
    treatment === EXPECTED_LIABILITY_TREATMENTS.hold ||
    treatment === EXPECTED_LIABILITY_TREATMENTS.exclude
  ) {
    expectedAmount = null;
    if (!reason) errors.push(`reason is required for ${treatment}`);
  }

  if (errors.length || !treatment) {
    return { ok: false, status: 400, message: errors.join("; "), errors };
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

module.exports = {
  EXPECTED_LIABILITY_TREATMENTS,
  EXPECTED_LIABILITY_AUDIT_ACTION,
  roundMoney,
  parseTreatment,
  normalizeTreatment,
  isEligibleContractValueEvent,
  isExpectedTreatmentEditable,
  potentialLiability,
  effectiveExpectedLiability,
  expectedExceedsSubmitted,
  enrichExpectedLiabilityReadModel,
  validateExpectedLiabilityIntent,
};
