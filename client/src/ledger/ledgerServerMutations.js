/**
 * BL-031C — Purchase ledger server mutation facade for future BL-031D.
 *
 * Live UI must not call these while VITE_LEDGER_SERVER_AUTHORITY is OFF.
 */

import {
  PurchaseLedgerApiError,
  importLedgerBatchForDevelopment,
  reverseLedgerTransactionForDevelopment,
} from '../api/purchaseLedger';
import {
  appendCachedLedgerTransactions,
  replaceCachedLedgerTotals,
  upsertCachedLedgerBatch,
} from './ledgerServerCache';

function mapApiError(error) {
  if (error instanceof PurchaseLedgerApiError) {
    return {
      ok: false,
      errors: [error.body?.message || error.message || 'Purchase ledger server request failed'],
      status: error.status,
      duplicates: error.body?.duplicates || [],
      transaction: error.body?.transaction || null,
    };
  }
  return {
    ok: false,
    errors: [error?.message || 'Purchase ledger server request failed'],
  };
}

export async function importServerLedgerBatch(developmentId, payload = {}) {
  try {
    const result = await importLedgerBatchForDevelopment(developmentId, payload);
    const batch = result?.batch || result;
    const transactions = result?.transactions || [];
    if (batch) upsertCachedLedgerBatch(developmentId, batch);
    if (transactions.length) appendCachedLedgerTransactions(developmentId, transactions);
    return { ok: true, batch, transactions };
  } catch (error) {
    return mapApiError(error);
  }
}

export async function reverseServerLedgerTransaction(developmentId, transactionId, payload = {}) {
  try {
    const transaction = await reverseLedgerTransactionForDevelopment(
      developmentId,
      transactionId,
      payload
    );
    if (transaction) appendCachedLedgerTransactions(developmentId, [transaction]);
    return { ok: true, transaction };
  } catch (error) {
    return mapApiError(error);
  }
}

export function applyLedgerTotalsToCache(developmentId, totals) {
  return replaceCachedLedgerTotals(developmentId, totals);
}
