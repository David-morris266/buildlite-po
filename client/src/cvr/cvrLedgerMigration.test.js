import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installNetworkGuard } from '../test/networkGuard';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

vi.mock('../api/cvrPeriods', () => import('../test/mockCvrPeriodApi'));
vi.mock('../api/purchaseLedger', () => import('../test/mockPurchaseLedgerApi'));

import {
  buildServerCvrInputFixture,
  buildServerCvrPeriodFixture,
  getCvrMutationCallCounts,
  resetCvrPeriodApiStore,
  seedMockCvrInputs,
  seedMockCvrPeriod,
} from '../test/mockCvrPeriodApi';
import {
  buildServerLedgerTransactionFixture,
  getLedgerMutationCallCounts,
  resetLedgerApiStore,
  seedMockLedgerTransactions,
} from '../test/mockPurchaseLedgerApi';
import { __resetCvrPeriodServerCacheForTests } from './cvrPeriodServerCache';
import { __resetLedgerServerCacheForTests } from '../ledger/ledgerServerCache';
import { buildLedgerFingerprint } from '../ledger/ledgerFingerprint';
import {
  AUTO_MIGRATE_ON_STARTUP,
  MIGRATION_INVOCATION,
  executeCvrLedgerMigration,
  formatMigrationReport,
  preflightCvrLedgerMigration,
} from './cvrLedgerMigration';

const DEV_A = 'dev-mig-a';
const DEV_B = 'dev-mig-b';
const PERIOD_ID = '11111111-2222-4333-8444-555555555555';

