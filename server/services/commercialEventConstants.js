/**
 * BL-028A — Commercial Event canonical enums and id helpers (server-side).
 */

const crypto = require("crypto");

const COMMERCIAL_EVENT_ID_PATTERN = /^ce-[a-z0-9-]+$/i;

const COMMERCIAL_EVENT_TYPES = new Set([
  "variation",
  "contraCharge",
  "credit",
  "budgetTransfer",
  "employerInstruction",
  "salesUpgrade",
  "valueEngineering",
  "other",
]);

const COMMERCIAL_EVENT_STATUSES = {
  draft: "draft",
  submitted: "submitted",
  approved: "approved",
  rejected: "rejected",
  includedInCertificate: "includedInCertificate",
  recovered: "recovered",
  closed: "closed",
};

const COMMERCIAL_EVENT_RESPONSIBILITIES = new Set([
  "employer",
  "consultant",
  "developer",
  "commercial",
  "siteTeam",
  "subcontractor",
  "purchaser",
  "utilityCompany",
  "unknown",
]);

const COMMERCIAL_EVENT_VAT_TREATMENTS = new Set([
  "standard",
  "zeroRated",
  "exempt",
  "outsideScope",
  "unknown",
]);

const COMMERCIAL_EVENT_FINANCIAL_TREATMENTS = new Set([
  "contractAmendment",
  "recoverableDeduction",
]);

const COMMERCIAL_EVENT_RELATIONSHIP_TYPES = new Set([
  "origin",
  "recovery",
  "mirror",
]);

const COMMERCIAL_EVENT_CERTIFICATE_STATUSES = new Set([
  "notIncluded",
  "pendingInclusion",
  "partiallyIncluded",
  "fullyIncluded",
  "included",
]);

const COMMERCIAL_EVENT_RECOVERY_STATUSES = new Set([
  "notApplicable",
  "outstanding",
  "includedInCertificate",
  "partiallyRecovered",
  "fullyRecovered",
  "closed",
  "writtenOff",
  "pending",
  "recovered",
]);

const COMMERCIAL_EVENT_CATEGORIES = new Set([
  "design",
  "sales",
  "budget",
  "production",
  "external",
  "commercial",
  "recovery",
  "other",
]);

const PACKAGE_VALUE_STATUSES = new Set([
  COMMERCIAL_EVENT_STATUSES.approved,
  COMMERCIAL_EVENT_STATUSES.includedInCertificate,
  COMMERCIAL_EVENT_STATUSES.recovered,
  COMMERCIAL_EVENT_STATUSES.closed,
]);

const DEFAULT_EVENT_NUMBER_PREFIX = "CE-";
const DEFAULT_EVENT_NUMBER_PAD = 4;

function generateCommercialEventId() {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6);
  return `ce-${Date.now()}-${suffix}`;
}

function generateCommercialEventAuditId() {
  const suffix = crypto.randomBytes(4).toString("hex").slice(0, 6);
  return `ce-audit-${Date.now()}-${suffix}`;
}

function isValidCommercialEventId(id) {
  return COMMERCIAL_EVENT_ID_PATTERN.test(String(id || "").trim());
}

function isRecoveryRelationshipType(relationshipType) {
  return relationshipType === "recovery";
}

function isOriginRelationshipType(relationshipType) {
  return relationshipType === "origin";
}

function isDirectRecoveryEvent(event) {
  return (
    isRecoveryRelationshipType(event?.relationshipType) &&
    !String(event?.linkedEventId || "").trim()
  );
}

function isLinkedRecoveryEvent(event) {
  return (
    isRecoveryRelationshipType(event?.relationshipType) &&
    Boolean(String(event?.linkedEventId || "").trim())
  );
}

function isRecoveryCommercialEvent(event) {
  if (!event) return false;
  if (isRecoveryRelationshipType(event.relationshipType)) return true;
  if (event.financialTreatment === "recoverableDeduction") return true;
  return false;
}

function affectsContractValue(event) {
  if (!event) return false;
  if (!PACKAGE_VALUE_STATUSES.has(event.status)) return false;
  return !isRecoveryCommercialEvent(event);
}

function isCommercialEventEditable(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.draft;
}

function canSubmitCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.draft;
}

function canApproveCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.submitted;
}

function canRejectCommercialEvent(statusKey) {
  return statusKey === COMMERCIAL_EVENT_STATUSES.submitted;
}

function canCloseCommercialEvent(statusKey) {
  return (
    statusKey === COMMERCIAL_EVENT_STATUSES.approved ||
    statusKey === COMMERCIAL_EVENT_STATUSES.includedInCertificate ||
    statusKey === COMMERCIAL_EVENT_STATUSES.recovered
  );
}

module.exports = {
  COMMERCIAL_EVENT_ID_PATTERN,
  COMMERCIAL_EVENT_TYPES,
  COMMERCIAL_EVENT_STATUSES,
  COMMERCIAL_EVENT_RESPONSIBILITIES,
  COMMERCIAL_EVENT_VAT_TREATMENTS,
  COMMERCIAL_EVENT_FINANCIAL_TREATMENTS,
  COMMERCIAL_EVENT_RELATIONSHIP_TYPES,
  COMMERCIAL_EVENT_CERTIFICATE_STATUSES,
  COMMERCIAL_EVENT_RECOVERY_STATUSES,
  COMMERCIAL_EVENT_CATEGORIES,
  PACKAGE_VALUE_STATUSES,
  DEFAULT_EVENT_NUMBER_PREFIX,
  DEFAULT_EVENT_NUMBER_PAD,
  generateCommercialEventId,
  generateCommercialEventAuditId,
  isValidCommercialEventId,
  isRecoveryRelationshipType,
  isOriginRelationshipType,
  isDirectRecoveryEvent,
  isLinkedRecoveryEvent,
  isRecoveryCommercialEvent,
  affectsContractValue,
  isCommercialEventEditable,
  canSubmitCommercialEvent,
  canApproveCommercialEvent,
  canRejectCommercialEvent,
  canCloseCommercialEvent,
};
