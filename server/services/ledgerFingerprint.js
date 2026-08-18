/**
 * BL-031A — Deterministic ledger transaction fingerprints.
 *
 * Prefer supplier/invoice/date/net/cost-code.
 * Fallback when invoice is absent: supplier/date/net/cost-code/description.
 * Reversals use a distinct fingerprint so they never collide with the origin.
 */

const crypto = require("crypto");
const { normaliseCostCodeKey } = require("./cvrPeriodValidation");

function normaliseText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function moneyToken(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "nan";
  return n.toFixed(2);
}

function dateToken(value) {
  return String(value || "").trim().slice(0, 10);
}

function canonicalFingerprintSource({
  supplier,
  invoiceNumber,
  transactionDate,
  netAmount,
  costCodeKey,
  description,
}) {
  const supplierToken = normaliseText(supplier);
  const invoiceToken = normaliseText(invoiceNumber);
  const date = dateToken(transactionDate);
  const net = moneyToken(netAmount);
  const costCode = normaliseCostCodeKey(costCodeKey);
  if (invoiceToken) {
    return ["inv", supplierToken, invoiceToken, date, net, costCode].join("|");
  }
  return [
    "noinv",
    supplierToken,
    date,
    net,
    costCode,
    normaliseText(description),
  ].join("|");
}

function buildLedgerFingerprint(fields) {
  const canonical = canonicalFingerprintSource(fields);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function buildReversalFingerprint(originFingerprint, originId) {
  const canonical = ["rev", String(originId || ""), String(originFingerprint || "")].join("|");
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

module.exports = {
  normaliseText,
  canonicalFingerprintSource,
  buildLedgerFingerprint,
  buildReversalFingerprint,
};
