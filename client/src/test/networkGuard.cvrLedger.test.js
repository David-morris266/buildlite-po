import { afterEach, describe, expect, it } from 'vitest';
import { installNetworkGuard } from './networkGuard';
import { listCvrPeriodsForDevelopment } from '../api/cvrPeriods';
import { listLedgerTransactionsForDevelopment } from '../api/purchaseLedger';

describe('networkGuard CVR/ledger API (BL-031B)', () => {
  let networkGuard;

  afterEach(() => {
    networkGuard?.restore();
  });

  it('prevents localhost:3001 from client tests for CVR and ledger reads', async () => {
    networkGuard = installNetworkGuard();

    await expect(listCvrPeriodsForDevelopment('dev-1')).rejects.toThrow(/NETWORK GUARD/);
    await expect(listLedgerTransactionsForDevelopment('dev-1')).rejects.toThrow(/NETWORK GUARD/);
    expect(() => networkGuard.assertNoLiveApiCalls()).toThrow(/Live API calls detected/);
  });
});
