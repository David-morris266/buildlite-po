import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const authorityEnabled = vi.hoisted(() => ({ value: false }));

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
  buildServerLedgerTransactionFixture,
  resetLedgerApiStore,
  seedMockLedgerTransactions,
  setLedgerListReject,
} from '../test/mockPurchaseLedgerApi';
import {
  __resetLedgerServerCacheForTests,
  ensureLedgerReadyForDevelopment,
} from './ledgerServerCache';
import {
  appendTransactions,
  createTransaction,
  getTotalActualCost,
  listTransactions,
} from './ledgerTransactionStore';

const DEV_ID = 'dev-ledger-auth';
const STORAGE_KEY = 'buildlite_purchase_ledgers_v1';

function seedLocalTransaction() {
  appendTransactions(DEV_ID, [
    createTransaction({
      developmentId: DEV_ID,
      supplier: 'Local Supplier',
      costCode: '5231',
      netAmount: 777,
      invoiceNumber: 'LOCAL-1',
    }),
  ]);
}

describe('ledger authority reads (BL-031B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    authorityEnabled.value = false;
    __resetLedgerServerCacheForTests();
    resetLedgerApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF ledger reads localStorage', () => {
    seedLocalTransaction();
    expect(listTransactions(DEV_ID)).toHaveLength(1);
    expect(listTransactions(DEV_ID)[0].invoiceNumber).toBe('LOCAL-1');
    expect(getTotalActualCost(DEV_ID)).toBe(777);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_ID].transactions).toHaveLength(1);
  });

  it('authority ON ledger reads cache once loaded', async () => {
    seedLocalTransaction();
    authorityEnabled.value = true;
    seedMockLedgerTransactions(DEV_ID, [
      buildServerLedgerTransactionFixture({
        developmentId: DEV_ID,
        invoiceNumber: 'SERVER-1',
        netAmount: 1000,
      }),
    ]);

    await ensureLedgerReadyForDevelopment(DEV_ID);

    expect(listTransactions(DEV_ID)).toHaveLength(1);
    expect(listTransactions(DEV_ID)[0].invoiceNumber).toBe('SERVER-1');
    expect(getTotalActualCost(DEV_ID)).toBe(1000);
  });

  it('unresolved ledger actual is not £0', () => {
    seedLocalTransaction();
    authorityEnabled.value = true;

    expect(listTransactions(DEV_ID)).toEqual([]);
    expect(getTotalActualCost(DEV_ID)).toBeNull();
  });

  it('authority ON error has no localStorage fallback', async () => {
    seedLocalTransaction();
    authorityEnabled.value = true;
    setLedgerListReject();

    await expect(ensureLedgerReadyForDevelopment(DEV_ID)).rejects.toThrow();
    expect(listTransactions(DEV_ID)).toEqual([]);
    expect(getTotalActualCost(DEV_ID)).toBeNull();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[DEV_ID].transactions).toHaveLength(1);
  });
});
