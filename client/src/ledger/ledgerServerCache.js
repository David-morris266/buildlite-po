/**
 * BL-031B — In-memory purchase ledger cache (development-scoped).
 *
 * When VITE_LEDGER_SERVER_AUTHORITY=true, reads use this cache.
 * BL-031C adds cache patch helpers for future BL-031D mutations.
 * Live UI remains unwired. No localStorage fallback.
 */

import {
  PurchaseLedgerApiError,
  getLedgerTotalsForDevelopment,
  listLedgerBatchesForDevelopment,
  listLedgerTransactionsForDevelopment,
} from '../api/purchaseLedger';
import {
  normalizeServerLedgerBatch,
  normalizeServerLedgerBatchList,
  normalizeServerLedgerTotals,
  normalizeServerLedgerTransactionList,
} from './ledgerServerMapper';
import { normaliseCostCodeKey } from '../cvr/cvrCalculations';

export class LedgerCacheError extends Error {
  constructor(message, { code = 'ERROR', status = 0 } = {}) {
    super(message);
    this.name = 'LedgerCacheError';
    this.code = code;
    this.status = status;
  }
}

const transactionsByDevelopment = new Map();
const batchesByDevelopment = new Map();
const totalsByDevelopment = new Map();
const loadStateByDevelopment = new Map();
const loadErrorByDevelopment = new Map();
const loadPromiseByDevelopment = new Map();

function wrapApiError(error) {
  if (error instanceof LedgerCacheError) return error;
  if (error instanceof PurchaseLedgerApiError) {
    return new LedgerCacheError(error.message, {
      code: 'API_ERROR',
      status: error.status,
    });
  }
  return new LedgerCacheError(error?.message || 'Unable to load ledger data', {
    code: 'NETWORK_ERROR',
  });
}

export function getLedgerLoadState(developmentId) {
  return loadStateByDevelopment.get(developmentId) || 'idle';
}

export function getLedgerLoadError(developmentId) {
  return loadErrorByDevelopment.get(developmentId) || null;
}

export function getLedgerReadiness(developmentId) {
  const loadState = getLedgerLoadState(developmentId);
  if (loadState === 'loaded') return { ready: true, loadState, error: null };
  if (loadState === 'loading') {
    return { ready: false, loadState, error: null, reason: 'loading' };
  }
  if (loadState === 'error') {
    return {
      ready: false,
      loadState,
      error: getLedgerLoadError(developmentId),
      reason: 'error',
    };
  }
  return { ready: false, loadState, error: null, reason: 'idle' };
}

export function getCachedLedgerTransactions(developmentId) {
  return transactionsByDevelopment.get(developmentId) || [];
}

export function getCachedLedgerBatches(developmentId) {
  return batchesByDevelopment.get(developmentId) || [];
}

export function getCachedLedgerTotals(developmentId) {
  return (
    totalsByDevelopment.get(developmentId) || {
      totalNet: 0,
      totalVat: 0,
      transactionCount: 0,
      actualCostByCostCode: {},
    }
  );
}

function actualsFromTransactions(transactions) {
  const totals = {};
  for (const txn of transactions) {
    const key = normaliseCostCodeKey(txn.costCode || txn.costCodeKey);
    if (!key) continue;
    totals[key] = Math.round(((totals[key] || 0) + (Number(txn.netAmount) || 0) + Number.EPSILON) * 100) / 100;
  }
  return totals;
}

async function fetchLedger(developmentId) {
  const [transactionDocs, batchDocs, totalsDoc] = await Promise.all([
    listLedgerTransactionsForDevelopment(developmentId),
    listLedgerBatchesForDevelopment(developmentId),
    getLedgerTotalsForDevelopment(developmentId),
  ]);
  const transactions = normalizeServerLedgerTransactionList(transactionDocs);
  const batches = normalizeServerLedgerBatchList(batchDocs);
  const totals = normalizeServerLedgerTotals(totalsDoc);
  if (!Object.keys(totals.actualCostByCostCode || {}).length) {
    totals.actualCostByCostCode = actualsFromTransactions(transactions);
    totals.totalNet = transactions.reduce((sum, txn) => sum + (Number(txn.netAmount) || 0), 0);
    totals.transactionCount = transactions.length;
  }
  transactionsByDevelopment.set(developmentId, transactions);
  batchesByDevelopment.set(developmentId, batches);
  totalsByDevelopment.set(developmentId, totals);
  return { transactions, batches, totals };
}

