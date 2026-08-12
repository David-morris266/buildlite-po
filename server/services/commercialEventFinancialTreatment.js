/**
 * BL-028A — Contra charge financial treatment (mirrors client commercialEventFinancialTreatment.js).
 */

const { isRecoveryRelationshipType } = require("./commercialEventConstants");

function normalizeFinancialTreatmentKey(treatmentKey) {
  if (!treatmentKey) return null;
  if (treatmentKey === "contractAmendment" || treatmentKey === "recoverableDeduction") {
    return treatmentKey;
  }
  return treatmentKey;
}

function normalizeRecoverableDeductionStoredValue(rawValue) {
  const magnitude = Math.abs(Number(rawValue) || 0);
  if (magnitude === 0) return 0;
  return -magnitude;
}

function resolveContraChargeFinancialFields({
  eventType,
  financialTreatment,
  value,
  relationshipType = null,
  linkedEventId = null,
  isCreate = false,
} = {}) {
  if (eventType !== "contraCharge") {
    return {
      financialTreatment: financialTreatment || null,
      relationshipType: relationshipType || null,
      linkedEventId: linkedEventId || null,
      value: Number(value) || 0,
    };
  }

  const treatment =
    normalizeFinancialTreatmentKey(financialTreatment) ||
    (isCreate ? "recoverableDeduction" : null);

  if (!treatment) {
    return {
      financialTreatment: null,
      relationshipType: relationshipType || null,
      linkedEventId: linkedEventId || null,
      value: Number(value) || 0,
    };
  }

  if (treatment === "recoverableDeduction") {
    return {
      financialTreatment: "recoverableDeduction",
      relationshipType: "recovery",
      linkedEventId: null,
      value: normalizeRecoverableDeductionStoredValue(value),
    };
  }

  return {
    financialTreatment: "contractAmendment",
    relationshipType: null,
    linkedEventId: null,
    value: Number(value) || 0,
  };
}

function shouldApplyContraChargeFinancialTreatment(payload, { isCreate = false } = {}) {
  if (payload?.eventType !== "contraCharge") return false;
  if (normalizeFinancialTreatmentKey(payload?.financialTreatment)) return true;
  if (isCreate && !String(payload?.linkedEventId || "").trim()) return true;
  return false;
}

function applyContraChargeFinancialTreatment(payload, { isCreate = false } = {}) {
  if (!shouldApplyContraChargeFinancialTreatment(payload, { isCreate })) {
    return payload;
  }

  const resolved = resolveContraChargeFinancialFields({
    eventType: payload.eventType,
    financialTreatment: payload.financialTreatment,
    value: payload.value,
    relationshipType: payload.relationshipType ?? null,
    linkedEventId: payload.linkedEventId ?? null,
    isCreate,
  });

  const next = {
    ...payload,
    financialTreatment: resolved.financialTreatment,
    relationshipType: resolved.relationshipType,
    linkedEventId: resolved.linkedEventId,
    value: resolved.value,
  };

  if (resolved.relationshipType === "recovery" && isCreate) {
    next.recoveredAmount = 0;
    next.recoveryStatus = "notApplicable";
  }

  return next;
}

module.exports = {
  normalizeFinancialTreatmentKey,
  resolveContraChargeFinancialFields,
  shouldApplyContraChargeFinancialTreatment,
  applyContraChargeFinancialTreatment,
  normalizeRecoverableDeductionStoredValue,
};
