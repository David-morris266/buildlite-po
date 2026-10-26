import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: true }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./ledgerAuthority', () => ({
  isLedgerServerAuthorityEnabled: () => authorityEnabled.value,
}));

vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  PurchaseLedgerApiError,
  getLastLedgerImportPayload,
  getLedgerMutationCallCounts,
  resetLedgerApiStore,
  setLedgerMutationReject,
} from '../test/mockPurchaseLedgerApi';
import { __resetLedgerServerCacheForTests, getCachedLedgerTransactions } from './ledgerServerCache';
import { buildLedgerValidationResult, executeLedgerImport } from './ledgerImportService';
import { parseCsvText } from './csvImport';
import { listTransactions } from './ledgerTransactionStore';

const DEV = 'dev-ledger-on';
const STORAGE_KEY = 'buildlite_purchase_ledgers_v1';

const validImport = {
  canImport: true,
  validRows: [
    {
      supplier: 'Wipe It Cleaners',
      costCode: '5231',
      description: 'Cleaning',
      transactionDate: '2026-01-15',
      invoiceNumber: 'INV-ON',
      netAmount: 2150,
      vat: 430,
      grossAmount: 2580,
      source: 'Sage Purchase Ledger',
    },
  ],
  importedCount: 1,
  errorCount: 0,
  warningCount: 0,
  totalValue: 2150,
};

describe('BL-031D ledger authority-on import', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = true;
    __resetLedgerServerCacheForTests();
    resetLedgerApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('imports through the server mutation and refreshes cache', async () => {
    const result = await executeLedgerImport(DEV, validImport, {
      fileName: 'actuals.csv',
      importProfile: 'Sage Purchase Ledger',
    });
    expect(result.ok).toBe(true);
    expect(getLedgerMutationCallCounts().import).toBe(1);
    expect(getCachedLedgerTransactions(DEV)).toHaveLength(1);
    expect(listTransactions(DEV)[0].netAmount).toBe(2150);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('validates CSV, maps split invoices and supplier-less journals, then submits every accepted fact', async () => {
    const rows = parseCsvText([
      'Supplier,Invoice,Date,Cost Code,Net,Description,Reference,Type,VAT',
      'Fincher Utilities,INV-77,2026-09-01,4000,100,Gas,SAGE-1,Invoice,20',
      'Fincher Utilities,INV-77,2026-09-01,4100,200,Electricity,SAGE-2,Invoice,40',
      ',,2026-09-03,4000,-25.50,Accrual reversal,JNL-42,Journal,-5.10',
      '"   ",,2026-09-04,4100,10,Internal transfer,JNL-43,Journal,0',
      ',,2026-09-05,4000,50,Missing journal identity,,Journal,10',
      'Fincher Utilities,INV-77,2026-09-01,4000,100,Duplicate allocation,SAGE-DUP,Invoice,20',
    ].join('\n'));
    const parsed = {
      rows,
      headerRowIndex: 0,
      headers: rows[0],
      fieldByColumn: [
        'supplier',
        'invoiceNumber',
        'transactionDate',
        'costCode',
        'transactionAmount',
        'description',
        'reference',
        'documentType',
        'vat',
      ],
    };
    const validation = buildLedgerValidationResult(parsed, {
      developmentId: DEV,
      knownCostCodes: ['4000', '4100'],
    });

    expect(validation).toMatchObject({
      canImport: true,
      rowCount: 6,
      importedCount: 4,
      errorCount: 2,
      totalValue: 284.5,
    });
    expect(validation.errors.map((entry) => entry.issues)).toEqual(expect.arrayContaining([
      expect.arrayContaining(['Missing Reference for supplier-less transaction']),
      expect.arrayContaining(['Duplicate Transaction']),
    ]));

    const result = await executeLedgerImport(DEV, validation, {
      fileName: 'sage-project-profitability.csv',
      importProfile: 'Sage Purchase Ledger',
    });
    expect(result).toMatchObject({ ok: true, importedCount: 4, totalValue: 284.5 });

    const submitted = getLastLedgerImportPayload();
    expect(submitted.transactions).toHaveLength(4);
    expect(submitted.transactions.reduce((sum, row) => sum + row.netAmount, 0)).toBe(284.5);
    expect(submitted.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', costCodeKey: '4000', netAmount: 100, vatAmount: 20, reference: 'SAGE-1' }),
      expect.objectContaining({ supplier: 'Fincher Utilities', invoiceNumber: 'INV-77', costCodeKey: '4100', netAmount: 200, vatAmount: 40, reference: 'SAGE-2' }),
      expect.objectContaining({ supplier: '', costCodeKey: '4000', netAmount: -25.5, vatAmount: -5.1, reference: 'JNL-42', documentType: 'Journal', description: 'Accrual reversal' }),
      expect.objectContaining({ supplier: '', costCodeKey: '4100', netAmount: 10, vatAmount: 0, reference: 'JNL-43', documentType: 'Journal', description: 'Internal transfer' }),
    ]));
  });

  it('duplicate fingerprint is visible and does not write localStorage', async () => {
    const first = await executeLedgerImport(DEV, validImport, { fileName: 'actuals.csv' });
    expect(first.ok).toBe(true);
    const duplicate = await executeLedgerImport(DEV, validImport, { fileName: 'actuals.csv' });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.status).toBe(409);
    expect(duplicate.errors[0]).toMatch(/duplicate/i);
    expect(getCachedLedgerTransactions(DEV)).toHaveLength(1);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('failure is visible with no local fallback', async () => {
    setLedgerMutationReject(
      new PurchaseLedgerApiError('Unable to import purchase ledger.', { status: 500 })
    );
    const result = await executeLedgerImport(DEV, validImport, { fileName: 'actuals.csv' });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(getCachedLedgerTransactions(DEV)).toHaveLength(0);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
