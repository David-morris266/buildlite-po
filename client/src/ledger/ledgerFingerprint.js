/**
 * BL-031C — Client copy of the server ledger fingerprint (BL-031A).
 * Used for migration preflight matching. Do not invent a second identity.
 */

import { normaliseCostCodeKey } from '../cvr/cvrCalculations';

function normaliseText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function moneyToken(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 'nan';
  return n.toFixed(2);
}

function dateToken(value) {
  return String(value || '').trim().slice(0, 10);
}

export function canonicalFingerprintSource({
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
    return ['inv', supplierToken, invoiceToken, date, net, costCode].join('|');
  }
  return ['noinv', supplierToken, date, net, costCode, normaliseText(description)].join('|');
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(text).digest('hex');
}

export async function buildLedgerFingerprint(fields) {
  return sha256Hex(canonicalFingerprintSource(fields));
}
