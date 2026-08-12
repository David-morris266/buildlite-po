/**
 * BL-028A — Commercial Event server validation.
 */

const { parseSubcontractOrderKey } = require("./packageKey");
const {
  COMMERCIAL_EVENT_TYPES,
  COMMERCIAL_EVENT_RESPONSIBILITIES,
  COMMERCIAL_EVENT_VAT_TREATMENTS,
  COMMERCIAL_EVENT_FINANCIAL_TREATMENTS,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_CATEGORIES,
  COMMERCIAL_EVENT_STATUSES,
  isRecoveryRelationshipType,
  isLinkedRecoveryEvent,
  isDirectRecoveryEvent,
  isOriginRelationshipType,
  isCommercialEventEditable,
} = require("./commercialEventConstants");

function isValidEnum(value, allowedSet) {
  if (value == null || value === "") return true;
  return allowedSet.has(String(value));
}

function validateEventPayload(payload, { partial = false } = {}) {
  const errors = [];
  const requiredFields = partial
    ? []
    : ["packageId", "eventType", "category", "responsibility", "description"];

  for (const field of requiredFields) {
    const key = field === "packageId" ? payload.packageId ?? payload.orderKey : field;
    if (!String(payload[field] ?? key ?? "").trim()) {
      errors.push(`${field} is required`);
    }
  }

  if (!partial && payload.value == null) {
    errors.push("value is required");
  }

  if (payload.eventType && !COMMERCIAL_EVENT_TYPES.has(payload.eventType)) {
    errors.push("invalid eventType");
  }

  if (payload.category && !COMMERCIAL_EVENT_CATEGORIES.has(payload.category)) {
    errors.push("invalid category");
  }

  if (
    payload.responsibility &&
    !COMMERCIAL_EVENT_RESPONSIBILITIES.has(payload.responsibility)
  ) {
    errors.push("invalid responsibility");
  }

  if (
    payload.vatTreatment &&
    !COMMERCIAL_EVENT_VAT_TREATMENTS.has(payload.vatTreatment)
  ) {
    errors.push("invalid vatTreatment");
  }

  if (
    payload.financialTreatment &&
    !COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.has(payload.financialTreatment)
  ) {
    errors.push("invalid financialTreatment");
  }

  if (
    payload.relationshipType &&
    !COMMERCIAL_EVENT_RELATIONSHIP_TYPES.has(payload.relationshipType)
  ) {
    errors.push("invalid relationshipType");
  }

  if (
    payload.certificateStatus &&
    !COMMERCIAL_EVENT_CERTIFICATE_STATUSES.has(payload.certificateStatus)
  ) {
    errors.push("invalid certificateStatus");
  }

  if (
    payload.recoveryStatus &&
    !COMMERCIAL_EVENT_RECOVERY_STATUSES.has(payload.recoveryStatus)
  ) {
    errors.push("invalid recoveryStatus");
  }

  if (payload.status && !Object.values(COMMERCIAL_EVENT_STATUSES).includes(payload.status)) {
    errors.push("invalid status");
  }

  if (payload.value != null && !Number.isFinite(Number(payload.value))) {
    errors.push("value must be a number");
  }

  if (
    isRecoveryRelationshipType(payload.relationshipType) &&
    payload.value != null &&
    Number(payload.value) >= 0
  ) {
    errors.push("Recovery contra charge value must be negative");
  }

  return errors;
}

function validateRecoveryPackageId(recoveryPackageId, developmentId, originPackageId) {
  const errors = [];

  if (!String(recoveryPackageId || "").trim()) {
    errors.push("recoveryPackageId is required");
    return errors;
  }

  const parsed = parseSubcontractOrderKey(recoveryPackageId);
  if (!parsed || parsed.legacy) {
    errors.push("recoveryPackageId must be a canonical package id");
    return errors;
  }

  if (parsed.developmentId !== developmentId) {
    errors.push("recovery package must belong to the same development");
  }

  if (recoveryPackageId === originPackageId) {
    errors.push("recovery package cannot be the same as the origin package");
  }

  return errors;
}

function validateRecoveryDraftPatch(event, patch) {
  const errors = [];

  if (isLinkedRecoveryEvent(event)) {
    if (patch.value != null && Number(patch.value) >= 0) {
      errors.push("Recovery contra charge value must remain negative");
    }

    const lockedFields = [
      "linkedEventId",
      "relationshipType",
      "financialTreatment",
      "potentialContraCharge",
      "potentialContraChargeNotes",
      "recoveryPackageId",
      "packageId",
      "orderKey",
      "eventType",
    ];
    for (const field of lockedFields) {
      if (patch[field] != null && patch[field] !== event[field]) {
        errors.push(`${field} cannot be changed on a linked recovery event`);
      }
    }
  }

  if (isDirectRecoveryEvent(event)) {
    const lockedFields = [
      "linkedEventId",
      "relationshipType",
      "financialTreatment",
      "potentialContraCharge",
      "potentialContraChargeNotes",
      "recoveryPackageId",
      "packageId",
      "orderKey",
      "eventType",
    ];
    for (const field of lockedFields) {
      if (patch[field] != null && patch[field] !== event[field]) {
        errors.push(`${field} cannot be changed on a direct recovery event`);
      }
    }
  }

  if (
    isOriginRelationshipType(event.relationshipType) ||
    (event.potentialContraCharge && event.linkedEventId)
  ) {
    const lockedOriginFields = ["potentialContraCharge", "potentialContraChargeNotes"];
    for (const field of lockedOriginFields) {
      if (patch[field] != null && patch[field] !== event[field]) {
        errors.push(`${field} cannot be changed after a linked recovery exists`);
      }
    }
  }

  return errors;
}

function assertDraftEditable(event) {
  if (!event) return { ok: false, status: 404, message: "Commercial event not found." };
  if (!isCommercialEventEditable(event.status)) {
    return {
      ok: false,
      status: 400,
      message: "Approved events are immutable. Create a reversing or correcting event.",
    };
  }
  return { ok: true };
}

module.exports = {
  validateEventPayload,
  validateRecoveryPackageId,
  validateRecoveryDraftPatch,
  assertDraftEditable,
};
