import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());
const mockOrders = vi.hoisted(() => []);
const ceAuthority = vi.hoisted(() => ({ value: false }));
const ceReady = vi.hoisted(() => ({ value: true }));

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

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
  listCertificates: () => [],
  resolveCertificatesForPackage: () => ({
    ready: true,
    certificates: [],
    loadState: 'local',
    error: null,
  }),
  getCertificateCount: () => 0,
}));

vi.mock('../commercialEvents/commercialEventAuthority', () => ({
  isCommercialEventServerAuthorityEnabled: () => ceAuthority.value,
}));

vi.mock('../commercialEvents/commercialEventServerCache', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCommercialEventFinancialReadiness: () =>
      ceReady.value
        ? { ready: true, loadState: 'loaded', error: null }
        : { ready: false, loadState: 'loading', error: null, reason: 'loading' },
    listCachedCommercialEventsByPackage: () => [],
  };
});

import { saveCompanySettings } from '../admin/companyStore';
import {
  approveCommercialEvent,
  clearCommercialEventsStore,
  createCommercialEvent,
  submitCommercialEvent,
} from '../commercialEvents/commercialEventStore';
import { COMMERCIAL_EVENT_FINANCIAL_TREATMENTS } from '../commercialEvents/commercialEventFinancialTreatment';
import { COMMERCIAL_EVENT_RELATIONSHIP_TYPES, COMMERCIAL_EVENT_TYPES } from '../commercialEvents/commercialEventTypes';
import { addCostCentre, listCostCentres } from './costCentreStore';
import { calculateIncurredCost } from './cvrCalculations';
import { getApprovedCertificateValue } from './cvrCertifiedValue';
import { buildCvrModel, buildCvrRows, buildCommitmentsByCostCode } from './cvrEngine';
import { enrichCvrForecastRow } from './cvrForecastEngine';
import { createOrOpenDraftPeriod } from './cvrPeriodStore';
import {
  appendTransactions,
  createTransaction,
  listTransactions,
} from '../ledger/ledgerTransactionStore';

const DEV = 'dev-wipe-cvr';
const ORDER_KEY = `${DEV}::wipe::5231`;

function seedApprovedEvent(overrides = {}) {
  const created = createCommercialEvent(DEV, {
    packageId: ORDER_KEY,
    poNumber: 'S0012',
    supplierId: 'wipe',
    costCode: '5231',
    eventType: COMMERCIAL_EVENT_TYPES.variation.key,
    category: 'commercial',
    subcategory: 'scopeChange',
    responsibility: 'commercial',
    description: 'Wipe commercial event',
    value: 250,
    ...overrides,
  });
  submitCommercialEvent(DEV, created.event.id);
  return approveCommercialEvent(DEV, created.event.id).event;
}

