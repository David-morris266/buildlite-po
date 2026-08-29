const { normalizeApplication } = require("./paymentApplicationNormalization");

function iso(value) { return value ? new Date(value).toISOString() : null; }
function dateOnly(value) { return value ? String(value instanceof Date ? value.toISOString() : value).slice(0, 10) : null; }
function numberOrNull(value) { return value == null ? null : Number(value); }

function rowToApplication(row, audit = [], assessmentTotals = null) {
  const application = {
    id: row.id, clientId: row.client_id, developmentId: row.development_id,
    packageId: row.package_id, certificateId: row.certificate_id,
    applicationReference: row.application_reference, receivedAt: iso(row.received_at),
    valuationDate: dateOnly(row.valuation_date), applicationBasis: row.application_basis,
    cumulativeGrossClaimed: numberOrNull(row.cumulative_gross_claimed),
    currentPeriodGrossClaimed: numberOrNull(row.current_period_gross_claimed),
    previousApplicationStated: numberOrNull(row.previous_application_stated),
    previousCertifiedStated: numberOrNull(row.previous_certified_stated),
    retentionStated: numberOrNull(row.retention_stated),
    contraDeductionsStated: numberOrNull(row.contra_deductions_stated),
    vatStated: numberOrNull(row.vat_stated), netRequestedStated: numberOrNull(row.net_requested_stated),
    notes: row.notes || "", attachmentMetadata: row.attachment_metadata || null,
    revisionNumber: row.revision_number, supersedesId: row.supersedes_id,
    status: row.status, version: row.version, recordedBy: row.recorded_by,
    recordedAt: iso(row.recorded_at),
    auditHistory: audit.map((item) => ({ id: item.id, action: item.action, actor: item.actor, comment: item.comment, at: iso(item.created_at) })),
  };
  application.comparison = normalizeApplication(application, assessmentTotals);
  return application;
}

module.exports = { rowToApplication };
