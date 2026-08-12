/**
 * BL-028A — Commercial Event row ↔ API document mapping.
 *
 * API contract (transitional):
 * - packageUuid: server Package UUID (canonical relational identity)
 * - packageId:   existing client field meaning orderKey (NOT UUID)
 * - orderKey:    explicit compatibility alias of packageId
 */

const PROMOTED_DOCUMENT_KEYS = new Set([
  "id",
  "eventNumber",
  "developmentId",
  "packageUuid",
  "packageId",
  "orderKey",
  "eventType",
  "category",
  "subcategory",
  "responsibility",
  "description",
  "value",
  "financialTreatment",
  "vatTreatment",
  "dateRaised",
  "raisedBy",
  "status",
  "linkedEventId",
  "recoveryPackageId",
  "potentialContraCharge",
  "potentialContraChargeNotes",
  "relationshipType",
  "recoveredAmount",
  "certificateStatus",
  "recoveryStatus",
  "poNumber",
  "supplierId",
  "costCode",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "auditHistory",
]);

function extractPayloadFromDocument(document = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(document)) {
    if (PROMOTED_DOCUMENT_KEYS.has(key)) continue;
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

function normalizeAuditEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id,
    action: entry.action,
    timestamp: entry.timestamp || entry.created_at || entry.createdAt,
    actor: entry.actor ?? null,
    priorStatus: entry.priorStatus ?? entry.prior_status ?? null,
    newStatus: entry.newStatus ?? entry.new_status ?? null,
    comment: entry.comment ?? "",
    priorRecoveryStatus: entry.priorRecoveryStatus ?? entry.prior_recovery_status ?? null,
    newRecoveryStatus: entry.newRecoveryStatus ?? entry.new_recovery_status ?? null,
    priorCertificateStatus:
      entry.priorCertificateStatus ?? entry.prior_certificate_status ?? null,
    newCertificateStatus:
      entry.newCertificateStatus ?? entry.new_certificate_status ?? null,
  };
}

function rowToDocument(row, auditRows = []) {
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};

  const document = {
    id: row.id,
    eventNumber: row.event_number,
    developmentId: row.development_id,
    packageUuid: row.package_id,
    packageId: row.order_key,
    orderKey: row.order_key,
    eventType: row.event_type,
    category: row.category,
    subcategory: row.subcategory ?? "",
    responsibility: row.responsibility,
    description: row.description,
    value: Number(row.value),
    financialTreatment: row.financial_treatment ?? null,
    vatTreatment: row.vat_treatment,
    dateRaised: row.date_raised
      ? row.date_raised.toISOString().slice(0, 10)
      : null,
    raisedBy: row.raised_by ?? null,
    status: row.status,
    linkedEventId: row.linked_event_id ?? null,
    recoveryPackageId: row.recovery_package_id ?? null,
    potentialContraCharge: Boolean(row.potential_contra_charge),
    potentialContraChargeNotes: row.potential_contra_charge_notes ?? "",
    relationshipType: row.relationship_type ?? null,
    recoveredAmount: Number(row.recovered_amount) || 0,
    certificateStatus: row.certificate_status,
    recoveryStatus: row.recovery_status,
    poNumber: row.po_number ?? "",
    supplierId: row.supplier_id ?? "",
    costCode: row.cost_code ?? "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    auditHistory: auditRows.map(normalizeAuditEntry).filter(Boolean),
    ...payload,
  };

  return document;
}

function auditRowToEntry(row) {
  return normalizeAuditEntry({
    id: row.id,
    action: row.action,
    actor: row.actor,
    comment: row.comment,
    priorStatus: row.prior_status,
    newStatus: row.new_status,
    priorRecoveryStatus: row.prior_recovery_status,
    newRecoveryStatus: row.new_recovery_status,
    priorCertificateStatus: row.prior_certificate_status,
    newCertificateStatus: row.new_certificate_status,
    timestamp: row.created_at,
  });
}

module.exports = {
  PROMOTED_DOCUMENT_KEYS,
  extractPayloadFromDocument,
  rowToDocument,
  auditRowToEntry,
  normalizeAuditEntry,
};