describe('BL-031D live commercial formulas', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    storage.clear();
    mockOrders.length = 0;
    ceAuthority.value = false;
    ceReady.value = true;
    clearCommercialEventsStore();
    saveCompanySettings({ numberingPrefixes: { commercialEvent: 'CE-' } });
    localStorage.setItem('userName', 'Test QS');
    mockOrders.push({
      orderKey: ORDER_KEY,
      developmentId: DEV,
      supplierId: 'wipe',
      costCode: '5231',
      committedValue: 50000,
      supplierLabel: 'Wipe It Cleaners',
    });
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('PO £50,000 + approved variation £250 = committed £50,250', () => {
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      value: 250,
    });
    const commitments = buildCommitmentsByCostCode(DEV, []);
    expect(commitments.totals.get('5231')).toBe(50250);
  });

  it('approved direct recovery −£100 does not reduce commitment', () => {
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      value: 250,
    });
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.contraCharge.key,
      value: -100,
      financialTreatment: COMMERCIAL_EVENT_FINANCIAL_TREATMENTS.recoverableDeduction.key,
      relationshipType: COMMERCIAL_EVENT_RELATIONSHIP_TYPES.recovery.key,
      description: 'Direct recovery',
    });
    const commitments = buildCommitmentsByCostCode(DEV, []);
    expect(commitments.totals.get('5231')).toBe(50250);
  });

  it('gross certified £2,250 + recovery −£100 = certified £2,150', () => {
    expect(
      getApprovedCertificateValue({
        status: 'locked',
        grossValue: 2250,
        netValue: 2150,
        recoverySigned: -100,
        vat: 0,
        retention: 0,
      })
    ).toBe(2150);
  });

  it('ledger actual uses net, not VAT or gross', () => {
    createOrOpenDraftPeriod(DEV);
    addCostCentre(DEV, { costCodeLabel: '5231 — Cleaning', costCodeKey: '5231' }, 'P01');
    appendTransactions(DEV, [
      createTransaction({
        developmentId: DEV,
        supplier: 'Wipe',
        costCode: '5231',
        transactionDate: '2026-01-15',
        invoiceNumber: 'INV-1',
        netAmount: 1000,
        vat: 200,
        grossAmount: 1200,
      }),
    ]);
    const model = buildCvrModel(DEV, { periodKey: 'P01' });
    const row = model.rows.find((item) => item.costCodeKey === '5231');
    expect(row.actualCost).toBe(1000);
    expect(listTransactions(DEV)[0].vat).toBe(200);
  });

  it('manual accrual affects current cost and CTC only', () => {
    createOrOpenDraftPeriod(DEV);
    addCostCentre(
      DEV,
      {
        costCodeLabel: '5231 — Cleaning',
        costCodeKey: '5231',
        currentBudget: 10000,
        manualAccrual: 400,
      },
      'P01'
    );
    expect(listCostCentres(DEV, 'P01')[0].manualAccrual).toBe(400);

    const row = enrichCvrForecastRow({
      committed: 50250,
      currentBudget: 10000,
      actualCost: 0,
      certified: 2150,
      commercialAdjustment: 0,
      manualAccrual: 400,
    });
    expect(row.committed).toBe(50250);
    expect(row.certified).toBe(2150);
    expect(row.actualCost).toBe(0);
    expect(row.manualAccrual).toBe(400);
    expect(row.currentCost).toBe(400);
    expect(row.systemForecast).toBe(50250);
    expect(row.costToComplete).toBe(49850);
    expect(calculateIncurredCost(0, 400)).toBe(400);
  });

  it('zero CVR budget + package commitment £50,250 still drives forecast', () => {
    seedApprovedEvent({
      eventType: COMMERCIAL_EVENT_TYPES.variation.key,
      value: 250,
    });
    createOrOpenDraftPeriod(DEV);
    addCostCentre(
      DEV,
      {
        costCodeLabel: '5231 — Cleaning',
        costCodeKey: '5231',
        originalBudget: 0,
        currentBudget: 0,
        manualAccrual: 100,
      },
      'P01'
    );
    const model = buildCvrModel(DEV, { periodKey: 'P01' });
    const row = model.rows.find((item) => item.costCodeKey === '5231');
    expect(row.committed).toBe(50250);
    expect(row.actualCost).toBe(0);
    expect(row.manualAccrual).toBe(100);
    expect(row.currentCost).toBe(100);
    expect(row.systemForecast).toBe(50250);
    expect(row.finalForecast).toBe(50250);
    expect(row.costToComplete).toBe(50150);
  });

  it('unresolved commercial events do not become false £0 commitment', () => {
    ceAuthority.value = true;
    ceReady.value = false;
    const commitments = buildCommitmentsByCostCode(DEV, []);
    expect(commitments.unavailable.has('5231')).toBe(true);
    expect(commitments.totals.has('5231')).toBe(false);
    const rows = buildCvrRows(DEV, { periodKey: 'P01' });
    const row = rows.find((item) => item.costCodeKey === '5231');
    expect(row.committed).toBeNull();
  });
});