function seedLocalCvr(developmentId, periods, extra = {}) {
  const current = storage.get('buildlite_cvr_v1');
  const parsed = current ? JSON.parse(current) : {};
  parsed[developmentId] = {
    activePeriodKey: Object.keys(periods)[0] || 'P01',
    periods,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
  storage.set('buildlite_cvr_v1', JSON.stringify(parsed));
}

function seedLocalLedger(developmentId, { transactions = [], importHistory = [] } = {}) {
  const current = storage.get('buildlite_purchase_ledgers_v1');
  const parsed = current ? JSON.parse(current) : {};
  parsed[developmentId] = { transactions, importHistory, importProfiles: [], actualCostsByCostCode: {} };
  storage.set('buildlite_purchase_ledgers_v1', JSON.stringify(parsed));
}

function localPeriod(overrides = {}) {
  return {
    periodKey: 'P01',
    status: 'draft',
    commercialCommentary: {
      keyCommercialIssues: 'Delay',
      commercialOpportunities: '',
      financialRisks: '',
      actionsBeforeNextCvr: '',
    },
    developmentNotes: 'QS site note — not migrated',
    createdAt: '2020-01-01T00:00:00.000Z',
    createdBy: 'Historic QS',
    costCentres: [
      {
        id: 'cc-local-1',
        costCodeKey: '5231',
        costCodeLabel: '5231 — Cleaning',
        description: 'Cleaning',
        commercialHead: 'House Build',
        commercialFamily: 'Internal Finishes',
        trade: 'Cleaning',
        originalBudget: 10000,
        currentBudget: 11000,
        commercialAdjustment: 250,
        commercialReason: 'Inflation',
        adjustmentHistory: [{ amount: 250, reason: 'Inflation' }],
        commercialNotes: 'QS overlay',
        active: true,
      },
    ],
    ...overrides,
  };
}

function localTxn(overrides = {}) {
  return {
    id: 'txn-local-1',
    developmentId: DEV_A,
    supplier: 'Wipe It Cleaners',
    supplierCode: 'WIC',
    costCode: '5231',
    description: 'January invoice',
    transactionDate: '2026-01-15',
    invoiceNumber: 'INV-1',
    netAmount: 1000,
    vat: 200,
    grossAmount: 1200,
    source: 'Sage Purchase Ledger',
    documentType: 'Invoice',
    reference: 'REF-1',
    importBatch: 'batch-1',
    createdAt: '2020-01-01T00:00:00.000Z',
    importedBy: 'Historic QS',
    ...overrides,
  };
}

function planSnapshot(plan) {
  return {
    safeToExecute: plan.safeToExecute,
    alreadyMigrated: plan.alreadyMigrated,
    cvr: {
      localPeriodCount: plan.cvr.localPeriodCount,
      serverPeriodCount: plan.cvr.serverPeriodCount,
      periodsToCreate: plan.cvr.periodsToCreate,
      inputsToCreate: plan.cvr.inputsToCreate,
      matches: plan.cvr.matches,
      conflicts: plan.cvr.conflicts,
      invalid: plan.cvr.invalid,
    },
    ledger: {
      localTransactionCount: plan.ledger.localTransactionCount,
      localNetTotal: plan.ledger.localNetTotal,
      serverTransactionCount: plan.ledger.serverTransactionCount,
      rowsToImport: plan.ledger.rowsToImport,
      alreadyMatched: plan.ledger.alreadyMatched,
      conflicts: plan.ledger.conflicts,
      invalid: plan.ledger.invalid,
      batchesToCreate: plan.ledger.batchesToCreate,
    },
  };
}

describe('CVR/ledger localStorage migration (BL-031C)', () => {
  let networkGuard;

  beforeEach(() => {
    networkGuard = installNetworkGuard();
    storage.clear();
    __resetCvrPeriodServerCacheForTests();
    __resetLedgerServerCacheForTests();
    resetCvrPeriodApiStore();
    resetLedgerApiStore();
    localStorage.setItem('userName', 'Migration QS');
  });

  afterEach(() => {
    networkGuard?.assertNoLiveApiCalls();
    networkGuard?.restore();
  });

  it('is manual-only and does not auto-run', () => {
    expect(AUTO_MIGRATE_ON_STARTUP).toBe(false);
    expect(MIGRATION_INVOCATION).toBe('manual-only');
  });

  it('maps empty local and empty server as no work', async () => {
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(true);
    expect(plan.alreadyMigrated).toBe(true);
    expect(plan.cvr.localPeriodCount).toBe(0);
    expect(plan.ledger.localTransactionCount).toBe(0);
    expect(plan.ledger.rowsToImport).toBe(0);
  });

  it('preflight is deterministic when run twice', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod() });
    seedLocalLedger(DEV_A, {
      transactions: [localTxn()],
      importHistory: [{ id: 'import-1', importBatch: 'batch-1', fileName: 'sage.csv' }],
    });
    const first = planSnapshot(await preflightCvrLedgerMigration(DEV_A, { developmentName: 'Test Site 1' }));
    const second = planSnapshot(await preflightCvrLedgerMigration(DEV_A, { developmentName: 'Test Site 1' }));
    expect(second).toEqual(first);
  });

  it('creates missing CVR periods/inputs and ledger rows, then reruns as already migrated', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod({ status: 'locked' }) });
    seedLocalLedger(DEV_A, {
      transactions: [localTxn()],
      importHistory: [
        {
          id: 'import-1',
          importBatch: 'batch-1',
          fileName: 'sage.csv',
          importProfile: 'Sage Purchase Ledger',
        },
      ],
    });

    const plan = await preflightCvrLedgerMigration(DEV_A, { developmentName: 'Test Site 1' });
    expect(plan.safeToExecute).toBe(true);
    expect(plan.cvr.periodsToCreate.map((item) => item.periodKey)).toEqual(['P01']);
    expect(plan.cvr.inputsToCreate).toHaveLength(1);
    expect(plan.cvr.periodRows[0].inputsToCreate[0].manualAccrual).toBe(0);
    expect(plan.cvr.periodRows[0].inputsToCreate[0].adjustmentHistory).toEqual([
      { amount: 250, reason: 'Inflation' },
    ]);
    expect(plan.ledger.rowsToImport).toBe(1);
    expect(plan.ledger.batchesToCreate[0].originalFileName).toBe('sage.csv');
    expect(formatMigrationReport(plan)).toMatch(/Safe to execute: yes/);

    const executed = await executeCvrLedgerMigration(DEV_A, {
      confirm: true,
      developmentName: 'Test Site 1',
    });
    expect(executed.ok).toBe(true);
    expect(executed.complete).toBe(true);

    const again = await preflightCvrLedgerMigration(DEV_A, { developmentName: 'Test Site 1' });
    expect(again.alreadyMigrated).toBe(true);
    expect(again.cvr.periodsToCreate).toEqual([]);
    expect(again.ledger.rowsToImport).toBe(0);
    expect(again.ledger.alreadyMatched).toBe(1);

    const noop = await executeCvrLedgerMigration(DEV_A, { confirm: true });
    expect(noop.alreadyMigrated).toBe(true);
    expect(noop.executed).toBe(false);
    expect(getCvrMutationCallCounts().create).toBe(1);
    expect(getLedgerMutationCallCounts().import).toBe(1);
  });

  it('does not fabricate historic actors onto the create payload', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod({ status: 'draft' }) });
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.limitations.some((item) => /historic createdAt/i.test(item))).toBe(true);
    expect(JSON.stringify(plan.cvr.periodRows[0])).not.toMatch(/Historic QS/);
  });

  it('detects a period identity conflict rather than overwriting', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod({ status: 'draft' }) });
    seedMockCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({
        developmentId: DEV_A,
        periodKey: 'P01',
        commentary: { keyCommercialIssues: 'Different' },
      })
    );
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.cvr.conflicts[0].classification).toBe('CONFLICT');
    const executed = await executeCvrLedgerMigration(DEV_A, { confirm: true });
    expect(executed.ok).toBe(false);
    expect(executed.executed).toBe(false);
  });

  it('fails preflight for invalid local periods', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod({ status: 'reopened' }) });
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.cvr.invalid.length).toBeGreaterThan(0);
  });

  it('fails preflight for duplicate local cost-code keys', async () => {
    seedLocalCvr(DEV_A, {
      P01: localPeriod({
        costCentres: [
          { costCodeKey: '5231', costCodeLabel: '5231' },
          { costCodeKey: '5231 — Cleaning', costCodeLabel: 'Cleaning' },
        ],
      }),
    });
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(false);
    expect(JSON.stringify(plan.cvr.invalid)).toMatch(/Duplicate normalised cost-code keys/);
  });

  it('fails preflight when local data has more than one open period', async () => {
    seedLocalCvr(DEV_A, {
      P01: localPeriod({ status: 'draft', costCentres: [] }),
      P02: localPeriod({ periodKey: 'P02', status: 'submitted', costCentres: [] }),
    });
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.cvr.conflicts.some((item) => /one open/i.test(item.reason))).toBe(true);
  });

  it('recovers a partial prior CVR period without duplicating it', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod({ status: 'locked' }) });
    seedMockCvrPeriod(
      DEV_A,
      buildServerCvrPeriodFixture({
        id: PERIOD_ID,
        developmentId: DEV_A,
        periodKey: 'P01',
        periodLabel: 'P01',
        status: 'draft',
        commentary: localPeriod().commercialCommentary,
      })
    );
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(true);
    expect(plan.cvr.periodRows[0].reason).toBe('partial-recovery');
    expect(plan.cvr.periodRows[0].actions).toEqual(['upsertInputs', 'submit', 'approve']);

    const executed = await executeCvrLedgerMigration(DEV_A, { confirm: true });
    expect(executed.ok).toBe(true);
    expect(getCvrMutationCallCounts().create).toBe(0);
    expect(getCvrMutationCallCounts().upsertInputs).toBe(1);
    expect(getCvrMutationCallCounts().approve).toBe(1);
  });

  it('treats matching server fingerprints as already migrated rather than re-importing', async () => {
    const txn = localTxn();
    seedLocalLedger(DEV_A, { transactions: [txn] });
    const fingerprint = await buildLedgerFingerprint({
      supplier: txn.supplier,
      invoiceNumber: txn.invoiceNumber,
      transactionDate: txn.transactionDate,
      netAmount: txn.netAmount,
      costCodeKey: txn.costCode,
      description: txn.description,
    });
    seedMockLedgerTransactions(DEV_A, [
      buildServerLedgerTransactionFixture({
        developmentId: DEV_A,
        fingerprint,
        supplier: txn.supplier,
        supplierCode: txn.supplierCode,
        costCodeKey: txn.costCode,
        transactionDate: txn.transactionDate,
        invoiceNumber: txn.invoiceNumber,
        description: txn.description,
        netAmount: txn.netAmount,
        vatAmount: txn.vat,
        grossAmount: txn.grossAmount,
        source: txn.source,
        documentType: txn.documentType,
        reference: txn.reference,
      }),
    ]);
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.ledger.alreadyMatched).toBe(1);
    expect(plan.ledger.rowsToImport).toBe(0);
    const executed = await executeCvrLedgerMigration(DEV_A, { confirm: true });
    expect(executed.alreadyMigrated).toBe(true);
    expect(getLedgerMutationCallCounts().import).toBe(0);
  });

  it('detects ledger fingerprint conflicts rather than last-write-wins', async () => {
    const txn = localTxn();
    seedLocalLedger(DEV_A, { transactions: [txn] });
    const fingerprint = await buildLedgerFingerprint({
      supplier: txn.supplier,
      invoiceNumber: txn.invoiceNumber,
      transactionDate: txn.transactionDate,
      netAmount: txn.netAmount,
      costCodeKey: txn.costCode,
      description: txn.description,
    });
    seedMockLedgerTransactions(DEV_A, [
      buildServerLedgerTransactionFixture({
        developmentId: DEV_A,
        fingerprint,
        supplier: txn.supplier,
        costCodeKey: txn.costCode,
        transactionDate: txn.transactionDate,
        invoiceNumber: txn.invoiceNumber,
        netAmount: txn.netAmount,
        vatAmount: 999,
        grossAmount: 1999,
      }),
    ]);
    const plan = await preflightCvrLedgerMigration(DEV_A);
    expect(plan.safeToExecute).toBe(false);
    expect(plan.ledger.conflicts[0].classification).toBe('CONFLICT');
  });

  it('isolates development A from development B', async () => {
    seedLocalCvr(DEV_A, { P01: localPeriod() });
    seedLocalCvr(DEV_B, { P01: localPeriod({ commercialCommentary: { keyCommercialIssues: 'B only' } }) });
    seedLocalLedger(DEV_A, { transactions: [localTxn()] });
    seedLocalLedger(DEV_B, { transactions: [localTxn({ id: 'txn-b', invoiceNumber: 'INV-B', developmentId: DEV_B })] });

    await executeCvrLedgerMigration(DEV_A, { confirm: true, developmentName: 'A' });
    const planB = await preflightCvrLedgerMigration(DEV_B, { developmentName: 'B' });
    expect(planB.cvr.serverPeriodCount).toBe(0);
    expect(planB.ledger.serverTransactionCount).toBe(0);
    expect(planB.cvr.periodsToCreate).toHaveLength(1);
  });

  it('reports a Test Site 1 shaped expected migration against an empty server', async () => {
    seedLocalCvr(DEV_A, {
      P01: localPeriod({ status: 'locked' }),
      P02: localPeriod({
        periodKey: 'P02',
        status: 'draft',
        commercialCommentary: {
          keyCommercialIssues: 'Open period',
          commercialOpportunities: '',
          financialRisks: '',
          actionsBeforeNextCvr: '',
        },
      }),
    });
    seedLocalLedger(DEV_A, {
      transactions: [localTxn(), localTxn({ id: 'txn-2', invoiceNumber: 'INV-2', netAmount: 250, importBatch: '' })],
      importHistory: [{ id: 'import-1', importBatch: 'batch-1', fileName: 'sage.csv' }],
    });
    const plan = await preflightCvrLedgerMigration(DEV_A, { developmentName: 'Test Site 1' });
    expect(plan.safeToExecute).toBe(true);
    expect(plan.cvr.localPeriodCount).toBe(2);
    expect(plan.cvr.serverPeriodCount).toBe(0);
    expect(plan.cvr.periodsToCreate.map((item) => item.periodKey)).toEqual(['P01', 'P02']);
    expect(plan.ledger.localTransactionCount).toBe(2);
    expect(plan.ledger.localNetTotal).toBe(1250);
    expect(plan.ledger.batchesToCreate.map((item) => item.originalFileName)).toEqual([
      'sage.csv',
      'LocalStorage migration - Test Site 1',
    ]);
    expect(plan.limitations.some((item) => /No CVR snapshot/i.test(item))).toBe(true);
  });
});
