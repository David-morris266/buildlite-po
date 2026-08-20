import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/revenueSettings', () => import('../test/mockRevenueSettingsApi'));

import {
  buildServerRevenueSettingsFixture,
  getRevenueSettingsCallCounts,
  resetRevenueSettingsApiStore,
  seedMockRevenueSettings,
} from '../test/mockRevenueSettingsApi';
import {
  AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP,
  REVENUE_SETTINGS_MIGRATION_INVOCATION,
  executeRevenueSettingsMigration,
  preflightRevenueSettingsMigration,
} from './revenueSettingsMigration';
import { REVENUE_STORAGE_KEY } from './revenueStore';

const DEV = 'dev-rev-mig';

function seedLocal(developmentId, record) {
  const current = storage.get(REVENUE_STORAGE_KEY);
  const parsed = current ? JSON.parse(current) : {};
  parsed[developmentId] = record;
  storage.set(REVENUE_STORAGE_KEY, JSON.stringify(parsed));
}

describe('BL-032A revenue settings migration', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    resetRevenueSettingsApiStore();
    storage.clear();
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('is manual-only and never auto-migrates on startup', () => {
    expect(AUTO_MIGRATE_REVENUE_SETTINGS_ON_STARTUP).toBe(false);
    expect(REVENUE_SETTINGS_MIGRATION_INVOCATION).toBe('manual-only');
    expect(getRevenueSettingsCallCounts().put).toBe(0);
  });

  it('preflight reports missing server when local strategy exists', async () => {
    seedLocal(DEV, {
      revenueStrategy: { openMarket: { ratePerFt2: 380, effectiveDate: '2026-01-01' } },
      houseTypePricing: {},
      revenueAdjustments: [],
      recognitionSettings: {},
    });

    const plan = await preflightRevenueSettingsMigration(DEV);
    expect(plan.ok).toBe(true);
    expect(plan.safeToExecute).toBe(true);
    expect(plan.classification).toBe('MISSING_SERVER');
    expect(plan.local.revenueStrategy.openMarket.ratePerFt2).toBe(380);
  });

  it('execute requires confirm: true', async () => {
    seedLocal(DEV, {
      revenueStrategy: { openMarket: { ratePerFt2: 380, effectiveDate: '' } },
    });
    const blocked = await executeRevenueSettingsMigration(DEV, {});
    expect(blocked.ok).toBe(false);
    expect(blocked.executed).toBe(false);
    expect(blocked.errors[0]).toMatch(/confirm: true/);
    expect(getRevenueSettingsCallCounts().put).toBe(0);
  });

  it('execute is idempotent after a successful first write', async () => {
    seedLocal(DEV, {
      recognitionPolicy: 'completion',
      revenueStrategy: {
        openMarket: { ratePerFt2: 380, effectiveDate: '' },
        affordableHousing: {
          affordableRent: 58,
          sharedOwnership: 72,
          firstHomes: 70,
          additionality: 65,
          discountMarketSale: 70,
          other: 100,
        },
        garagePremiums: { none: 0, single: 12500, double: 22500 },
      },
      houseTypePricing: {},
      revenueAdjustments: [],
      recognitionSettings: {},
    });

    const first = await executeRevenueSettingsMigration(DEV, { confirm: true });
    expect(first.ok).toBe(true);
    expect(first.executed).toBe(true);
    expect(first.settings.version).toBe(1);

    const second = await executeRevenueSettingsMigration(DEV, { confirm: true });
    expect(second.ok).toBe(true);
    expect(second.alreadyMigrated).toBe(true);
    expect(second.executed).toBe(false);
    expect(getRevenueSettingsCallCounts().put).toBe(1);
    expect(JSON.parse(localStorage.getItem(REVENUE_STORAGE_KEY))[DEV]).toBeTruthy();
  });

  it('refuses to overwrite conflicting server settings', async () => {
    seedLocal(DEV, {
      revenueStrategy: { openMarket: { ratePerFt2: 380, effectiveDate: '' } },
    });
    seedMockRevenueSettings(
      DEV,
      buildServerRevenueSettingsFixture({
        id: 'existing',
        developmentId: DEV,
        exists: true,
        version: 1,
        revenueStrategy: { openMarket: { ratePerFt2: 350, effectiveDate: '' } },
      })
    );

    const plan = await preflightRevenueSettingsMigration(DEV);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.classification).toBe('CONFLICT');

    const executed = await executeRevenueSettingsMigration(DEV, { confirm: true });
    expect(executed.ok).toBe(false);
    expect(executed.executed).toBe(false);
    expect(getRevenueSettingsCallCounts().put).toBe(0);
  });
});
