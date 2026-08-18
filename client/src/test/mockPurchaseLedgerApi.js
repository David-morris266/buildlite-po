import { buildLedgerFingerprint } from '../ledger/ledgerFingerprint';

const store = {
  transactionsByDevelopment: new Map(),
  batchesByDevelopment: new Map(),
  totalsByDevelopment: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  mutationShouldReject: false,
  mutationRejectError: null,
  seq: 0,
  listCallCount: 0,
  batchListCallCount: 0,
  totalsCallCount: 0,
  importCallCount: 0,
  reverseCallCount: 0,
};

export class PurchaseLedgerApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message || 'Purchase ledger API request failed');
    this.name = 'PurchaseLedgerApiError';
    this.status = status;
    this.body = body;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function delay() {
  if (!store.listDelayMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, store.listDelayMs));
}

export function resetLedgerApiStore() {
  store.transactionsByDevelopment.clear();
  store.batchesByDevelopment.clear();
  store.totalsByDevelopment.clear();
  store.listDelayMs = 0;
  store.listShouldReject = false;
  store.listRejectError = null;
  store.mutationShouldReject = false;
  store.mutationRejectError = null;
  store.seq = 0;
  store.listCallCount = 0;
  store.batchListCallCount = 0;
  store.totalsCallCount = 0;
  store.importCallCount = 0;
  store.reverseCallCount = 0;
}

export function seedMockLedgerTransactions(developmentId, transactions) {
  store.transactionsByDevelopment.set(developmentId, clone(transactions || []));
}

export function seedMockLedgerBatches(developmentId, batches) {
  store.batchesByDevelopment.set(developmentId, clone(batches || []));
}

export function seedMockLedgerTotals(developmentId, totals) {
  store.totalsByDevelopment.set(developmentId, clone(totals || {}));
}

export function setLedgerListDelay(ms) {
  store.listDelayMs = Number(ms) || 0;
}

export function setLedgerListReject(error = null) {
  store.listShouldReject = true;
  store.listRejectError =
    error ||
    new PurchaseLedgerApiError('Unable to load purchase ledger.', { status: 500 });
}

export function getLedgerListCallCount() {
  return store.listCallCount;
}

export function getLedgerBatchListCallCount() {
  return store.batchListCallCount;
}

export function getLedgerTotalsCallCount() {
  return store.totalsCallCount;
}

export function getLedgerMutationCallCounts() {
  return {
    import: store.importCallCount,
    reverse: store.reverseCallCount,
    total: store.importCallCount + store.reverseCallCount,
  };
}

export function setLedgerMutationReject(error = null) {
  store.mutationShouldReject = true;
  store.mutationRejectError =
    error ||
    new PurchaseLedgerApiError('Duplicate ledger transaction fingerprint. The batch was not imported.', {
      status: 409,
      body: {
        message: 'Duplicate ledger transaction fingerprint. The batch was not imported.',
        duplicates: ['abc123'],
      },
    });
}

function newMockId() {
  store.seq += 1;
  return `99999999-aaaa-4bbb-8ccc-${String(store.seq).padStart(12, '0')}`;
}

export function buildServerLedgerTransactionFixture(overrides = {}) {
  return {
    id: overrides.id || '99999999-aaaa-4bbb-8ccc-dddddddddddd',
    developmentId: overrides.developmentId || 'dev-ledger-b',
    batchId: overrides.batchId || '88888888-aaaa-4bbb-8ccc-eeeeeeeeeeee',
    supplier: overrides.supplier || 'Wipe It Cleaners',
    supplierCode: overrides.supplierCode || 'WIC',
    costCodeKey: overrides.costCodeKey || '5231',
    transactionDate: overrides.transactionDate || '2026-01-15',
    invoiceNumber: overrides.invoiceNumber || 'INV-1',
    description: overrides.description || 'January invoice',
    netAmount: overrides.netAmount ?? 1000,
    vatAmount: overrides.vatAmount ?? 200,
    grossAmount: overrides.grossAmount ?? 1200,
    source: overrides.source || 'Sage Purchase Ledger',
    documentType: overrides.documentType || 'Invoice',
    reference: overrides.reference || 'REF-1',
    fingerprint: overrides.fingerprint || 'abc123',
    reversesId: overrides.reversesId || null,
    createdAt: overrides.createdAt || '2026-01-16T09:00:00.000Z',
    createdBy: overrides.createdBy || 'QS',
  };
}

export function buildServerLedgerBatchFixture(overrides = {}) {
  return {
    id: overrides.id || '88888888-aaaa-4bbb-8ccc-eeeeeeeeeeee',
    developmentId: overrides.developmentId || 'dev-ledger-b',
    originalFileName: overrides.originalFileName || 'actuals.csv',
    sourceProfile: overrides.sourceProfile || 'Sage Purchase Ledger',
    rowsImported: overrides.rowsImported ?? 1,
    rowsRejected: overrides.rowsRejected ?? 0,
    totalNet: overrides.totalNet ?? 1000,
    metadata: overrides.metadata || {},
    importedBy: overrides.importedBy || 'QS',
    importedAt: overrides.importedAt || '2026-01-16T09:00:00.000Z',
    createdAt: overrides.createdAt || '2026-01-16T09:00:00.000Z',
  };
}

export async function listLedgerTransactionsForDevelopment(developmentId) {
  store.listCallCount += 1;
  await delay();
  if (store.listShouldReject) throw store.listRejectError;
  return clone(store.transactionsByDevelopment.get(developmentId) || []);
}

