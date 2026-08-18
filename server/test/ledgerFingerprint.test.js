const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildLedgerFingerprint,
  buildReversalFingerprint,
  canonicalFingerprintSource,
} = require("../services/ledgerFingerprint");

test("invoice fingerprint is stable for equivalent supplier/invoice/date/net/cost-code", () => {
  const first = buildLedgerFingerprint({
    supplier: " Wipe It Cleaners ",
    invoiceNumber: "INV-1",
    transactionDate: "2026-01-15",
    netAmount: 1000,
    costCodeKey: "5231 — Cleaning",
  });
  const second = buildLedgerFingerprint({
    supplier: "wipe it cleaners",
    invoiceNumber: "inv-1",
    transactionDate: "2026-01-15",
    netAmount: 1000.0,
    costCodeKey: "5231",
  });
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("missing invoice falls back to description in the canonical source", () => {
  const source = canonicalFingerprintSource({
    supplier: "A Ltd",
    invoiceNumber: "",
    transactionDate: "2026-02-01",
    netAmount: 10,
    costCodeKey: "5218",
    description: "No invoice line",
  });
  assert.match(source, /^noinv\|/);
  assert.match(source, /no invoice line/);
});

test("reversal fingerprints do not collide with the origin", () => {
  const origin = buildLedgerFingerprint({
    supplier: "A Ltd",
    invoiceNumber: "INV-9",
    transactionDate: "2026-03-01",
    netAmount: 10,
    costCodeKey: "5218",
  });
  const reversal = buildReversalFingerprint(origin, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  assert.notEqual(origin, reversal);
});
