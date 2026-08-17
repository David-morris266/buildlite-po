import { beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());
const mockOrders = vi.hoisted(() => []);

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../payments/paymentCertificateStore.js', () => ({
  listCertificates: () => [],
  isApprovedCommercialCertificate: () => false,
  getCertificateCount: () => 0,
  resolveCertificatesForPackage: () => ({
    ready: true,
    certificates: [],
    loadState: 'local',
    error: null,
  }),
}));

vi.mock('../payments/subcontractOrders.js', () => ({
  buildSubcontractOrdersFromPos: () => mockOrders,
  getPoOrderScopeId: (po) => po.developmentId,
}));

import { addCostCentre, updateCostCentre } from './costCentreStore';
import {
  approveCvrPeriod,
  createOrOpenDraftPeriod,
  createNextCvrPeriod,
  submitCvrPeriod,
} from './cvrPeriodStore';
import {
  buildCommercialCostSummary,
  buildCommercialExceptions,
  buildCvrSummaryModel,
  buildTopCostVariances,
  calculateCertifiedNotInLedger,
  calculateCommittedNotCertified,
  formatPeriodMovement,
  formatProportionOfForecast,
  normaliseCommercialFamily,
  normaliseCommercialHead,
} from './cvrSummaryHelpers';
import { isCvrPeriodEditable } from './cvrPeriodStatus';
import { updateCvrPeriodCommentary } from './costCentreStore';

const DEV_ID = 'dev-summary-test';

const development = {
  id: DEV_ID,
  developmentName: 'Riverside Quarter',
  jobNumber: 'RQ-01',
  plotMaster: {
    plots: [
      { id: 'p1', plotNumber: '1', houseType: 'A', configuration: 'Detached', status: 'Active' },
      { id: 'p2', plotNumber: '2', houseType: 'B', configuration: 'Semi Detached', status: 'Active' },
    ],
  },
};

function seedBudgetRows() {
  createOrOpenDraftPeriod(DEV_ID);
  addCostCentre(
    DEV_ID,
    {
      costCodeKey: 'brickwork',
      costCodeLabel: 'BRK — Brickwork',
      description: 'Brickwork package',
      commercialFamily: 'Subcontract',
      currentBudget: 100000,
      originalBudget: 100000,
    },
    'P01'
  );
  addCostCentre(
    DEV_ID,
    {
      costCodeKey: 'land',
      costCodeLabel: 'LAND — Land Costs',
      description: 'Land acquisition',
      commercialFamily: 'Land',
      currentBudget: 500000,
      originalBudget: 500000,
    },
    'P01'
  );
}

describe('cvrSummaryHelpers calculations', () => {
  it('calculates committed not certified and certified not in ledger', () => {
    expect(calculateCommittedNotCertified(240000, 180000)).toBe(60000);
    expect(calculateCertifiedNotInLedger(180000, 150000)).toBe(30000);
    expect(calculateCommittedNotCertified(100000, 120000)).toBe(0);
    expect(calculateCertifiedNotInLedger(100000, 120000)).toBe(0);
  });

  it('formats proportion only when forecast is positive', () => {
    expect(formatProportionOfForecast(50000, 200000)).toBe('25%');
    expect(formatProportionOfForecast(50000, 0)).toBeNull();
    expect(formatProportionOfForecast(null, 200000)).toBeNull();
  });

  it('formats movement against previous period', () => {
    expect(formatPeriodMovement(300000, 250000)).toBe('+£50,000.00 vs previous period');
    expect(formatPeriodMovement(200000, 250000)).toBe('−£50,000.00 vs previous period');
    expect(formatPeriodMovement(200000, null)).toBeNull();
  });
});

