import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const cvrAuthority = vi.hoisted(() => ({ value: false }));
const ledgerAuthority = vi.hoisted(() => ({ value: false }));
const mockOrders = vi.hoisted(() => []);
const mockCertificates = vi.hoisted(() => new Map());
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

vi.mock('../ledger/ledgerAuthority', () => ({
  isLedgerServerAuthorityEnabled: () => ledgerAuthority.value,
}));

vi.mock('../payments/subcontractOrders.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    buildSubcontractOrdersFromPos: () => mockOrders,
  };
});

vi.mock('../payments/paymentCertificateStore.js', () => ({
  isApprovedCommercialCertificate: (certificate) => {
    const status = certificate?.status;
    return status === 'approved' || status === 'locked';
  },
  listCertificates: (orderKey) => mockCertificates.get(orderKey) || [],
  resolveCertificatesForPackage: (orderKey) => ({
    ready: true,
    certificates: mockCertificates.get(orderKey) || [],
    loadState: 'loaded',
    error: null,
  }),
  getCertificateCount: () => 0,
}));

vi.mock('../developments/developmentStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listDevelopments: () => developments.items,
    getDevelopment: (id) => developments.items.find((item) => item.id === id) || null,
  };
});

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  buildServerCvrSnapshotFixture,
  buildServerCvrSnapshotRowFixture,
  buildServerCvrRevenueSnapshotFixture,
  buildServerCvrSnapshotPlotFixture,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
  setCvrInputListReject,
} from '../test/mockCvrPeriodApi';
import { resetLedgerApiStore } from '../test/mockPurchaseLedgerApi';
import {
  __resetCvrPeriodServerCacheForTests,
  ensureCvrPeriodAndInputsReady,
  ensureCvrPeriodsReadyForDevelopment,
  getCachedCvrPeriods,
  upsertCachedCvrPeriod,
} from './cvrPeriodServerCache';
import { __resetLedgerServerCacheForTests } from '../ledger/ledgerServerCache';
import { addCostCentre } from './costCentreStore';
import { buildCvrModel } from './cvrEngine';
import { buildCvrWorkspaceModel } from './cvrHelpers';
import {
  CVR_HISTORIC_UNAVAILABLE_SHORT,
  CVR_HISTORIC_REVENUE_UNAVAILABLE,
} from './cvrHistoricConstants';
import {
  buildCvrPeriodRegisterRow,
  buildCvrPortfolioDevelopmentRow,
} from './cvrPeriodHelpers';
import {
  approveServerCvrPeriod,
  createServerCvrPeriod,
  createServerCvrPeriodInput,
  submitServerCvrPeriod,
} from './cvrPeriodServerMutations';
import {
  approveCvrPeriod,
  createNextCvrPeriod,
  createOrOpenDraftPeriod,
  submitCvrPeriod,
} from './cvrPeriodStore';
import { buildCvrSummaryModel } from './cvrSummaryHelpers';
import { appendTransactions, createTransaction } from '../ledger/ledgerTransactionStore';

const DEV = 'dev-historic-e4';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';
const development = {
  id: DEV,
  developmentName: 'Test Site 1',
  jobNumber: 'TS1',
  plotMaster: {
    plots: [
      {
        id: 'plot-live',
        plotNumber: '31',
        houseType: 'Arundel',
        revenueStatus: 'Available',
        revenueSource: 'Manual Value',
        manualForecastValue: 999999,
        forecastSellingPrice: 999999,
        sellingPrice: 0,
      },
    ],
  },
};

function frozenSnapshot(overrides = {}) {
  return buildServerCvrSnapshotFixture({
    developmentId: DEV,
    periodId: PERIOD_ID,
    periodKey: 'P01',
    rows: [
      buildServerCvrSnapshotRowFixture({
        snapshotId: 'snap-p01',
        costCodeKey: '5231',
      }),
    ],
    ...overrides,
  });
}

