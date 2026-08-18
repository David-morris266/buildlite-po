import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const cvrAuthority = vi.hoisted(() => ({ value: false }));
const ledgerAuthority = vi.hoisted(() => ({ value: false }));
const certificateReady = vi.hoisted(() => ({ value: true }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthority.value,
}));

vi.mock('../ledger/ledgerAuthority', () => ({
  isLedgerServerAuthorityEnabled: () => ledgerAuthority.value,
}));

vi.mock('../payments/paymentCertificateStore.js', () => ({
  isApprovedCommercialCertificate: (certificate) => {
    const status = certificate?.status;
    return status === 'approved' || status === 'locked';
  },
  listCertificates: () => [],
  resolveCertificatesForPackage: () => ({
    ready: certificateReady.value,
    certificates: certificateReady.value ? [] : [],
    loadState: certificateReady.value ? 'loaded' : 'loading',
    error: null,
  }),
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import { resetLedgerApiStore } from '../test/mockPurchaseLedgerApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
} from './cvrPeriodServerCache';
import { __resetLedgerServerCacheForTests } from '../ledger/ledgerServerCache';
import { buildCvrModel } from './cvrEngine';
import { calculatePackageCertifiedValue } from './cvrCertifiedValue';

const DEV_ID = 'dev-cvr-ready';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

describe('CVR engine readiness (BL-031B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthority.value = false;
    ledgerAuthority.value = false;
    certificateReady.value = true;
    __resetCvrPeriodServerCacheForTests();
    __resetLedgerServerCacheForTests();
    resetCvrPeriodApiStore();
    resetLedgerApiStore();
    storage.clear();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('refuses a partial CVR model while period/inputs are unresolved', () => {
    cvrAuthority.value = true;
    const model = buildCvrModel(DEV_ID, { periodKey: 'P01' });
    expect(model.unavailable).toBe(true);
    expect(model.ready).toBe(false);
    expect(model.rows).toEqual([]);
    expect(model.summary.originalBudget).toBeNull();
    expect(model.summary.finalForecast).toBeNull();
    expect(model.summary.actualCost).toBeNull();
  });

  it('keeps CVR actual unavailable while ledger is unresolved', async () => {
    cvrAuthority.value = true;
    ledgerAuthority.value = true;
    seedMockCvrPeriod(
      DEV_ID,
      buildServerCvrPeriodFixture({ id: PERIOD_ID, developmentId: DEV_ID })
    );
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({
        periodId: PERIOD_ID,
        originalBudget: 10000,
        currentBudget: 10000,
      }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV_ID, 'P01');

    const model = buildCvrModel(DEV_ID, { periodKey: 'P01' });
    expect(model.unavailable).toBe(false);
    expect(model.ledgerReady).toBe(false);
    expect(model.summary.actualCost).toBeNull();
    expect(model.summary.costToComplete).toBeNull();
    expect(model.rows[0].actualCost).toBeNull();
  });

  it('certified readiness remains intact when certificates are unresolved', () => {
    certificateReady.value = false;
    expect(calculatePackageCertifiedValue('dev::sup::0120', { orderKey: 'dev::sup::0120' })).toBeNull();
  });
});
