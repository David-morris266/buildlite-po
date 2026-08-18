import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => false,
}));

vi.mock('../ledger/ledgerAuthority', () => ({
  isLedgerServerAuthorityEnabled: () => false,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import { getCvrMutationCallCounts, resetCvrPeriodApiStore } from '../test/mockCvrPeriodApi';
import { getLedgerMutationCallCounts, resetLedgerApiStore } from '../test/mockPurchaseLedgerApi';
import { __resetCvrPeriodServerCacheForTests } from './cvrPeriodServerCache';
import { __resetLedgerServerCacheForTests } from '../ledger/ledgerServerCache';
import { addCostCentre } from './costCentreStore';
import {
  approveCvrPeriod,
  createOrOpenDraftPeriod,
  submitCvrPeriod,
} from './cvrPeriodStore';
import { appendTransactions, createTransaction } from '../ledger/ledgerTransactionStore';
import { AUTO_MIGRATE_ON_STARTUP } from './cvrLedgerMigration';

const DEV = 'dev-runtime-c';

describe('BL-031C runtime remains localStorage', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    storage.clear();
    __resetCvrPeriodServerCacheForTests();
    __resetLedgerServerCacheForTests();
    resetCvrPeriodApiStore();
    resetLedgerApiStore();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('authority OFF UI writes stay on localStorage and do not call server mutations', () => {
    const created = createOrOpenDraftPeriod(DEV);
    addCostCentre(DEV, {
      costCodeKey: '5231',
      costCodeLabel: '5231 — Cleaning',
      originalBudget: 100,
    }, created.periodKey);
    expect(submitCvrPeriod(DEV, created.periodKey).ok).toBe(true);
    expect(approveCvrPeriod(DEV, created.periodKey).ok).toBe(true);
    appendTransactions(DEV, [
      createTransaction({
        developmentId: DEV,
        supplier: 'Local Supplier',
        costCode: '5231',
        netAmount: 10,
        invoiceNumber: 'LOCAL-1',
      }),
    ]);

    const cvr = JSON.parse(localStorage.getItem('buildlite_cvr_v1'));
    const ledger = JSON.parse(localStorage.getItem('buildlite_purchase_ledgers_v1'));
    expect(cvr[DEV].periods.P01.status).toBe('locked');
    expect(ledger[DEV].transactions).toHaveLength(1);
    expect(getCvrMutationCallCounts().total).toBe(0);
    expect(getLedgerMutationCallCounts().total).toBe(0);
  });

  it('does not automatically migrate on app startup', () => {
    expect(AUTO_MIGRATE_ON_STARTUP).toBe(false);
    expect(getCvrMutationCallCounts().total).toBe(0);
    expect(getLedgerMutationCallCounts().total).toBe(0);
  });
});