async function seedLockedSnapshot(snapshot = frozenSnapshot()) {
  cvrAuthority.value = true;
  seedMockCvrPeriod(
    DEV,
    buildServerCvrPeriodFixture({
      id: PERIOD_ID,
      developmentId: DEV,
      status: 'locked',
      snapshot,
      snapshotDeferred: false,
      approvedAt: '2026-04-01T12:00:00.000Z',
    })
  );
  seedMockCvrInputs(PERIOD_ID, [
    buildServerCvrInputFixture({
      periodId: PERIOD_ID,
      costCodeKey: '5231',
      currentBudget: 999999,
      manualAccrual: 999,
      commercialAdjustment: 999,
    }),
  ]);
  await ensureCvrPeriodAndInputsReady(DEV, 'P01');
}

describe('CVR historic snapshot reads (BL-031E.4)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    cvrAuthority.value = false;
    ledgerAuthority.value = false;
    mockOrders.length = 0;
    mockCertificates.clear();
    developments.items = [development];
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

  it('locked period uses snapshot rows and totals', async () => {
    await seedLockedSnapshot();
    const model = buildCvrModel(DEV, { periodKey: 'P01', pos: [] });
    expect(model.historic).toBe(true);
    expect(model.unavailable).toBe(false);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].costCodeKey).toBe('5231');
    expect(model.rows[0].committed).toBe(50250);
    expect(model.rows[0].certified).toBe(2150);
    expect(model.rows[0].manualAccrual).toBe(100);
    expect(model.rows[0].finalForecast).toBe(50750);
    expect(model.rows[0].expectedLiability).toBeNull();
    expect(model.summary.expectedLiability).toBeNull();
    expect(model.summary.committed).toBe(2364873);
    expect(model.summary.finalForecast).toBe(2365373);
    expect(model.summary.outstandingCertified).toBe(2150);
  });

  it('schema v3 historic rows retain frozen Expected and reconcile Final composition', async () => {
    await seedLockedSnapshot(
      frozenSnapshot({
        schemaVersion: 3,
        systemForecast: 2364873,
        expectedLiability: 20000,
        expectedLiabilityCaptured: true,
        commercialAdjustment: 500,
        finalForecast: 2385373,
        rows: [
          buildServerCvrSnapshotRowFixture({
            systemForecast: 50250,
            expectedLiability: 20000,
            expectedLiabilityCaptured: true,
            commercialAdjustment: 500,
            finalForecast: 70750,
            expectedLiabilityProvenance: [
              {
                ceId: 'ce-frozen',
                eventNumber: 'CE-0024',
                costCode: '5231',
                factualValue: 20000,
                statusAtLock: 'submitted',
                expectedTreatment: 'default',
                overrideAmount: null,
                effectiveExpectedAmount: 20000,
                reason: null,
              },
            ],
          }),
        ],
      })
    );
    const model = buildCvrModel(DEV, { periodKey: 'P01', pos: [] });
    const row = model.rows[0];
    expect(row.expectedLiability).toBe(20000);
    expect(row.expectedLiabilityProvenance[0].eventNumber).toBe('CE-0024');
    expect(row.systemForecast + row.expectedLiability + row.commercialAdjustment).toBe(
      row.finalForecast
    );
    expect(model.summary.expectedLiability).toBe(20000);
  });

  it('later PO, CE, certificate, ledger, and overlay edits do not move locked figures', async () => {
    await seedLockedSnapshot();
    mockOrders.push({
      orderKey: `${DEV}::wipe::5231`,
      developmentId: DEV,
      costCode: '5231',
      supplierLabel: 'Wipe',
      currentPackageValue: 999999,
      commercialEventsReady: true,
    });
    mockCertificates.set(`${DEV}::wipe::5231`, [
      { id: 'cert-new', status: 'locked', certificateNumber: 9, grossValue: 8000, netValue: 7000 },
    ]);
    appendTransactions(DEV, [
      createTransaction({
        developmentId: DEV,
        costCode: '5231',
        supplier: 'Later',
        transactionDate: '2026-08-01',
        invoiceNumber: 'LIVE-1',
        netAmount: 25000,
        vat: 0,
        grossAmount: 25000,
      }),
    ]);
    const cached = getCachedCvrPeriods(DEV)[0];
    if (cached?.costCentres?.[0]) {
      cached.costCentres[0].manualAccrual = 8800;
      cached.costCentres[0].commercialAdjustment = 8800;
    }

    const model = buildCvrModel(DEV, { periodKey: 'P01', pos: [{ id: 'po-live' }] });
    const row = model.rows[0];
    expect(row.committed).toBe(50250);
    expect(row.certified).toBe(2150);
    expect(row.actualCost).toBe(0);
    expect(row.manualAccrual).toBe(100);
    expect(row.finalForecast).toBe(50750);
    expect(model.summary.committed).toBe(2364873);
  });

  it('snapshot does not require live source readiness', async () => {
    cvrAuthority.value = true;
    ledgerAuthority.value = true;
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV,
        status: 'locked',
        snapshot: frozenSnapshot(),
        snapshotDeferred: false,
      })
    );
    setCvrInputListReject();
    await ensureCvrPeriodsReadyForDevelopment(DEV);
    const model = buildCvrModel(DEV, { periodKey: 'P01' });
    expect(model.historic).toBe(true);
    expect(model.unavailable).toBe(false);
    expect(model.rows[0].committed).toBe(50250);
    expect(model.ledgerReady).toBe(true);
  });

  it('legacy locked/no-snapshot is unavailable and does not fall back to live facts', async () => {
    cvrAuthority.value = true;
    seedMockCvrPeriod(
      DEV,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV,
        status: 'locked',
        snapshot: null,
        snapshotDeferred: true,
      })
    );
    seedMockCvrInputs(PERIOD_ID, [
      buildServerCvrInputFixture({ periodId: PERIOD_ID, currentBudget: 10000 }),
    ]);
    await ensureCvrPeriodAndInputsReady(DEV, 'P01');
    mockOrders.push({
      orderKey: `${DEV}::wipe::5231`,
      developmentId: DEV,
      costCode: '5231',
      currentPackageValue: 50250,
      commercialEventsReady: true,
    });

    const model = buildCvrModel(DEV, { periodKey: 'P01', pos: [] });
    expect(model.historicUnavailable).toBe(true);
    expect(model.unavailable).toBe(true);
    expect(model.rows).toEqual([]);
    expect(model.summary.committed).toBeNull();

    const register = buildCvrPeriodRegisterRow(DEV, getCachedCvrPeriods(DEV)[0], []);
    expect(register.statusLabel).toBe('Locked');
    expect(register.forecastLabel).toBe('—');
    expect(register.historicNote).toBe(CVR_HISTORIC_UNAVAILABLE_SHORT);
  });

  it('locked worksheet/summary/register/portfolio use snapshot figures', async () => {
    await seedLockedSnapshot();
    const period = getCachedCvrPeriods(DEV)[0];
    const workspace = buildCvrWorkspaceModel(development, {
      pos: [],
      periodKey: 'P01',
      period,
      readOnly: true,
    });
    expect(workspace.historic).toBe(true);
    expect(workspace.rows[0].committedLabel).toMatch(/50,250/);
    expect(workspace.totals.finalForecastLabel).toMatch(/2,365,373/);

    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01', period });
    expect(summary.historic).toBe(true);
    expect(summary.summary.currentBudget).toBe(0);
    expect(summary.summary.committed).toBe(2364873);
    expect(summary.summary.certified).toBe(2150);
    expect(summary.summary.actualCost).toBe(0);
    expect(summary.summary.manualAccrual).toBe(100);
    expect(summary.summary.currentCost).toBe(100);
    expect(summary.summary.systemForecast).toBe(2364873);
    expect(summary.summary.commercialAdjustment).toBe(500);
    expect(summary.summary.finalForecast).toBe(2365373);
    expect(summary.summary.costToComplete).toBe(2365273);
    expect(summary.summary.outstandingCertified).toBe(2150);
    expect(summary.summary.variance).toBe(-2365373);
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.value).toBe('—');
    expect(summary.kpis.find((item) => item.key === 'forecastProfit')?.value).toBe('—');
    expect(summary.kpis.find((item) => item.key === 'forecastMargin')?.value).toBe('—');
    expect(summary.kpis.find((item) => item.key === 'securedRevenue')?.value).toBe('—');
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.hint).toBe(
      CVR_HISTORIC_REVENUE_UNAVAILABLE
    );
    expect(summary.kpis.find((item) => item.key === 'forecastProfit')?.hint).toBe(
      CVR_HISTORIC_REVENUE_UNAVAILABLE
    );
    expect(summary.developmentSummary.plotsSoldLabel).toBe('—');
    expect(summary.developmentSummary.emptySalesHint).toBe(CVR_HISTORIC_REVENUE_UNAVAILABLE);
    const certifiedNotInLedger = summary.financialPosition.find(
      (item) => item.key === 'certifiedNotInLedger'
    );
    expect(certifiedNotInLedger.value).toBe(2150);
    const committedNotCertified = summary.financialPosition.find(
      (item) => item.key === 'committedNotCertified'
    );
    expect(committedNotCertified.value).toBe(2362723);

    const register = buildCvrPeriodRegisterRow(DEV, period, []);
    expect(register.forecastLabel).toMatch(/2,365,373/);
    expect(register.historicUnavailable).toBe(false);

    developments.items = [development];
    const portfolio = buildCvrPortfolioDevelopmentRow(development, []);
    expect(portfolio.forecastLabel).toMatch(/2,365,373/);
    expect(portfolio.historic).toBe(true);
  });

  it('portfolio uses a newer draft/submitted live period instead of rewriting locked P01', async () => {
    await seedLockedSnapshot();
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P02' });
    await createServerCvrPeriodInput(DEV, created.period.id, {
      costCodeKey: '5231',
      costCodeLabel: '5231 — Cleaning',
      currentBudget: 10000,
      manualAccrual: 0,
    });
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');
    developments.items = [development];
    const portfolio = buildCvrPortfolioDevelopmentRow(development, []);
    expect(portfolio.currentPeriodKey).toBe('P02');
    expect(portfolio.historic).toBe(false);
    const p01 = buildCvrModel(DEV, { periodKey: 'P01' });
    expect(p01.historic).toBe(true);
    expect(p01.summary.committed).toBe(2364873);
  });

  it('movement compares live P02 against frozen snapshot P01', async () => {
    await seedLockedSnapshot();
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P02' });
    await createServerCvrPeriodInput(DEV, created.period.id, {
      costCodeKey: '5231',
      costCodeLabel: '5231 — Cleaning',
      currentBudget: 10000,
      commercialAdjustment: 1500,
      adjustmentReason: 'P02 overlay',
      manualAccrual: 0,
    });
    await ensureCvrPeriodAndInputsReady(DEV, 'P02');
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P02' });
    expect(summary.previousLockedPeriodKey).toBe('P01');
    const forecastKpi = summary.kpis.find((item) => item.key === 'forecastCost');
    expect(forecastKpi.movement).toMatch(/vs previous period/);
  });

  it('movement compares snapshot P02 against snapshot P01 when both are locked', async () => {
    await seedLockedSnapshot();
    const p02Snapshot = buildServerCvrSnapshotFixture({
      id: 'snap-p02',
      developmentId: DEV,
      periodId: '22222222-3333-4444-8555-666666666666',
      periodKey: 'P02',
      finalForecast: 2370373,
      commercialAdjustment: 1000,
      rows: [
        buildServerCvrSnapshotRowFixture({
          snapshotId: 'snap-p02',
          finalForecast: 51250,
          commercialAdjustment: 1000,
        }),
      ],
    });
    const p02Period = buildServerCvrPeriodFixture({
        id: '22222222-3333-4444-8555-666666666666',
        developmentId: DEV,
        periodKey: 'P02',
        status: 'locked',
        snapshot: p02Snapshot,
        snapshotDeferred: false,
        approvedAt: '2026-05-01T12:00:00.000Z',
      });
    seedMockCvrPeriod(DEV, p02Period);
    upsertCachedCvrPeriod(DEV, p02Period);
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P02' });
    expect(summary.historic).toBe(true);
    expect(summary.previousLockedPeriodKey).toBe('P01');
    const forecastKpi = summary.kpis.find((item) => item.key === 'forecastCost');
    expect(forecastKpi.movement).toBe('+£5,000.00 vs previous period');
  });

  it('approve response retains snapshot in cache for immediate historic render', async () => {
    cvrAuthority.value = true;
    const created = await createServerCvrPeriod(DEV, { periodKey: 'P01' });
    await createServerCvrPeriodInput(DEV, created.period.id, {
      costCodeKey: '5231',
      costCodeLabel: '5231 — Cleaning',
      currentBudget: 0,
      commercialAdjustment: 500,
      adjustmentReason: 'QS',
      manualAccrual: 100,
    });
    await submitServerCvrPeriod(DEV, created.period.id);
    const approved = await approveServerCvrPeriod(DEV, created.period.id);
    expect(approved.ok).toBe(true);
    expect(approved.period.status).toBe('locked');
    expect(approved.snapshotDeferred).toBe(false);
    expect(approved.snapshot.rows[0].costCodeKey).toBe('5231');
    expect(approved.snapshot.schemaVersion).toBe(3);
    expect(approved.snapshot.totals.forecastRevenue).toBe(0);
    expect(getCachedCvrPeriods(DEV)[0].snapshot.totals).toBeTruthy();
    const model = buildCvrModel(DEV, { periodKey: 'P01' });
    expect(model.historic).toBe(true);
    expect(model.rows[0].manualAccrual).toBe(100);
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.value).toBe('£0.00');
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.value).not.toBe(
      '£999,999.00'
    );
  });

  it('schema v2 historic Summary uses frozen snapshot Revenue only', async () => {
    const snapshot = buildServerCvrRevenueSnapshotFixture({
      developmentId: DEV,
      periodId: PERIOD_ID,
      periodKey: 'P01',
      forecastRevenue: 10444608,
      securedRevenue: 0,
      remainingForecastRevenue: 10444608,
      plotsSold: 0,
      plotsRemaining: 31,
      grossProfit: 8079185,
      grossMarginPercent: 77.3512,
      finalForecast: 2365423,
      plots: [
        buildServerCvrSnapshotPlotFixture({
          plotId: 'plot-frozen',
          plotNumber: '31',
          houseType: 'Arundel',
          tenure: 'Open Market',
          revenueStatus: 'Available',
          forecastRevenue: 255100,
          securedRevenue: 0,
          remainingForecastRevenue: 255100,
          sellingPrice: 0,
        }),
      ],
    });
    await seedLockedSnapshot(snapshot);
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.value).toBe(
      '£10,444,608.00'
    );
    expect(summary.kpis.find((item) => item.key === 'forecastProfit')?.value).toBe(
      '£8,079,185.00'
    );
    expect(summary.kpis.find((item) => item.key === 'forecastMargin')?.value).toBe('77.4%');
    expect(summary.kpis.find((item) => item.key === 'securedRevenue')?.value).toBe('£0.00');
    expect(summary.kpis.find((item) => item.key === 'remainingForecast')?.value).toBe(
      '£10,444,608.00'
    );
    expect(summary.developmentSummary.plotsSoldLabel).toBe('0');
    expect(summary.historicRevenuePlots.available).toBe(true);
    expect(summary.historicRevenuePlots.rows).toHaveLength(1);
    expect(summary.historicRevenuePlots.rows[0].plotNumber).toBe('31');
    expect(summary.historicRevenuePlots.rows[0].forecastRevenueLabel).toBe('£255,100.00');
    expect(summary.historicRevenuePlots.rows[0].plotId).toBe('plot-frozen');
  });

  it('v1 previous to v2 current withholds Revenue movement', async () => {
    await seedLockedSnapshot();
    const p02 = buildServerCvrPeriodFixture({
      id: '22222222-3333-4444-8555-666666666666',
      developmentId: DEV,
      periodKey: 'P02',
      status: 'locked',
      snapshot: buildServerCvrRevenueSnapshotFixture({
        id: 'snap-p02',
        developmentId: DEV,
        periodId: '22222222-3333-4444-8555-666666666666',
        periodKey: 'P02',
        forecastRevenue: 10444608,
        grossProfit: 8079185,
        grossMarginPercent: 77.3512,
        finalForecast: 2365423,
      }),
      snapshotDeferred: false,
      approvedAt: '2026-05-01T12:00:00.000Z',
    });
    seedMockCvrPeriod(DEV, p02);
    upsertCachedCvrPeriod(DEV, p02);
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P02' });
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.value).toBe(
      '£10,444,608.00'
    );
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.movement).toBeNull();
    expect(summary.kpis.find((item) => item.key === 'forecastProfit')?.movement).toBeNull();
    expect(summary.kpis.find((item) => item.key === 'forecastMargin')?.movement).toBeNull();
  });

  it('later v2 previous supports Revenue movement against a v2 current', async () => {
    await seedLockedSnapshot(
      buildServerCvrRevenueSnapshotFixture({
        developmentId: DEV,
        periodId: PERIOD_ID,
        periodKey: 'P01',
        forecastRevenue: 10000000,
        remainingForecastRevenue: 10000000,
        grossProfit: 7634577,
        grossMarginPercent: 76.3458,
        finalForecast: 2365423,
      })
    );
    const p02 = buildServerCvrPeriodFixture({
      id: '22222222-3333-4444-8555-666666666666',
      developmentId: DEV,
      periodKey: 'P02',
      status: 'locked',
      snapshot: buildServerCvrRevenueSnapshotFixture({
        id: 'snap-p02',
        developmentId: DEV,
        periodId: '22222222-3333-4444-8555-666666666666',
        periodKey: 'P02',
        forecastRevenue: 10444608,
        remainingForecastRevenue: 10444608,
        remainingForecast: 10444608,
        grossProfit: 8079185,
        grossMarginPercent: 77.3512,
        finalForecast: 2365423,
      }),
      snapshotDeferred: false,
      approvedAt: '2026-05-01T12:00:00.000Z',
    });
    seedMockCvrPeriod(DEV, p02);
    upsertCachedCvrPeriod(DEV, p02);
    const summary = buildCvrSummaryModel(development, { pos: [], periodKey: 'P02' });
    expect(summary.kpis.find((item) => item.key === 'forecastRevenue')?.movement).toBe(
      '+£444,608.00 vs previous period'
    );
  });

  it('authority-off draft/submitted still uses the live localStorage model', () => {
    createOrOpenDraftPeriod(DEV);
    addCostCentre(
      DEV,
      {
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        currentBudget: 10000,
        manualAccrual: 100,
      },
      'P01'
    );
    const draft = buildCvrModel(DEV, { periodKey: 'P01' });
    expect(draft.historic).toBe(false);
    expect(draft.rows[0].manualAccrual).toBe(100);
    expect(submitCvrPeriod(DEV, 'P01').ok).toBe(true);
    const submitted = buildCvrModel(DEV, { periodKey: 'P01' });
    expect(submitted.historic).toBe(false);
    expect(submitted.unavailable).toBe(false);
  });
});
