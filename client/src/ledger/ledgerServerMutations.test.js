import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  PurchaseLedgerApiError,
  getLedgerMutationCallCounts,
  resetLedgerApiStore,
  seedMockLedgerTransactions,
  setLedgerMutationReject,
  buildServerLedgerTransactionFixture,
} from '../test/mockPurchaseLedgerApi';
import {
  __resetLedgerServerCacheForTests,
  getCachedLedgerBatches,
  getCachedLedgerTransactions,
  replaceCachedLedgerTotals,
} from './ledgerServerCache';
import {
  applyLedgerTotalsToCache,
  importServerLedgerBatch,
  reverseServerLedgerTransaction,
} from './ledgerServerMutations';

const DEV = 'dev-ledger-mut';

describe('ledger server mutations (BL-031C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    __resetLedgerServerCacheForTests();
    resetLedgerApiStore();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('imports a batch and caches transactions', async () => {
    const result = await importServerLedgerBatch(DEV, {
      originalFileName: 'actuals.csv',
      sourceProfile: 'Sage Purchase Ledger',
      transactions: [
        {
          supplier: 'Wipe It Cleaners',
          costCodeKey: '5231',
          transactionDate: '2026-01-15',
          invoiceNumber: 'INV-1',
          netAmount: 1000,
          vatAmount: 200,
          grossAmount: 1200,
          description: 'January invoice',
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.batch.originalFileName).toBe('actuals.csv');
    expect(result.transactions).toHaveLength(1);
    expect(getCachedLedgerTransactions(DEV)).toHaveLength(1);
    expect(getCachedLedgerBatches(DEV)).toHaveLength(1);
    expect(getLedgerMutationCallCounts().import).toBe(1);
  });

  it('reverses a transaction and caches the reversal', async () => {
    const imported = await importServerLedgerBatch(DEV, {
      originalFileName: 'actuals.csv',
      transactions: [
        {
          supplier: 'Wipe It Cleaners',
          costCodeKey: '5231',
          transactionDate: '2026-01-15',
          invoiceNumber: 'INV-1',
          netAmount: 1000,
        },
      ],
    });
    const result = await reverseServerLedgerTransaction(DEV, imported.transactions[0].id);
    expect(result.ok).toBe(true);
    expect(result.transaction.reversesId).toBe(imported.transactions[0].id);
    expect(result.transaction.netAmount).toBe(-1000);
    expect(getCachedLedgerTransactions(DEV)).toHaveLength(2);
  });

  it('returns a typed duplicate error without throwing', async () => {
    setLedgerMutationReject(
      new PurchaseLedgerApiError('Duplicate ledger transaction fingerprint. The batch was not imported.', {
        status: 409,
        body: {
          message: 'Duplicate ledger transaction fingerprint. The batch was not imported.',
          duplicates: ['abc123'],
        },
      })
    );
    const result = await importServerLedgerBatch(DEV, {
      transactions: [
        {
          supplier: 'A',
          costCodeKey: '5231',
          transactionDate: '2026-01-15',
          netAmount: 1,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(409);
    expect(result.duplicates).toEqual(['abc123']);
  });

  it('patches cached ledger totals', () => {
    seedMockLedgerTransactions(DEV, [buildServerLedgerTransactionFixture({ developmentId: DEV })]);
    const totals = applyLedgerTotalsToCache(DEV, { totalNet: 50, transactionCount: 1 });
    expect(totals.totalNet).toBe(50);
    expect(replaceCachedLedgerTotals(DEV, { totalNet: 75 }).totalNet).toBe(75);
  });
});
