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
    certificates: [
      {
        id: 'cert-wipe-1',
        status: 'locked',
        certificateNumber: 1,
        grossValue: 2250,
        netValue: 2150,
        recoverySigned: -100,
      },
    ],
    loadState: 'loaded',
    error: null,
  }),
  getCertificateCount: () => 4,
}));

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/commercialEvents', () => import('../test/mockCommercialEventApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import {
  buildApprovedVariationFixture,
  resetCommercialEventApiStore,
} from '../test/mockCommercialEventApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
} from './cvrPeriodServerCache';
import {
  __resetCommercialEventServerCacheForTests,
  ensureCommercialEventsReadyForDevelopment,
  getCommercialEventFinancialReadiness,
} from '../commercialEvents/commercialEventServerCache';
import { addCostCentre, updateCostCentre } from './costCentreStore';
import { buildCvrModel } from './cvrEngine';
import { createOrOpenDraftPeriod } from './cvrPeriodStore';

const DEV = 'dev-1785599776666-zck5pl';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';
const INPUT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SUPPLIER_ID = 'sup-1786619149194';
const ORDER_KEY = `${DEV}::${SUPPLIER_ID}::5231 — cleaning — cleaning`;

const wipePo = {
  type: 'S',
  archived: false,
  approval: { status: 'approved' },
  status: 'approved',
  supplierId: SUPPLIER_ID,
  poNumber: 'S0012',
  developmentId: DEV,
  costRef: { costCode: '5231 — Cleaning — Cleaning', developmentId: DEV },
  subtotal: 50000,
  totals: { net: 50000 },
  supplierSnapshot: { name: 'Wipe It Cleaners' },
};

const otherPo = {
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
  return [wipePo, otherPo];
}

describe('CVR committed values remain after cost-code save', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthority.value = false;
    ceAuthority.value = false;
    __resetCvrPeriodServerCacheForTests();
    __resetCommercialEventServerCacheForTests();
    resetCvrPeriodApiStore();
    resetCommercialEventApiStore();
    storage.clear();
    localStorage.setItem('userName', 'Test QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  async function hydrateAuthorityOn() {
    cvrAuthority.value = true;
    ceAuthority.value = true;
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        developmentId: DEV,
        periodKey: 'P01',
        id: PERIOD_ID,
      })
    );
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({
        id: INPUT_ID,
        periodId: PERIOD_ID,
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        originalBudget: 0,
        currentBudget: 0,
        commercialAdjustment: 0,
        manualAccrual: 0,
      }),
      buildServerCvrInputFixture({
        id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
        periodId: PERIOD_ID,
        costCodeKey: '2300',
        costCodeLabel: '2300 — Brickwork',
        originalBudget: 0,
        currentBudget: 0,
        commercialAdjustment: 0,
        manualAccrual: 0,
      }),
    ]);
    buildApprovedVariationFixture({
      id: 'ce-0020',
      developmentId: DEV,
      orderKey: ORDER_KEY,
      eventNumber: 'CE-0020',
      value: 250,
    });
    await ensureCvrPeriodAndInputsReady(DEV, 'P01');
    await ensureCommercialEventsReadyForDevelopment(DEV);
  }

  function row5231(model) {
    return model.rows.find((row) => row.costCodeKey === '5231');
  }

  it('authority-on worksheet keeps committed values after accrual and adjustment saves', async () => {
    await hydrateAuthorityOn();
    expect(getCommercialEventFinancialReadiness(DEV).ready).toBe(true);

    const initial = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(initial.summary.committed).toBe(300250);
    expect(row5231(initial).committed).toBe(50250);
    expect(row5231(initial).certified).toBe(2150);
    expect(row5231(initial).actualCost).toBe(0);

    const accrualSave = await updateCostCentre(DEV, INPUT_ID, { manualAccrual: 100 }, 'P01');
    expect(accrualSave.ok).toBe(true);
    await ensureCommercialEventsReadyForDevelopment(DEV);

    const afterAccrual = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(getCommercialEventFinancialReadiness(DEV).ready).toBe(true);
    expect(afterAccrual.summary.committed).toBe(300250);
    expect(row5231(afterAccrual).committed).toBe(50250);
    expect(row5231(afterAccrual).certified).toBe(2150);
    expect(row5231(afterAccrual).actualCost).toBe(0);
    expect(row5231(afterAccrual).manualAccrual).toBe(100);
    expect(row5231(afterAccrual).currentCost).toBe(100);
    expect(row5231(afterAccrual).systemForecast).toBe(50250);
    expect(row5231(afterAccrual).finalForecast).toBe(50250);
    expect(row5231(afterAccrual).costToComplete).toBe(50150);

    const adjustmentSave = await updateCostCentre(
      DEV,
      INPUT_ID,
      { commercialAdjustment: 500, commercialReason: 'QS overlay' },
      'P01'
    );
    expect(adjustmentSave.ok).toBe(true);
    await ensureCommercialEventsReadyForDevelopment(DEV);

    const afterAdjustment = buildCvrModel(DEV, { periodKey: 'P01', pos: pos() });
    expect(afterAdjustment.summary.committed).toBe(300250);
    expect(row5231(afterAdjustment).committed).toBe(50250);
    expect(row5231(afterAdjustment).certified).toBe(2150);
    expect(row5231(afterAdjustment).manualAccrual).toBe(100);
    expect(row5231(afterAdjustment).commercialAdjustment).toBe(500);
    expect(row5231(afterAdjustment).finalForecast).toBe(50750);
    expect(row5231(afterAdjustment).costToComplete).toBe(50650);
  });

  it('authority OFF still keeps local committed values after an explicit accrual save', () => {
    const created = createOrOpenDraftPeriod(DEV);
    const added = addCostCentre(
      DEV,
      {
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        originalBudget: 0,
        currentBudget: 0,
        manualAccrual: 0,
      },
      created.periodKey
    );
    const initial = buildCvrModel(DEV, { periodKey: created.periodKey, pos: pos() });
    expect(row5231(initial).committed).toBe(50000);

    const saved = updateCostCentre(DEV, added.costCentre.id, { manualAccrual: 100 }, created.periodKey);
    expect(saved.ok).toBe(true);

    const after = buildCvrModel(DEV, { periodKey: created.periodKey, pos: pos() });
    expect(row5231(after).committed).toBe(50000);
    expect(row5231(after).manualAccrual).toBe(100);
    expect(row5231(after).currentCost).toBe(100);
  });
});