describe('buildTopCostVariances', () => {
  it('ranks adverse variances before favourable variances', () => {
    const rows = [
      {
        id: '1',
        costCodeLabel: 'A',
        description: 'A',
        currentBudget: 100000,
        currentBudgetLabel: '£100,000.00',
        finalForecast: 90000,
        finalForecastLabel: '£90,000.00',
        variance: 10000,
        varianceLabel: '£10,000.00',
        varianceState: 'saving',
      },
      {
        id: '2',
        costCodeLabel: 'B',
        description: 'B',
        currentBudget: 100000,
        currentBudgetLabel: '£100,000.00',
        finalForecast: 130000,
        finalForecastLabel: '£130,000.00',
        variance: -30000,
        varianceLabel: '−£30,000.00',
        varianceState: 'overspend',
      },
      {
        id: '3',
        costCodeLabel: 'C',
        description: 'C',
        currentBudget: 100000,
        currentBudgetLabel: '£100,000.00',
        finalForecast: 120000,
        finalForecastLabel: '£120,000.00',
        variance: -20000,
        varianceLabel: '−£20,000.00',
        varianceState: 'overspend',
      },
    ];

    const ranked = buildTopCostVariances(rows, 5);
    expect(ranked[0].costCodeLabel).toBe('B');
    expect(ranked[1].costCodeLabel).toBe('C');
    expect(ranked[2].costCodeLabel).toBe('A');
  });
});

describe('buildCommercialExceptions', () => {
  it('detects negative CTC, missing budget and commercial adjustments', () => {
    const rows = [
      {
        id: '1',
        costCodeKey: 'a',
        costCodeLabel: 'A',
        costToComplete: -15000,
        variance: 0,
        commercialAdjustment: 0,
        currentBudget: 50000,
        committed: 0,
        actualCost: 65000,
        outstandingCertified: 0,
      },
      {
        id: '2',
        costCodeKey: 'b',
        costCodeLabel: 'B',
        costToComplete: 10000,
        variance: -25000,
        commercialAdjustment: 18000,
        currentBudget: 100000,
        committed: 0,
        actualCost: 0,
        outstandingCertified: 0,
      },
      {
        id: '3',
        costCodeKey: 'c',
        costCodeLabel: 'C',
        costToComplete: 5000,
        variance: 0,
        commercialAdjustment: 0,
        currentBudget: null,
        committed: 40000,
        actualCost: 0,
        outstandingCertified: 0,
      },
    ];

    const exceptions = buildCommercialExceptions(rows, {
      certified: 100000,
      actualCost: 80000,
    });

    expect(exceptions.find((item) => item.key === 'negativeCtc')?.count).toBe(1);
    expect(exceptions.find((item) => item.key === 'overBudget')?.count).toBe(1);
    expect(exceptions.find((item) => item.key === 'adjustments')?.count).toBe(1);
    expect(exceptions.find((item) => item.key === 'missingBudget')?.count).toBe(1);
    expect(exceptions.find((item) => item.key === 'journals')?.valueLabel).toBe(
      'Not yet available'
    );
  });
});

describe('normaliseCommercialFamily', () => {
  it('maps legacy family labels to Doc 46 commercial families', () => {
    expect(normaliseCommercialFamily('Acquisition')).toBe('Acquisition');
    expect(normaliseCommercialFamily('Subcontract', 'House Build')).toBe('General');
    expect(normaliseCommercialFamily('Planning', 'Professional Fees')).toBe('Planning');
    expect(normaliseCommercialFamily('')).toBe('General');
    expect(normaliseCommercialFamily('Unknown Category', 'Other')).toBe('General');
  });
});

describe('normaliseCommercialHead', () => {
  it('maps legacy labels to commercial heads', () => {
    expect(normaliseCommercialHead('Land')).toBe('Land');
    expect(normaliseCommercialHead('Subcontract')).toBe('House Build');
    expect(normaliseCommercialHead('Professional Fees')).toBe('Professional Fees');
    expect(normaliseCommercialHead('Direct Cost')).toBe('House Build');
    expect(normaliseCommercialHead('')).toBe('Other');
  });
});

describe('buildCommercialCostSummary', () => {
  it('aggregates rows by commercial head and reconciles with CVR totals', () => {
    seedBudgetRows();
    const model = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });
    const period = model.period;
    const summary = buildCommercialCostSummary(model.rows, period.costCentres, model.summary);

    expect(summary.available).toBe(true);
    expect(summary.items.some((item) => item.head === 'Land')).toBe(true);
    expect(summary.items.some((item) => item.head === 'House Build')).toBe(true);
    expect(summary.totals.reconciles).toBe(true);
    expect(summary.totals.budgetLabel).toBe('£600,000.00');
    expect(summary.totals.finalForecastLabel).toBe('£600,000.00');
  });
});

