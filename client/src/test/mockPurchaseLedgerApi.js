/**
 * In-memory purchase ledger API mock for client tests (BL-031B).
 */

const store = {
  transactionsByDevelopment: new Map(),
  batchesByDevelopment: new Map(),
  totalsByDevelopment: new Map(),
  listDelayMs: 0,
  listShouldReject: false,
  listRejectError: null,
  listCallCount: 0,
  batchListCallCount: 0,
  totalsCallCount: 0,
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
  store.listCallCount = 0;
  store.batchListCallCount = 0;
  store.totalsCallCount = 0;
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

export async function importLedgerBatchForDevelopment() {
  throw new PurchaseLedgerApiError('Ledger import is not wired in BL-031B.', { status: 501 });
}

export async function reverseLedgerTransactionForDevelopment() {
  throw new PurchaseLedgerApiError('Ledger reversal is not wired in BL-031B.', { status: 501 });
}
