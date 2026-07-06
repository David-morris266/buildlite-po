/**
 * BL-012A — Purchase Ledger view models and formatting.
 */

import { formatMoney, formatPoDate, formatPoDateTime } from '../components/poDrawerHelpers';
import {
  getActualCostsByCostCode,
  getLastImportRecord,
  getTotalActualCost,
  getTransactionCount,
  getUnmatchedTransactionCount,
  listImportHistory,
  listTransactions,
} from './ledgerTransactionStore';

export function formatLedgerMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `£${formatMoney(n)}`;
}

export function buildLedgerWorkspaceModel(development) {
  if (!development) return null;

  const developmentId = development.id;
  const transactions = listTransactions(developmentId);
  const lastImport = getLastImportRecord(developmentId);
  const actualCost = getTotalActualCost(developmentId);
  const unmatchedCount = getUnmatchedTransactionCount(developmentId);
  const importHistory = listImportHistory(developmentId);

  const importStatus = lastImport
    ? { label: 'Imported', modifier: 'approved' }
    : { label: 'Not imported', modifier: 'draft' };

  return {
    developmentId,
    developmentName: development.developmentName,
    developmentNumber: development.jobNumber,
    transactionCount: transactions.length,
    actualCost,
    unmatchedCount,
    lastImportLabel: lastImport
      ? formatPoDateTime(lastImport.importDate)
      : '—',
    lastImportBy: lastImport?.importedBy || '—',
    importStatus,
    actualCostsByCostCode: getActualCostsByCostCode(developmentId),
    summaryCards: [
      {
        label: 'Transactions',
        value: String(transactions.length),
        modifier: 'default',
      },
      {
        label: 'Actual Cost',
        value: formatLedgerMoney(actualCost),
        modifier: 'accent',
      },
      {
        label: 'Unmatched',
        value: String(unmatchedCount),
        modifier: unmatchedCount > 0 ? 'warning' : 'muted',
      },
      {
        label: 'Last Import',
        value: lastImport ? formatPoDate(lastImport.importDate) : '—',
        modifier: 'muted',
      },
      {
        label: 'Import Status',
        value: importStatus.label,
        modifier: importStatus.modifier,
        isBadge: true,
        status: importStatus,
      },
    ],
    importHistory,
  };
}

export function formatLedgerTransactionRow(transaction) {
  return {
    ...transaction,
    dateLabel: formatPoDate(transaction.transactionDate),
    amountLabel: formatLedgerMoney(transaction.netAmount),
    costCentreLabel: transaction.costCode || '—',
    sourceLabel: transaction.source || '—',
    supplierLabel: transaction.supplier || '—',
    descriptionLabel: transaction.description || '—',
    invoiceLabel: transaction.invoiceNumber || '—',
  };
}

export function formatImportHistoryRow(record) {
  return {
    ...record,
    dateLabel: formatPoDateTime(record.importDate),
    totalValueLabel: formatLedgerMoney(record.totalValue),
    profileLabel: record.importProfile || 'Custom',
  };
}

export function filterAndSortTransactions(transactions, { search = '', source = '', sortKey = 'transactionDate', sortDir = 'desc' } = {}) {
  const query = String(search || '').trim().toLowerCase();
  let rows = [...transactions];

  if (query) {
    rows = rows.filter((txn) => {
      const haystack = [
        txn.supplier,
        txn.costCode,
        txn.description,
        txn.invoiceNumber,
        txn.source,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  if (source) {
    rows = rows.filter((txn) => String(txn.source || '') === source);
  }

  rows.sort((a, b) => {
    let left = a[sortKey];
    let right = b[sortKey];

    if (sortKey === 'netAmount') {
      left = Number(left) || 0;
      right = Number(right) || 0;
    } else if (sortKey === 'transactionDate') {
      left = new Date(left).getTime() || 0;
      right = new Date(right).getTime() || 0;
    } else {
      left = String(left || '').toLowerCase();
      right = String(right || '').toLowerCase();
    }

    if (left < right) return sortDir === 'asc' ? -1 : 1;
    if (left > right) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return rows;
}

export function getUniqueTransactionSources(transactions) {
  const sources = new Set();
  for (const txn of transactions) {
    if (txn.source) sources.add(txn.source);
  }
  return [...sources].sort();
}