describe('buildCvrSummaryModel', () => {
  beforeEach(() => {
    storage.clear();
    mockOrders.length = 0;
  });

  it('builds KPI totals from existing CVR engine without invented revenue', () => {
    seedBudgetRows();
    const model = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });

    expect(model.kpis.find((item) => item.key === 'forecastCost')?.emphasis).toBe('hero');
    expect(model.kpis.find((item) => item.key === 'costToComplete')?.emphasis).toBe('hero');
    expect(model.kpis.find((item) => item.key === 'forecastRevenue')?.value).toBe('—');
    expect(model.kpis.find((item) => item.key === 'forecastProfit')?.value).toBe('—');
    expect(model.kpis.find((item) => item.key === 'costToComplete')?.value).toBe('£600,000.00');
  });

  it('builds commercial cost summary from existing CVR totals', () => {
    seedBudgetRows();
    const model = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });

    expect(model.commercialCostSummary.available).toBe(true);
    expect(model.commercialCostSummary.items.some((item) => item.head === 'Land')).toBe(true);
    expect(model.commercialCostSummary.items.some((item) => item.head === 'House Build')).toBe(
      true
    );
    expect(model.commercialCostSummary.totals.reconciles).toBe(true);
  });

  it('exposes hero KPI emphasis for executive metrics', () => {
    seedBudgetRows();
    const model = buildCvrSummaryModel(development, { pos: [], periodKey: 'P01' });
    const varianceKpi = model.kpis.find((item) => item.key === 'forecastVariance');
    expect(varianceKpi?.emphasis).toBe('hero');
  });

  it('shows movement when locked period totals differ', () => {
    seedBudgetRows();
    submitCvrPeriod(DEV_ID, 'P01');
    approveCvrPeriod(DEV_ID, 'P01');
    createNextCvrPeriod(DEV_ID);

    const landCentre = addCostCentre(DEV_ID, {
      costCodeKey: 'steel',
      costCodeLabel: 'STL — Steel',
      commercialFamily: 'Materials',
      currentBudget: 50000,
    }, 'P02').costCentre;

    updateCostCentre(DEV_ID, landCentre.id, { currentBudget: 50000 }, 'P02');

    const model = buildCvrSummaryModel(development, { pos: [], periodKey: 'P02' });
    const forecastKpi = model.kpis.find((item) => item.key === 'forecastCost');
    expect(forecastKpi?.movement).toBe('+£50,000.00 vs previous period');
  });

  it('marks locked summary page as read-only', () => {
    seedBudgetRows();
    const { periodKey } = createOrOpenDraftPeriod(DEV_ID);
    submitCvrPeriod(DEV_ID, periodKey);
    approveCvrPeriod(DEV_ID, periodKey);

    const model = buildCvrSummaryModel(development, { pos: [], periodKey });
    expect(model.readOnly).toBe(true);
    expect(isCvrPeriodEditable(model.period)).toBe(false);
  });
});

describe('commentary draft-only editing', () => {
  beforeEach(() => storage.clear());

  it('allows commentary updates only on draft periods', () => {
    createOrOpenDraftPeriod(DEV_ID);
    const draftResult = updateCvrPeriodCommentary(DEV_ID, {
      keyCommercialIssues: 'Brickwork risk',
    }, 'P01');
    expect(draftResult.ok).toBe(true);

    submitCvrPeriod(DEV_ID, 'P01');
    const lockedAttempt = updateCvrPeriodCommentary(DEV_ID, {
      keyCommercialIssues: 'Should fail',
    }, 'P01');
    expect(lockedAttempt.ok).toBe(false);
  });
});

describe('buildCommercialCostSummary empty state', () => {
  it('returns empty state when no cost code data exists', () => {
    const summary = buildCommercialCostSummary([], [], {
      currentBudget: null,
      finalForecast: null,
      variance: null,
    });
    expect(summary.available).toBe(false);
    expect(summary.emptyMessage).toBeTruthy();
  });
});
