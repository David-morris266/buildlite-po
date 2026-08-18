import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

import { executeLedgerImport } from './ledgerImportService';
import { getTotalActualCost, listImportHistory, listTransactions } from './ledgerTransactionStore';

const DEV_ID = 'dev-ledger-off';

describe('authority-OFF ledger import path (BL-031B regression)', () => {
  beforeEach(() => {
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  it('imports valid rows into localStorage and totals actuals from net', () => {
    const result = executeLedgerImport(
      DEV_ID,
      {
        canImport: true,
        validRows: [
          {
            supplier: 'Wipe It Cleaners',
            costCode: '5231',
            description: 'Cleaning',
            transactionDate: '2026-01-15',
            invoiceNumber: 'INV-OFF',
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
      },
      { fileName: 'actuals.csv', importProfile: 'Sage Purchase Ledger' }
    );

    expect(result.ok).toBe(true);
    expect(listTransactions(DEV_ID)).toHaveLength(1);
    expect(listTransactions(DEV_ID)[0].invoiceNumber).toBe('INV-OFF');
    expect(getTotalActualCost(DEV_ID)).toBe(2150);
    expect(listImportHistory(DEV_ID)[0].fileName).toBe('actuals.csv');
  });
});
