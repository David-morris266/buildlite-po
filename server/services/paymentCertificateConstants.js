/**
 * BL-030A — V1 Payment Certificate server constants.
 */

const { PACKAGE_UUID_PATTERN, isValidPackageUuid } = require("./orderMatrixConstants");

const CERTIFICATE_STATUSES = {
  draft: "draft",
  submitted: "submitted",
  locked: "locked",
};

const OPEN_CERTIFICATE_STATUSES = new Set([
  CERTIFICATE_STATUSES.draft,
  CERTIFICATE_STATUSES.submitted,
]);

const CERTIFICATE_LINE_TYPES = {
  valueInclusion: "valueInclusion",
  recoveryDeduction: "recoveryDeduction",
};

const CERTIFICATE_SOURCE_TYPES = {
  commercialEvent: "commercialEvent",
  variationOrder: "variationOrder",
};

const CERTIFIABLE_EVENT_TYPES = new Set([
  "variation",
  "credit",
  "salesUpgrade",
  "valueEngineering",
  "employerInstruction",
]);

const VALUATION_SNAPSHOT_VERSION = 1;

const DEFAULT_VAT_RATE = 0.2;
const DEFAULT_RETENTION_RATE = 0.05;

const MAX_CERTIFICATE_PAYLOAD_BYTES = 512 * 1024;
const MAX_COMMERCIAL_LINES = 200;
const MAX_PROGRESS_CELLS = 500 * 200;
const MAX_LABEL_LENGTH = 500;
const MAX_MONEY_ABS = 1e12;

const FORBIDDEN_PATCH_KEYS = new Set([
  "id",
  "clientId",
  "packageId",
  "packageUuid",
  "developmentId",
  "orderKey",
  "certificateNumber",
  "status",
  "grossValue",
  "netValue",
  "matrixGross",
  "commercialEventGross",
  "recoverySigned",
  "retention",
  "vat",
  "retentionRate",
  "vatRate",
  "submittedAt",
  "submittedBy",
  "approvedAt",
  "approvedBy",
  "createdAt",
  "createdBy",
  "updatedAt",
  "audit",
  "auditHistory",
  "valuationSnapshot",
  "totals",
]);

function isValidCertificateUuid(value) {
  return PACKAGE_UUID_PATTERN.test(String(value || "").trim());
}

module.exports = {
  PACKAGE_UUID_PATTERN,
  isValidPackageUuid,
  isValidCertificateUuid,
  CERTIFICATE_STATUSES,
  OPEN_CERTIFICATE_STATUSES,
  CERTIFICATE_LINE_TYPES,
  CERTIFICATE_SOURCE_TYPES,
  CERTIFIABLE_EVENT_TYPES,
  VALUATION_SNAPSHOT_VERSION,
  DEFAULT_VAT_RATE,
  DEFAULT_RETENTION_RATE,
  MAX_CERTIFICATE_PAYLOAD_BYTES,
  MAX_COMMERCIAL_LINES,
  MAX_PROGRESS_CELLS,
  MAX_LABEL_LENGTH,
  MAX_MONEY_ABS,
  FORBIDDEN_PATCH_KEYS,
};