export async function listLedgerBatchesForDevelopment(developmentId) {
  store.batchListCallCount += 1;
  await delay();
  if (store.listShouldReject) throw store.listRejectError;
  return clone(store.batchesByDevelopment.get(developmentId) || []);
}

export async function getLedgerTotalsForDevelopment(developmentId) {
  store.totalsCallCount += 1;
  await delay();
  if (store.listShouldReject) throw store.listRejectError;
  const seeded = store.totalsByDevelopment.get(developmentId);
  if (seeded) return clone(seeded);
  const transactions = store.transactionsByDevelopment.get(developmentId) || [];
  const actualCostByCostCode = {};
  let totalNet = 0;
  let totalVat = 0;
  for (const txn of transactions) {
    totalNet += Number(txn.netAmount) || 0;
    totalVat += Number(txn.vatAmount) || 0;
    const key = txn.costCodeKey || txn.costCode;
    if (key) {
      actualCostByCostCode[key] = (actualCostByCostCode[key] || 0) + (Number(txn.netAmount) || 0);
    }
  }
  return {
    totalNet,
    totalVat,
    transactionCount: transactions.length,
    actualCostByCostCode,
  };
}

export async function importLedgerBatchForDevelopment(developmentId, payload = {}) {
  store.importCallCount += 1;
  if (store.mutationShouldReject) throw store.mutationRejectError;
  const items = Array.isArray(payload.transactions) ? payload.transactions : [];
  if (!items.length) {
    throw new PurchaseLedgerApiError('transactions must be a non-empty array.', { status: 400 });
  }
  const existing = store.transactionsByDevelopment.get(developmentId) || [];
  const existingFingerprints = new Set(existing.map((item) => item.fingerprint));
  const mapped = [];
  for (const item of items) {
    const fingerprint = await buildLedgerFingerprint({
      supplier: item.supplier,
      invoiceNumber: item.invoiceNumber,
      transactionDate: item.transactionDate,
      netAmount: item.netAmount,
      costCodeKey: item.costCodeKey || item.costCode,
      description: item.description,
    });
    if (existingFingerprints.has(fingerprint) || mapped.some((row) => row.fingerprint === fingerprint)) {
      throw new PurchaseLedgerApiError(
        'Duplicate ledger transaction fingerprint. The batch was not imported.',
        {
          status: 409,
          body: {
            message: 'Duplicate ledger transaction fingerprint. The batch was not imported.',
            duplicates: [fingerprint],
          },
        }
      );
    }
    mapped.push(
      buildServerLedgerTransactionFixture({
        id: newMockId(),
        developmentId,
        batchId: null,
        fingerprint,
        supplier: item.supplier,
        supplierCode: item.supplierCode,
        costCodeKey: item.costCodeKey || item.costCode,
        transactionDate: item.transactionDate,
        invoiceNumber: item.invoiceNumber,
        description: item.description,
        netAmount: item.netAmount,
        vatAmount: item.vatAmount ?? item.vat,
        grossAmount: item.grossAmount,
        source: item.source,
        documentType: item.documentType,
        reference: item.reference,
        createdBy: payload.importedBy || payload.actor || 'migration',
      })
    );
  }
  const batch = buildServerLedgerBatchFixture({
    id: newMockId(),
    developmentId,
    originalFileName: payload.originalFileName || payload.fileName || '',
    sourceProfile: payload.sourceProfile || payload.importProfile || '',
    rowsImported: mapped.length,
    rowsRejected: 0,
    totalNet: mapped.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0),
    metadata: payload.metadata || {},
    importedBy: payload.importedBy || payload.actor || 'migration',
  });
  for (const txn of mapped) txn.batchId = batch.id;
  store.batchesByDevelopment.set(developmentId, [batch, ...(store.batchesByDevelopment.get(developmentId) || [])]);
  store.transactionsByDevelopment.set(developmentId, [...existing, ...mapped]);
  store.totalsByDevelopment.delete(developmentId);
  return { batch: clone(batch), transactions: clone(mapped) };
}

export async function reverseLedgerTransactionForDevelopment(
  developmentId,
  transactionId,
  payload = {}
) {
  store.reverseCallCount += 1;
  if (store.mutationShouldReject) throw store.mutationRejectError;
  const existing = store.transactionsByDevelopment.get(developmentId) || [];
  const origin = existing.find((item) => item.id === transactionId);
  if (!origin) {
    throw new PurchaseLedgerApiError('Ledger transaction not found.', { status: 404 });
  }
  const reversal = buildServerLedgerTransactionFixture({
    id: newMockId(),
    developmentId,
    batchId: origin.batchId,
    supplier: origin.supplier,
    supplierCode: origin.supplierCode,
    costCodeKey: origin.costCodeKey,
    transactionDate: origin.transactionDate,
    invoiceNumber: origin.invoiceNumber,
    description: `Reversal of ${origin.invoiceNumber || origin.id}`,
    netAmount: -Number(origin.netAmount || 0),
    vatAmount: origin.vatAmount == null ? null : -Number(origin.vatAmount),
    grossAmount: origin.grossAmount == null ? null : -Number(origin.grossAmount),
    source: origin.source,
    documentType: origin.documentType,
    fingerprint: `rev-${origin.fingerprint}`,
    reversesId: origin.id,
    createdBy: payload.actor || 'migration',
  });
  store.transactionsByDevelopment.set(developmentId, [...existing, reversal]);
  store.totalsByDevelopment.delete(developmentId);
  return clone(reversal);
}
