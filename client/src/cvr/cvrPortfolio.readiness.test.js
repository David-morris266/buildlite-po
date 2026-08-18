import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const cvrAuthority = vi.hoisted(() => ({ value: false }));
const developments = vi.hoisted(() => ({ items: [] }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthority.value,
}));

vi.mock('../developments/developmentStore', () => ({
  listDevelopments: () => developments.items,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrPeriodListReject,
} from '../test/mockCvrPeriodApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
} from './cvrPeriodServerCache';
import { buildCvrPortfolioModel } from './cvrPeriodHelpers';

const DEV_OK = {
  id: 'dev-ok',
  developmentName: 'Loaded Site',
  jobNumber: 'LS1',
};
const DEV_BAD = {
  id: 'dev-bad',
  developmentName: 'Failed Site',
  jobNumber: 'FS1',
};
const PERIOD_OK = '11111111-2222-4333-8444-aaaaaaaaaaaa';

describe('CVR portfolio unresolved developments (BL-031B)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthority.value = true;
    __resetCvrPeriodServerCacheForTests();
    resetCvrPeriodApiStore();
    storage.clear();
    developments.items = [DEV_OK, DEV_BAD];
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('does not treat an unresolved development as a £0 forecast', async () => {
    seedMockCvrPeriod(
      DEV_OK.id,
      buildServerCvrPeriodFixture({
        id: PERIOD_OK,
        developmentId: DEV_OK.id,
        periodKey: 'P01',
      })
    );
    seedMockCvrInputs(PERIOD_OK, [
      buildServerCvrInputFixture({
        periodId: PERIOD_OK,
        originalBudget: 25000,
        currentBudget: 25000,
      }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV_OK.id, 'P01');

    const portfolio = buildCvrPortfolioModel([]);
    const loaded = portfolio.rows.find((row) => row.developmentId === DEV_OK.id);
    const unresolved = portfolio.rows.find((row) => row.developmentId === DEV_BAD.id);

    expect(loaded.forecastLabel).not.toBe('£0.00');
    expect(unresolved.unresolved).toBe(true);
    expect(unresolved.forecastLabel).toBe('—');
    expect(portfolio.summaryCards.find((card) => card.label === 'Portfolio Forecast').value).not.toBe(
      '£0.00'
    );
  });

  it('a failing development does not silently become zero', async () => {
    seedMockCvrPeriod(
      DEV_OK.id,
      buildServerCvrPeriodFixture({ id: PERIOD_OK, developmentId: DEV_OK.id })
    );
    seedMockCvrInputs(PERIOD_OK, [
      buildServerCvrInputFixture({ periodId: PERIOD_OK, originalBudget: 25000, currentBudget: 25000 }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV_OK.id, 'P01');

    setCvrPeriodListReject();
    await expect(ensureCvrPeriodsReadyForDevelopment(DEV_BAD.id)).rejects.toThrow();

    const portfolio = buildCvrPortfolioModel([]);
    const failed = portfolio.rows.find((row) => row.developmentId === DEV_BAD.id);
    expect(failed.loadState).toBe('error');
    expect(failed.forecastLabel).toBe('—');
  });
});
