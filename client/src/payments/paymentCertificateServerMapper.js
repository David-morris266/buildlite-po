/**
 * BL-030B — Normalise V1 Payment Certificate API documents to client shape.
 */

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeAuditEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: entry.id || null,
    action: entry.action || '',
    actor: entry.actor ?? null,
    at: toIso(entry.at || entry.createdAt || entry.created_at),
    comment: entry.comment || '',
    priorStatus: entry.priorStatus ?? entry.prior_status ?? null,
    newStatus: entry.newStatus ?? entry.new_status ?? null,
  };
}

function frozenMoney(document, camel, snake, alias) {
  return (
    toNumberOrNull(document[camel]) ??
    toNumberOrNull(document[snake]) ??
    toNumberOrNull(document.totals?.[alias]) ??
    toNumberOrNull(document.totals?.[camel])
  );
}

/**
 * @param {object|null} document
 * @returns {object|null}
 */
export function normalizeServerPaymentCertificate(document) {
  if (!document || typeof document !== 'object') return null;

  const id = String(document.id || '').trim();
  if (!id) return null;

  let status = String(document.status || 'draft').trim() || 'draft';
  if (status === 'approved') status = 'locked';

  const packageUuid = document.packageUuid || document.packageId || document.package_id || null;
  const orderKey = String(document.orderKey || document.order_key || '').trim();

  return {
    id,
    packageUuid: packageUuid ? String(packageUuid) : null,
    orderKey: orderKey || null,
    developmentId: document.developmentId || document.development_id || null,
    certificateNumber: Number(document.certificateNumber ?? document.certificate_number) || 0,
    status,
    certificateDate: toDateOnly(document.certificateDate || document.certificate_date),
    progress:
      document.progress && typeof document.progress === 'object' ? document.progress : {},
    commercialLines: Array.isArray(document.commercialLines)
      ? document.commercialLines
      : Array.isArray(document.commercial_lines)
        ? document.commercial_lines
        : [],
    valuationSnapshot: document.valuationSnapshot || document.valuation_snapshot || null,
    submissionApplicationSnapshot: document.submissionApplicationSnapshot || document.submission_application_snapshot || null,
    lockedApplicationSnapshot: document.lockedApplicationSnapshot || document.locked_application_snapshot || null,
    totals: document.totals && typeof document.totals === 'object' ? document.totals : null,
    grossValue: frozenMoney(document, 'grossValue', 'gross_value', 'grossWorksThisCertificate'),
    netValue: frozenMoney(document, 'netValue', 'net_value', 'netPayment'),
    matrixGross: frozenMoney(document, 'matrixGross', 'matrix_gross', 'matrixGrossThisCertificate'),
    commercialEventGross: frozenMoney(
      document,
      'commercialEventGross',
      'commercial_event_gross',
      'commercialEventGrossThisCertificate'
    ),
    recoverySigned: frozenMoney(
      document,
      'recoverySigned',
      'recovery_signed',
      'recoveryDeductionSigned'
    ),
    retention: frozenMoney(document, 'retention', 'retention', 'retention'),
    vat: frozenMoney(document, 'vat', 'vat', 'vat'),
    retentionRate: frozenMoney(document, 'retentionRate', 'retention_rate', 'retentionRate'),
    vatRate: frozenMoney(document, 'vatRate', 'vat_rate', 'vatRate'),
    version: document.version ?? null,
    createdAt: toIso(document.createdAt || document.created_at),
    updatedAt: toIso(document.updatedAt || document.updated_at),
    createdBy: document.createdBy ?? document.created_by ?? null,
    updatedBy: document.updatedBy ?? document.updated_by ?? null,
    submittedAt: toIso(document.submittedAt || document.submitted_at),
    submittedBy: document.submittedBy ?? document.submitted_by ?? null,
    approvedAt: toIso(document.approvedAt || document.approved_at),
    approvedBy: document.approvedBy ?? document.approved_by ?? null,
    auditHistory: Array.isArray(document.auditHistory)
      ? document.auditHistory.map(normalizeAuditEntry).filter(Boolean)
      : Array.isArray(document.audit_history)
        ? document.audit_history.map(normalizeAuditEntry).filter(Boolean)
        : [],
  };
}

export function normalizeServerPaymentCertificateList(documents = []) {
  if (!Array.isArray(documents)) return [];
  return documents
    .map(normalizeServerPaymentCertificate)
    .filter(Boolean)
    .sort((a, b) => a.certificateNumber - b.certificateNumber);
}
