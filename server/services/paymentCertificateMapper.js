/**
 * BL-030A — Row ↔ V1 Payment Certificate API document mapping.
 */

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function payloadOf(row) {
  return row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function auditRowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    action: row.action,
    actor: row.actor ?? null,
    at: toIso(row.created_at),
    comment: row.comment || "",
    priorStatus: row.prior_status ?? null,
    newStatus: row.new_status ?? null,
  };
}

function frozenTotalsFromRow(row) {
  return {
    matrixGrossThisCertificate: toNumberOrNull(row.matrix_gross),
    commercialEventGrossThisCertificate: toNumberOrNull(row.commercial_event_gross),
    recoveryDeductionSigned: toNumberOrNull(row.recovery_signed),
    grossWorksThisCertificate: toNumberOrNull(row.gross_value),
    retention: toNumberOrNull(row.retention),
    vat: toNumberOrNull(row.vat),
    netPayment: toNumberOrNull(row.net_value),
    vatRate: toNumberOrNull(row.vat_rate),
    retentionRate: toNumberOrNull(row.retention_rate),
  };
}

function rowToDocument(row, auditRows = [], extras = {}) {
  if (!row) return null;
  const payload = payloadOf(row);
  const frozen = frozenTotalsFromRow(row);

  return {
    id: row.id,
    packageId: row.package_id,
    orderKey: row.order_key,
    developmentId: row.development_id,
    certificateNumber: row.certificate_number,
    status: row.status,
    certificateDate: toDateOnly(row.certificate_date),
    contractualValuationDate: toDateOnly(row.contractual_valuation_date),
    progress: payload.progress && typeof payload.progress === "object" ? payload.progress : {},
    commercialLines: Array.isArray(payload.commercialLines) ? payload.commercialLines : [],
    valuationSnapshot: payload.valuationSnapshot || null,
    sourceAuthority: payload.sourceAuthoritySnapshot || extras.sourceAuthority || (row.status === "locked"
      ? require('./paymentCertificateSourceAuthority').legacySourceAuthority()
      : null),
    paymentDiscoveredItems: extras.paymentDiscoveredItems || [],
    variationAssessments: extras.variationAssessments || [],
    submissionApplicationSnapshot: payload.submissionApplicationSnapshot || null,
    lockedApplicationSnapshot: payload.lockedApplicationSnapshot || null,
    submissionGoverningTermsSnapshot: payload.submissionGoverningTermsSnapshot || null,
    lockedGoverningTermsSnapshot: payload.lockedGoverningTermsSnapshot || null,
    paymentTimetable: extras.paymentTimetable || null,
    hasSubmissionHistory: (auditRows || []).some((entry) => entry.action === "submitted"),
    grossValue: frozen.grossWorksThisCertificate,
    netValue: frozen.netPayment,
    matrixGross: frozen.matrixGrossThisCertificate,
    commercialEventGross: frozen.commercialEventGrossThisCertificate,
    recoverySigned: frozen.recoveryDeductionSigned,
    retention: frozen.retention,
    vat: frozen.vat,
    retentionRate: frozen.retentionRate,
    vatRate: frozen.vatRate,
    totals: extras.totals || (row.status === "locked" ? frozen : null),
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    submittedAt: toIso(row.submitted_at),
    submittedBy: row.submitted_by ?? null,
    approvedAt: toIso(row.approved_at),
    approvedBy: row.approved_by ?? null,
    auditHistory: (auditRows || []).map(auditRowToEntry).filter(Boolean),
  };
}

function documentToLockedColumns(totals) {
  return {
    gross_value: totals.grossWorksThisCertificate,
    net_value: totals.netPayment,
    matrix_gross: totals.matrixGrossThisCertificate,
    commercial_event_gross: totals.commercialEventGrossThisCertificate,
    recovery_signed: totals.recoveryDeductionSigned,
    retention: totals.retention,
    vat: totals.vat,
    retention_rate: totals.retentionRate,
    vat_rate: totals.vatRate,
  };
}

module.exports = {
  toIso,
  toDateOnly,
  payloadOf,
  auditRowToEntry,
  frozenTotalsFromRow,
  rowToDocument,
  documentToLockedColumns,
};
