/**
 * BL-031A — Purchase ledger import validation.
 */

const { normaliseCostCodeKey, roundMoney, trimText } = require("./cvrPeriodValidation");
const { buildLedgerFingerprint } = require("./ledgerFingerprint");

function parseIsoDate(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function validateLedgerTransactionInput(body = {}, index = 0) {
  const errors = [];
  const prefix = `transactions[${index}]`;
  const supplier = trimText(body.supplier, 200);
  if (!supplier) errors.push(`${prefix}.supplier is required.`);

  const costCodeKey = normaliseCostCodeKey(body.costCodeKey || body.costCode);
  if (!costCodeKey) errors.push(`${prefix}.costCodeKey is required.`);

  const transactionDate = parseIsoDate(body.transactionDate);
  if (!transactionDate) {
    errors.push(`${prefix}.transactionDate must be YYYY-MM-DD.`);
  }

  const netAmount = roundMoney(body.netAmount ?? body.net);
  if (netAmount == null) {
    errors.push(`${prefix}.netAmount must be a finite amount.`);
  }

  const vatAmount =
    body.vatAmount == null && body.vat == null ? null : roundMoney(body.vatAmount ?? body.vat);
  if ((body.vatAmount != null || body.vat != null) && vatAmount == null) {
    errors.push(`${prefix}.vatAmount must be a finite amount.`);
  }

  let grossAmount =
    body.grossAmount == null && body.gross == null
      ? null
      : roundMoney(body.grossAmount ?? body.gross);
  if ((body.grossAmount != null || body.gross != null) && grossAmount == null) {
    errors.push(`${prefix}.grossAmount must be a finite amount.`);
  }
  if (grossAmount == null && netAmount != null && vatAmount != null) {
    grossAmount = roundMoney(netAmount + vatAmount);
  }

  const invoiceNumber = trimText(body.invoiceNumber, 80);
  const description = trimText(body.description, 500);

  const value = {
    supplier,
    supplierCode: trimText(body.supplierCode, 80),
    costCodeKey,
    transactionDate,
    invoiceNumber,
    description,
    netAmount,
    vatAmount,
    grossAmount,
    source: trimText(body.source, 80),
    documentType: trimText(body.documentType, 80),
    reference: trimText(body.reference, 80),
  };

  if (errors.length === 0) {
    value.fingerprint = buildLedgerFingerprint(value);
  }

  return { ok: errors.length === 0, errors, value };
}

function validateLedgerImportBody(body = {}) {
  const errors = [];
  const transactions = Array.isArray(body.transactions) ? body.transactions : null;
  if (!transactions || transactions.length === 0) {
    return { ok: false, errors: ["transactions must be a non-empty array."] };
  }

  const values = [];
  const seen = new Map();
  transactions.forEach((item, index) => {
    const result = validateLedgerTransactionInput(item, index);
    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }
    if (seen.has(result.value.fingerprint)) {
      errors.push(`Duplicate transaction in this batch at index ${index}.`);
      return;
    }
    seen.set(result.value.fingerprint, index);
    values.push(result.value);
  });

  return {
    ok: errors.length === 0,
    errors,
    value: {
      originalFileName: trimText(body.originalFileName || body.fileName, 260),
      sourceProfile: trimText(body.sourceProfile || body.importProfile || body.source, 80),
      metadata:
        body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
          ? body.metadata
          : {},
      transactions: values,
    },
  };
}

module.exports = {
  parseIsoDate,
  validateLedgerTransactionInput,
  validateLedgerImportBody,
};