export async function refreshLedgerForDevelopment(developmentId) {
  if (!developmentId) return { transactions: [], batches: [], totals: normalizeServerLedgerTotals(null) };
  loadStateByDevelopment.set(developmentId, 'loading');
  loadErrorByDevelopment.set(developmentId, null);
  try {
    const payload = await fetchLedger(developmentId);
    loadStateByDevelopment.set(developmentId, 'loaded');
    return payload;
  } catch (error) {
    const wrapped = wrapApiError(error);
    loadStateByDevelopment.set(developmentId, 'error');
    loadErrorByDevelopment.set(developmentId, wrapped);
    throw wrapped;
  }
}

export function ensureLedgerReadyForDevelopment(developmentId) {
  if (!developmentId) {
    return Promise.reject(
      new LedgerCacheError(
        'Unable to load ledger data because this development has no identity.',
        { code: 'MISSING_DEVELOPMENT_ID' }
      )
    );
  }

  if (loadPromiseByDevelopment.has(developmentId)) {
    return loadPromiseByDevelopment.get(developmentId);
  }

  if (getLedgerLoadState(developmentId) === 'loaded') {
    return Promise.resolve({
      transactions: getCachedLedgerTransactions(developmentId),
      batches: getCachedLedgerBatches(developmentId),
      totals: getCachedLedgerTotals(developmentId),
    });
  }

  const promise = (async () => {
    loadStateByDevelopment.set(developmentId, 'loading');
    loadErrorByDevelopment.set(developmentId, null);
    try {
      const payload = await fetchLedger(developmentId);
      loadStateByDevelopment.set(developmentId, 'loaded');
      return payload;
    } catch (error) {
      const wrapped = wrapApiError(error);
      loadStateByDevelopment.set(developmentId, 'error');
      loadErrorByDevelopment.set(developmentId, wrapped);
      throw wrapped;
    } finally {
      loadPromiseByDevelopment.delete(developmentId);
    }
  })();

  loadPromiseByDevelopment.set(developmentId, promise);
  return promise;
}

export function replaceCachedLedger(developmentId, { transactions, batches, totals } = {}) {
  const nextTransactions = normalizeServerLedgerTransactionList(transactions || []);
  const nextBatches = normalizeServerLedgerBatchList(batches || []);
  const nextTotals = normalizeServerLedgerTotals(totals);
  transactionsByDevelopment.set(developmentId, nextTransactions);
  batchesByDevelopment.set(developmentId, nextBatches);
  totalsByDevelopment.set(developmentId, nextTotals);
  loadStateByDevelopment.set(developmentId, 'loaded');
  loadErrorByDevelopment.set(developmentId, null);
  return { transactions: nextTransactions, batches: nextBatches, totals: nextTotals };
}

export function upsertCachedLedgerBatch(developmentId, document) {
  if (!developmentId || !document) return null;
  const mapped = normalizeServerLedgerBatch(document);
  const existing = getCachedLedgerBatches(developmentId).filter((item) => item.id !== mapped.id);
  batchesByDevelopment.set(developmentId, [mapped, ...existing]);
  loadStateByDevelopment.set(developmentId, 'loaded');
  return mapped;
}

export function appendCachedLedgerTransactions(developmentId, documents = []) {
  const mapped = normalizeServerLedgerTransactionList(documents);
  const existing = getCachedLedgerTransactions(developmentId);
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of mapped) byId.set(item.id, item);
  const next = [...byId.values()];
  transactionsByDevelopment.set(developmentId, next);
  totalsByDevelopment.set(developmentId, {
    totalNet: next.reduce((sum, txn) => sum + (Number(txn.netAmount) || 0), 0),
    totalVat: next.reduce((sum, txn) => sum + (Number(txn.vatAmount) || 0), 0),
    transactionCount: next.length,
    actualCostByCostCode: actualsFromTransactions(next),
  });
  loadStateByDevelopment.set(developmentId, 'loaded');
  return next;
}

export function replaceCachedLedgerTotals(developmentId, totals) {
  const mapped = normalizeServerLedgerTotals(totals);
  totalsByDevelopment.set(developmentId, mapped);
  return mapped;
}

export function __resetLedgerServerCacheForTests() {
  transactionsByDevelopment.clear();
  batchesByDevelopment.clear();
  totalsByDevelopment.clear();
  loadStateByDevelopment.clear();
  loadErrorByDevelopment.clear();
  loadPromiseByDevelopment.clear();
}
