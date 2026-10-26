import { describe, expect, it } from 'vitest';
import { buildLedgerFingerprint, canonicalFingerprintSource } from './ledgerFingerprint';

describe('ledger fingerprint (BL-031C)', () => {
  it('matches the server canonical source for missing invoices', () => {
    const source = canonicalFingerprintSource({
      supplier: 'A Ltd',
      invoiceNumber: '',
      transactionDate: '2026-02-01',
      netAmount: 10,
      costCodeKey: '5218',
      description: 'No invoice line',
    });
    expect(source.startsWith('noinv|')).toBe(true);
    expect(source).toMatch(/no invoice line/);
  });

  it('is stable for equivalent supplier/invoice/date/net/cost-code', async () => {
    const first = await buildLedgerFingerprint({
      supplier: ' Wipe It Cleaners ',
      invoiceNumber: 'INV-1',
      transactionDate: '2026-01-15',
      netAmount: 1000,
      costCodeKey: '5231 — Cleaning',
    });
    const second = await buildLedgerFingerprint({
      supplier: 'wipe it cleaners',
      invoiceNumber: 'inv-1',
      transactionDate: '2026-01-15',
      netAmount: 1000.0,
      costCodeKey: '5231',
    });
    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it('keeps supplier-present invoice identity independent of Sage reference', () => {
    expect(canonicalFingerprintSource({
      supplier: 'A Ltd',
      invoiceNumber: 'INV-1',
      transactionDate: '2026-02-01',
      netAmount: 10,
      costCodeKey: '5218',
      reference: 'SAGE-NEW',
      documentType: 'PI',
    })).toBe('inv|a ltd|inv-1|2026-02-01|10.00|5218');
  });

  it('matches the supplier-less journal identity contract', () => {
    expect(canonicalFingerprintSource({
      supplier: '',
      transactionDate: '2026-02-02',
      netAmount: -25.5,
      costCodeKey: '5218',
      description: 'Accrual reversal',
      reference: 'JNL-0042',
      documentType: 'Journal',
    })).toBe('nosupplier|jnl-0042|2026-02-02|-25.50|5218');
  });
});
