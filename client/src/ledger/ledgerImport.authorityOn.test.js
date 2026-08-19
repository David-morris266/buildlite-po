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
  getLedgerMutationCallCounts,
  resetLedgerApiStore,
  setLedgerMutationReject,
} from '../test/mockPurchaseLedgerApi';
import { __resetLedgerServerCacheForTests, getCachedLedgerTransactions } from './ledgerServerCache';
import { executeLedgerImport } from './ledgerImportService';
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
