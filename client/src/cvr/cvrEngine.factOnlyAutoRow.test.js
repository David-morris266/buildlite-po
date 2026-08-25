import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const cvrAuthority = vi.hoisted(() => ({ value: false }));
const ceAuthority = vi.hoisted(() => ({ value: false }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('./cvrPeriodAuthority', () => ({
  isCvrServerAuthorityEnabled: () => cvrAuthority.value,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => ceAuthority.value,
  canUseCommercialEventsForFinancials: () => true,
}));

vi.mock('../payments/paymentCertificateStore.js', () => ({
  isApprovedCommercialCertificate: (certificate) => {
    const status = certificate?.status;
    return status === 'approved' || status === 'locked';
  },
  listCertificates: () => [],
  resolveCertificatesForPackage: () => ({
    ready: true,
    certificates: [],
    loadState: 'loaded',
    error: null,
  }),
  getCertificateCount: () => 0,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  getCvrMutationCallCounts,
  getLastCvrAddMemberPayload,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import { resetCommercialEventApiStore } from '../test/mockCommercialEventApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
} from './cvrPeriodServerCache';
import { __resetCommercialEventServerCacheForTests } from '../commercialEvents/commercialEventServerCache';
import { updateCostCentre, upsertAutoCostCentre } from './costCentreStore';
import { ensureDraftCvrOverlayMemberOnServer } from './cvrPeriodAuthorityWrites';
import { buildCvrModel, ensureDiscoveredCostCentres } from './cvrEngine';

const DEV = 'dev-fact-only-auto';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

const brickPo = {
  type: 'S',
  archived: false,
  approval: { status: 'approved' },
  status: 'approved',
  supplierId: 'sup-bricks',
  poNumber: 'S0011',
  developmentId: DEV,
  costRef: { costCode: '2300 — Brickwork — Brickwork', developmentId: DEV },
  subtotal: 250000,
  totals: { net: 250000 },
  supplierSnapshot: { name: 'Bricks R Us' },
};

function pos() {
  return [brickPo];
}

function row2300(model) {
  return model.rows.find((row) => row.costCodeKey === '2300');
}

describe('BL-037C fact-only auto-row overlay membership', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthority.value = true;
    ceAuthority.value = false;
    __resetCvrPeriodServerCacheForTests();
    __resetCommercialEventServerCacheForTests();
    resetCvrPeriodApiStore();
    resetCommercialEventApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        developmentId: DEV,
        periodKey: 'P01',
        id: PERIOD_ID,
      })
    );
    seedMockCvrInputs(PERIOD_ID, []);
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function hydrateEmptyOverlay() {
    await ensureCvrPeriodAndInputsReady(DEV, 'P01');
  }

  it('fact-only row appears without overlay and opening creates none', async () => {
    await hydrateEmptyOverlay();
    ensureDiscoveredCostCentres(DEV, pos(), 'P01');
    const model = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    const row = row2300(model);
    expect(row).toBeTruthy();
    expect(row.id).toBe('auto-2300');
    expect(row.isManual).toBe(false);
    expect(row.originalBudget).toBeNull();
    expect(row.currentBudget).toBeNull();
    expect(row.commercialAdjustment).toBe(0);
    expect(row.manualAccrual).toBe(0);
    expect(row.committed).toBe(250000);
    expect(row.systemForecast).toBe(250000);
    expect(getCvrMutationCallCounts().addMember).toBe(0);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
  });

  it('first overlay edit uses 037A membership then PATCH, without copying fact money', async () => {
    await hydrateEmptyOverlay();
    const before = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(row2300(before).id).toBe('auto-2300');
    expect(row2300(before).systemForecast).toBe(250000);

    const created = await upsertAutoCostCentre(
      DEV,
      { costCodeKey: '2300', costCodeLabel: '2300 — Brickwork' },
      'P01'
    );
    expect(created).toBeTruthy();
    expect(String(created.id).startsWith('auto-')).toBe(false);
    expect(created.originalBudget).toBeNull();
    expect(created.currentBudget).toBeNull();
    expect(created.commercialAdjustment).toBe(0);
    expect(created.manualAccrual).toBe(0);
    expect(created.version).toBe(1);
    expect(getCvrMutationCallCounts().addMember).toBe(1);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
    expect(getLastCvrAddMemberPayload().payload.costCodeKey).toBe('2300');
    expect(getLastCvrAddMemberPayload().payload.originalBudget).toBeUndefined();
    expect(getLastCvrAddMemberPayload().payload.committed).toBeUndefined();

    const afterMember = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(row2300(afterMember).committed).toBe(250000);
    expect(row2300(afterMember).systemForecast).toBe(250000);
    expect(row2300(afterMember).originalBudget).toBeNull();
    expect(row2300(afterMember).currentBudget).toBeNull();
    expect(row2300(afterMember).commercialAdjustment).toBe(0);
    expect(row2300(afterMember).finalForecast).toBe(250000);

    const patched = await updateCostCentre(DEV, created.id, { manualAccrual: 80 }, 'P01');
    expect(patched.ok).toBe(true);
    expect(patched.costCentre.manualAccrual).toBe(80);
    expect(patched.costCentre.originalBudget).toBeNull();
    expect(getCvrMutationCallCounts().patchInput).toBe(1);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
    expect(getCvrMutationCallCounts().addMember).toBe(1);

    const afterEdit = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(row2300(afterEdit).committed).toBe(250000);
    expect(row2300(afterEdit).systemForecast).toBe(250000);
    expect(row2300(afterEdit).manualAccrual).toBe(80);
    expect(row2300(afterEdit).originalBudget).toBeNull();
    expect(row2300(afterEdit).commercialAdjustment).toBe(0);
  });

  it('duplicate membership returns the existing overlay without overwrite', async () => {
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({
        id: 'existing-2300',
        periodId: PERIOD_ID,
        costCodeKey: '2300',
        costCodeLabel: '2300 — Brickwork',
        originalBudget: 9000,
        currentBudget: 9000,
        commercialAdjustment: 50,
        manualAccrual: 10,
        version: 4,
      }),
    ]);
    await ensureCvrPeriodsReadyForDevelopment(DEV);

    const result = await ensureDraftCvrOverlayMemberOnServer(DEV, 'P01', '2300');
    expect(result.ok).toBe(true);
    expect(result.alreadyMember).toBe(true);
    expect(result.costCentre.originalBudget).toBe(9000);
    expect(result.costCentre.commercialAdjustment).toBe(50);
    expect(result.costCentre.manualAccrual).toBe(10);
    expect(result.costCentre.version).toBe(4);
    expect(getCvrMutationCallCounts().createInput).toBe(0);
    expect(getCvrMutationCallCounts().addMember).toBe(1);
  });
});
