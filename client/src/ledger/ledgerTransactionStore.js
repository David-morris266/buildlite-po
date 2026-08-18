/**
 * BL-012A — Purchase Ledger transaction persistence (localStorage).
 */

import { normaliseCostCodeKey } from '../cvr/cvrCalculations';
import { isLedgerServerAuthorityEnabled } from './ledgerAuthority';
import {
  getCachedLedgerBatches,
  getCachedLedgerTotals,
  getCachedLedgerTransactions,
  getLedgerReadiness,
} from './ledgerServerCache';

const STORAGE_KEY = 'buildlite_purchase_ledgers_v1';

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function newId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseLedgerRecord(record) {
  if (!record) {
    return {
      transactions: [],
      importHistory: [],
      importProfiles: [],
      actualCostsByCostCode: {},
      updatedAt: null,
    };
  }

  return {
    transactions: Array.isArray(record.transactions) ? record.transactions : [],
    importHistory: Array.isArray(record.importHistory) ? record.importHistory : [],
    importProfiles: Array.isArray(record.importProfiles) ? record.importProfiles : [],
    actualCostsByCostCode:
      record.actualCostsByCostCode && typeof record.actualCostsByCostCode === 'object'
        ? record.actualCostsByCostCode
        : {},
    updatedAt: record.updatedAt || null,
  };
}

export function ensureLedger(developmentId) {
  const all = readAll();
  if (!all[developmentId]) {
    all[developmentId] = normaliseLedgerRecord(null);
    writeAll(all);
  }
  return normaliseLedgerRecord(all[developmentId]);
}

export function getLedger(developmentId) {
  return normaliseLedgerRecord(readAll()[developmentId]);
}

export function listTransactions(developmentId) {
  if (isLedgerServerAuthorityEnabled()) {
    if (!getLedgerReadiness(developmentId).ready) return [];
    return [...getCachedLedgerTransactions(developmentId)];
  }
  return [...ensureLedger(developmentId).transactions].sort(
    (a, b) => new Date(b.transactionDate) - new Date(a.transactionDate)
  );
}

export function listImportHistory(developmentId) {
  if (isLedgerServerAuthorityEnabled()) {
    if (!getLedgerReadiness(developmentId).ready) return [];
    return [...getCachedLedgerBatches(developmentId)];
  }
  return [...ensureLedger(developmentId).importHistory].sort(
    (a, b) => new Date(b.importDate) - new Date(a.importDate)
  );
}

export function getActualCostsByCostCode(developmentId) {
  if (isLedgerServerAuthorityEnabled()) {
    if (!getLedgerReadiness(developmentId).ready) return null;
    return { ...getCachedLedgerTotals(developmentId).actualCostByCostCode };
  }
  return { ...ensureLedger(developmentId).actualCostsByCostCode };
}

export function getTransactionCount(developmentId) {
  if (isLedgerServerAuthorityEnabled()) {
    if (!getLedgerReadiness(developmentId).ready) return null;
    return getCachedLedgerTransactions(developmentId).length;
  }
  return ensureLedger(developmentId).transactions.length;
}

export function getLastImportRecord(developmentId) {
  const history = listImportHistory(developmentId);
  return history[0] || null;
}

function recalculateActualCosts(transactions) {
  const totals = {};

  for (const txn of transactions) {
    const code = normaliseCostCodeKey(txn.costCode);
    if (!code) continue;
    const amount = Number(txn.netAmount) || 0;
    totals[code] = roundMoney((totals[code] || 0) + amount);
  }

  return totals;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function createTransaction(payload) {
  const now = new Date().toISOString();
  return {
    id: newId('txn'),
    developmentId: payload.developmentId,
    supplier: payload.supplier || '',
    supplierCode: payload.supplierCode || '',
    costCode: payload.costCode || '',
    description: payload.description || '',
    transactionDate: payload.transactionDate || '',
    invoiceNumber: payload.invoiceNumber || '',
    netAmount: roundMoney(payload.netAmount ?? 0),
    vat: payload.vat != null ? roundMoney(payload.vat) : null,
    grossAmount:
      payload.grossAmount != null ? roundMoney(payload.grossAmount) : null,
    source: payload.source || '',
    documentType: payload.documentType || '',
    reference: payload.reference || '',
    importBatch: payload.importBatch || '',
    createdAt: now,
    importedBy: payload.importedBy || sessionActor(),
  };
}

export function appendTransactions(developmentId, transactions) {
  const all = readAll();
  const record = normaliseLedgerRecord(all[developmentId]);
  const now = new Date().toISOString();

  record.transactions = [...record.transactions, ...transactions];
  record.actualCostsByCostCode = recalculateActualCosts(record.transactions);
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return { ok: true, count: transactions.length };
}

export function appendImportHistory(developmentId, entry) {
  const all = readAll();
  const record = normaliseLedgerRecord(all[developmentId]);
  const now = new Date().toISOString();

  const historyRecord = {
    id: newId('import'),
    importDate: entry.importDate || now,
    importedBy: entry.importedBy || sessionActor(),
    rowsImported: entry.rowsImported ?? 0,
    rowsRejected: entry.rowsRejected ?? 0,
    totalValue: roundMoney(entry.totalValue ?? 0),
    fileName: entry.fileName || '',
    importProfile: entry.importProfile || 'Custom',
    importBatch: entry.importBatch || '',
  };

  record.importHistory = [historyRecord, ...record.importHistory];
  record.updatedAt = now;
  all[developmentId] = record;
  writeAll(all);

  return historyRecord;
}

export function getExistingInvoiceKeys(developmentId) {
  const keys = new Set();
  for (const txn of listTransactions(developmentId)) {
    const invoice = String(txn.invoiceNumber || '').trim().toLowerCase();
    const supplier = String(txn.supplier || '').trim().toLowerCase();
    if (invoice) {
      keys.add(`${supplier}::${invoice}`);
    }
  }
  return keys;
}

export function getTotalActualCost(developmentId) {
  if (isLedgerServerAuthorityEnabled()) {
    if (!getLedgerReadiness(developmentId).ready) return null;
    const totals = getCachedLedgerTotals(developmentId);
    if (totals.totalNet != null) return roundMoney(totals.totalNet);
  }
  const totals = getActualCostsByCostCode(developmentId);
  if (!totals) return null;
  return roundMoney(
    Object.values(totals).reduce((sum, value) => sum + (Number(value) || 0), 0)
  );
}

export function getUnmatchedTransactionCount(developmentId) {
  return listTransactions(developmentId).filter((txn) => txn.unmatched).length;
}
