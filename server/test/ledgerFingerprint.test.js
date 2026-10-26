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

test("supplier-present invoice identity remains historically compatible", () => {
  const source = canonicalFingerprintSource({
    supplier: "A Ltd",
    invoiceNumber: "INV-1",
    transactionDate: "2026-02-01",
    netAmount: 10,
    costCodeKey: "5218",
    description: "Ignored for invoiced supplier transactions",
    reference: "SAGE-NEW",
    documentType: "PI",
  });
  assert.equal(source, "inv|a ltd|inv-1|2026-02-01|10.00|5218");
});

test("supplier-less journal identity includes Sage reference and financial evidence", () => {
  const source = canonicalFingerprintSource({
    supplier: "",
    transactionDate: "2026-02-02",
    netAmount: -25.5,
    costCodeKey: "5218",
    description: "Accrual reversal",
    reference: "JNL-0042",
    documentType: "Journal",
  });
  assert.equal(source, "nosupplier|jnl-0042|2026-02-02|-25.50|5218");
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
