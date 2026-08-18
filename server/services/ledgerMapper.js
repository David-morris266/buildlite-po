/**
 * BL-031A — Purchase ledger API documents.
 */

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

function batchRowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    developmentId: row.development_id,
    originalFileName: row.original_file_name || "",
    sourceProfile: row.source_profile || "",
    rowsImported: Number(row.rows_imported) || 0,
    rowsRejected: Number(row.rows_rejected) || 0,
    totalNet: toNumber(row.total_net, 0),
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    importedBy: row.imported_by ?? null,
    importedAt: toIso(row.imported_at),
    createdAt: toIso(row.created_at),
  };
}

function transactionRowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    developmentId: row.development_id,
    batchId: row.batch_id ?? null,
    supplier: row.supplier,
    supplierCode: row.supplier_code || "",
    costCodeKey: row.cost_code_key,
    transactionDate: toDateOnly(row.transaction_date),
    invoiceNumber: row.invoice_number || "",
    description: row.description || "",
    netAmount: toNumber(row.net_amount, 0),
    vatAmount: toNumberOrNull(row.vat_amount),
    grossAmount: toNumberOrNull(row.gross_amount),
    source: row.source || "",
    documentType: row.document_type || "",
    reference: row.reference || "",
    fingerprint: row.fingerprint,
    reversesId: row.reverses_id ?? null,
    createdAt: toIso(row.created_at),
    createdBy: row.created_by ?? null,
  };
}

module.exports = {
  batchRowToDocument,
  transactionRowToDocument,
};
