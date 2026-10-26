const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLedgerImportBody, validateLedgerTransactionInput } = require('../services/ledgerValidation');

const base = {
  transactionDate: '2026-09-01',
  costCodeKey: '4000',
  netAmount: 100,
  description: 'Ledger fact',
};

test('supplier-less journal requires and preserves its source reference', () => {
  const accepted = validateLedgerTransactionInput({
    ...base,
    supplier: '',
    reference: 'JNL-42',
    documentType: 'Journal',
    vatAmount: -20,
    netAmount: -100,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.supplier, '');
  assert.equal(accepted.value.reference, 'JNL-42');
  assert.equal(accepted.value.documentType, 'Journal');
  assert.equal(accepted.value.netAmount, -100);
  assert.equal(accepted.value.vatAmount, -20);

  const missingReference = validateLedgerTransactionInput({ ...base, supplier: '' });
  assert.equal(missingReference.ok, false);
  assert.match(missingReference.errors.join(' '), /reference is required when supplier is blank/i);
});

test('whitespace-only supplier is rejected rather than treated as absent evidence', () => {
  const result = validateLedgerTransactionInput({ ...base, supplier: '   ', reference: 'JNL-42' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /supplier must be blank or contain a supplier name/i);
});

test('split invoice identities are distinct by Cost Code, date or signed amount', () => {
  const body = validateLedgerImportBody({
    transactions: [
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', costCodeKey: '4000' },
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', costCodeKey: '4100' },
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', transactionDate: '2026-09-02' },
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', netAmount: -25 },
    ],
  });
  assert.equal(body.ok, true);
  assert.equal(body.value.transactions.length, 4);
});

test('reference does not distinguish an otherwise identical supplier invoice fact', () => {
  const body = validateLedgerImportBody({
    transactions: [
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', reference: 'SAGE-1' },
      { ...base, supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', reference: 'SAGE-2' },
    ],
  });
  assert.equal(body.ok, false);
  assert.match(body.errors.join(' '), /Duplicate transaction in this batch/i);
});

test('supplier-less source reference and financial identity reject descriptive duplicate variants', () => {
  const body = validateLedgerImportBody({
    transactions: [
      { ...base, supplier: '', reference: 'JNL-42', description: 'Accrual', documentType: 'Journal' },
      { ...base, supplier: '', reference: 'JNL-42', description: 'Accrual revised label', documentType: 'Nominal journal' },
    ],
  });
  assert.equal(body.ok, false);
  assert.match(body.errors.join(' '), /Duplicate transaction in this batch/i);
});
