import { afterEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';
import {
  getLedgerTotalsForDevelopment,
  listLedgerTransactionsForDevelopment,
  PurchaseLedgerApiError,
} from './purchaseLedger';

describe('purchaseLedger API wrapper (BL-031B)', () => {
  let networkGuard;

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
    vi.unstubAllGlobals();
  });

  it('maps transaction list responses', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        expect(String(url)).toContain('/api/developments/dev-1/ledger/transactions');
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({ transactions: [{ id: 't1', costCodeKey: '5231', netAmount: 1000 }] }),
        };
      })
    );

    const listed = await listLedgerTransactionsForDevelopment('dev-1');
    expect(listed).toEqual([{ id: 't1', costCodeKey: '5231', netAmount: 1000 }]);
  });

  it('maps totals documents', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ totalNet: 1000, transactionCount: 1 }),
      }))
    );

    const totals = await getLedgerTotalsForDevelopment('dev-1');
    expect(totals.totalNet).toBe(1000);
  });

  it('throws structured PurchaseLedgerApiError on failure', async () => {
    networkGuard = installNetworkGuard();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: async () => JSON.stringify({ message: 'Ledger unavailable' }),
      }))
    );

    await expect(listLedgerTransactionsForDevelopment('dev-1')).rejects.toMatchObject({
      name: 'PurchaseLedgerApiError',
      status: 500,
      message: 'Ledger unavailable',
    });
    expect(PurchaseLedgerApiError.name).toBe('PurchaseLedgerApiError');
  });
});
