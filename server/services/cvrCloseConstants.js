/**
 * BL-031E.2 — CVR close-engine constants (candidate snapshot only).
 * Mirrors banked BL-031D client commercial rules. Does not persist snapshots.
 */

const CVR_SNAPSHOT_SCHEMA_VERSION = 1;
const CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION = 2;

const PACKAGE_VALUE_STATUSES = new Set([
  "approved",
  "includedInCertificate",
  "recovered",
  "closed",
]);

const RECOVERY_RELATIONSHIP_TYPE = "recovery";

const APPROVED_CERTIFICATE_STATUSES = new Set(["approved", "locked"]);

const CERTIFICATE_RECOVERY_LINE_TYPE = "recoveryDeduction";

const CLOSE_SOURCE_KEYS = [
  "development",
  "period",
  "inputs",
  "purchaseOrders",
  "commercialEvents",
  "certificates",
  "ledger",
];

module.exports = {
  CVR_SNAPSHOT_SCHEMA_VERSION,
  CVR_SNAPSHOT_REVENUE_SCHEMA_VERSION,
  PACKAGE_VALUE_STATUSES,
  RECOVERY_RELATIONSHIP_TYPE,
  APPROVED_CERTIFICATE_STATUSES,
  CERTIFICATE_RECOVERY_LINE_TYPE,
  CLOSE_SOURCE_KEYS,
};
