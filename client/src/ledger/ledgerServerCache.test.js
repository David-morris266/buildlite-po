import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  buildServerLedgerBatchFixture,
  buildServerLedgerTransactionFixture,
  getLedgerListCallCount,
  resetLedgerApiStore,
  seedMockLedgerBatches,
  seedMockLedgerTransactions,
  setLedgerListDelay,
  setLedgerListReject,
} from '../test/mockPurchaseLedgerApi';
import {
  __resetLedgerServerCacheForTests,
  ensureLedgerReadyForDevelopment,
  getCachedLedgerTransactions,
  getLedgerLoadState,
  refreshLedgerForDevelopment,
} from './ledgerServerCache';

const DEV_A = 'dev-ledger-a';
const DEV_B = 'dev-ledger-b';

describe('ledgerServerCache (BL-031B)', () => {
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

  it('loads ledger from idle/loading into loaded', async () => {
    setLedgerListDelay(20);
    seedMockLedgerTransactions(DEV_A, [buildServerLedgerTransactionFixture({ developmentId: DEV_A })]);
    seedMockLedgerBatches(DEV_A, [buildServerLedgerBatchFixture({ developmentId: DEV_A })]);

    expect(getLedgerLoadState(DEV_A)).toBe('idle');
    const pending = ensureLedgerReadyForDevelopment(DEV_A);
    expect(getLedgerLoadState(DEV_A)).toBe('loading');
    await pending;
    expect(getLedgerLoadState(DEV_A)).toBe('loaded');
    expect(getCachedLedgerTransactions(DEV_A)).toHaveLength(1);
    expect(getCachedLedgerTransactions(DEV_A)[0].netAmount).toBe(1000);
  });

  it('treats a loaded empty ledger as genuine empty', async () => {
    await ensureLedgerReadyForDevelopment(DEV_A);
    expect(getLedgerLoadState(DEV_A)).toBe('loaded');
    expect(getCachedLedgerTransactions(DEV_A)).toEqual([]);
  });

  it('records ledger cache error without collapsing to loaded empty', async () => {
    setLedgerListReject();
    await expect(ensureLedgerReadyForDevelopment(DEV_A)).rejects.toThrow(/Unable to load purchase ledger/);
    expect(getLedgerLoadState(DEV_A)).toBe('error');
    expect(getCachedLedgerTransactions(DEV_A)).toEqual([]);
  });

  it('deduplicates in-flight loads and refresh replaces cache', async () => {
    setLedgerListDelay(30);
    seedMockLedgerTransactions(DEV_A, [buildServerLedgerTransactionFixture({ developmentId: DEV_A })]);

    const [first, second] = await Promise.all([
      ensureLedgerReadyForDevelopment(DEV_A),
      ensureLedgerReadyForDevelopment(DEV_A),
    ]);
    expect(first.transactions).toHaveLength(1);
    expect(second.transactions).toHaveLength(1);
    expect(getLedgerListCallCount()).toBe(1);

    seedMockLedgerTransactions(DEV_A, [
      buildServerLedgerTransactionFixture({ developmentId: DEV_A, id: 't1' }),
      buildServerLedgerTransactionFixture({ developmentId: DEV_A, id: 't2', invoiceNumber: 'INV-2' }),
    ]);
    await refreshLedgerForDevelopment(DEV_A);
    expect(getCachedLedgerTransactions(DEV_A)).toHaveLength(2);
  });

  it('isolates development A from development B', async () => {
    seedMockLedgerTransactions(DEV_A, [
      buildServerLedgerTransactionFixture({ developmentId: DEV_A, netAmount: 1000 }),
    ]);
    seedMockLedgerTransactions(DEV_B, [
      buildServerLedgerTransactionFixture({
        developmentId: DEV_B,
        id: 't-b',
        netAmount: 9000,
      }),
    ]);

    await ensureLedgerReadyForDevelopment(DEV_A);
    await ensureLedgerReadyForDevelopment(DEV_B);

    expect(getCachedLedgerTransactions(DEV_A)[0].netAmount).toBe(1000);
    expect(getCachedLedgerTransactions(DEV_B)[0].netAmount).toBe(9000);
  });
});
