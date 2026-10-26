import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ existing: new Set() }));

vi.mock('./ledgerTransactionStore', () => ({
  getExistingLedgerIdentityKeys: () => state.existing,
}));
vi.mock('./ledgerCostCentreImport', () => ({
  collectKnownCostCentreKeys: (_developmentId, codes) => new Set(codes),
  buildImportCostCentreDescription: (row) => row.description || row.activity || row.costCode || '',
}));

import { canonicalFingerprintSource } from './ledgerFingerprint';
import { validateLedgerImport } from './ledgerValidationService';

const fields = [
  'supplier',
  'invoiceNumber',
  'transactionDate',
  'costCode',
  'transactionAmount',
  'description',
  'reference',
  'documentType',
  'vat',
];
const header = ['Supplier', 'Invoice', 'Date', 'Cost Code', 'Net', 'Description', 'Reference', 'Type', 'VAT'];

function validate(dataRows) {
  return validateLedgerImport([header, ...dataRows], 0, fields, {
    developmentId: 'dev-ledger',
    knownCostCodes: ['4000', '4100'],
  });
}

describe('Purchase Ledger transaction identity preview', () => {
  beforeEach(() => {
    state.existing = new Set();
  });

  it('accepts one supplier invoice allocated across different Cost Codes', () => {
    const result = validate([
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '100', 'Gas', 'SAGE-1', 'PI', '20'],
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4100', '200', 'Electricity', 'SAGE-2', 'PI', '40'],
    ]);
    expect(result).toMatchObject({ importedCount: 2, errorCount: 0, totalValue: 300 });
  });

  it('accepts same invoice and Cost Code when date or amount distinguishes the accounting fact', () => {
    const result = validate([
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '100', 'Gas', 'SAGE-1', 'PI', '20'],
      ['Fincher Utilities', 'INV-77', '2026-09-02', '4000', '100', 'Gas', 'SAGE-2', 'PI', '20'],
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '125', 'Gas', 'SAGE-3', 'PI', '25'],
    ]);
    expect(result).toMatchObject({ importedCount: 3, errorCount: 0, totalValue: 325 });
  });

  it('rejects identical supplier invoice facts and does not use a different reference as an invoice suffix', () => {
    const result = validate([
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '100', 'Gas', 'SAGE-1', 'PI', '20'],
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '100', 'Gas duplicate', 'SAGE-2', 'PI', '20'],
    ]);
    expect(result).toMatchObject({ importedCount: 1, errorCount: 1 });
    expect(result.errors[0].issues).toContain('Duplicate Transaction');
  });

  it('accepts a signed supplier-less journal with a source reference', () => {
    const result = validate([
      ['', '', '2026-09-03', '4000', '-250.50', 'Accrual reversal', 'JNL-42', 'Journal', '-50.10'],
    ]);
    expect(result).toMatchObject({ importedCount: 1, errorCount: 0, totalValue: -250.5 });
    expect(result.validRows[0]).toMatchObject({ supplier: '', reference: 'JNL-42', documentType: 'Journal', netAmount: -250.5, vat: -50.1 });
  });

  it('rejects a supplier-less row without a source reference', () => {
    const result = validate([
      ['', '', '2026-09-03', '4000', '250', 'Journal without identity', '', 'Journal', ''],
    ]);
    expect(result).toMatchObject({ importedCount: 0, errorCount: 1 });
    expect(result.errors[0].issues).toContain('Missing Reference for supplier-less transaction');
  });

  it('rejects descriptive variants of the same supplier-less source fact', () => {
    const result = validate([
      ['', '', '2026-09-03', '4000', '250', 'Accrual', 'JNL-42', 'Journal', ''],
      ['', '', '2026-09-03', '4000', '250', 'Accrual revised label', 'JNL-42', 'Nominal journal', ''],
    ]);
    expect(result).toMatchObject({ importedCount: 1, errorCount: 1 });
    expect(result.errors[0].issues).toContain('Duplicate Transaction');
  });

  it('rejects a transaction already represented by the authoritative identity', () => {
    state.existing.add(canonicalFingerprintSource({
      supplier: 'Fincher Utilities',
      invoiceNumber: 'INV-77',
      transactionDate: '2026-09-01',
      netAmount: 100,
      costCodeKey: '4000',
      description: 'Gas',
      reference: 'SAGE-1',
      documentType: 'PI',
    }));
    const result = validate([
      ['Fincher Utilities', 'INV-77', '2026-09-01', '4000', '100', 'Gas', 'SAGE-1', 'PI', '20'],
    ]);
    expect(result).toMatchObject({ importedCount: 0, errorCount: 1 });
    expect(result.errors[0].issues).toContain('Duplicate Transaction');
  });
});
