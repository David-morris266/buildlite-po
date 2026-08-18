/**
 * BL-031C — Deterministic localStorage ledger → server import mapping.
 *
 * Reads raw `buildlite_purchase_ledgers_v1`. Does not call ensureLedger
 * (that writes an empty record).
 */

import { normaliseCostCodeKey, roundMoney } from '../cvr/cvrCalculations';
import { buildLedgerFingerprint } from './ledgerFingerprint';

export const LEDGER_LOCAL_STORAGE_KEY = 'buildlite_purchase_ledgers_v1';

export const LEDGER_FIELDS_NOT_MIGRATED = [
  'local transaction ids',
  'local invoice-key duplicate identity (supplier::invoice) — server fingerprint is authority',
  'historic createdAt on transactions (server uses NOW())',
  'historic importedBy on transactions unless present on the local import-history row',
];

function parseJson(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return { __invalid: true };
  }
}

export function readRawLocalLedgerStore(storage = globalThis.localStorage) {
  if (!storage?.getItem) return {};
  const parsed = parseJson(storage.getItem(LEDGER_LOCAL_STORAGE_KEY));
  if (parsed.__invalid) return { __invalid: true };
  return parsed;
}

export function listLocalLedgerDevelopmentIds(storage = globalThis.localStorage) {
  const all = readRawLocalLedgerStore(storage);
  if (all.__invalid) return [];
  return Object.keys(all).sort();
}

export function isoDateOnly(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return '';
}

export function mapLocalLedgerTransaction(txn, index = 0) {
  const errors = [];
  if (!txn || typeof txn !== 'object') {
    return { ok: false, errors: [`transactions[${index}] is not an object.`] };
  }
  const supplier = String(txn.supplier || '').trim();
  if (!supplier) errors.push(`transactions[${index}].supplier is required.`);
  const costCodeKey = normaliseCostCodeKey(txn.costCode || txn.costCodeKey);
  if (!costCodeKey) errors.push(`transactions[${index}].costCode is required.`);
  const transactionDate = isoDateOnly(txn.transactionDate);
  if (!transactionDate) {
    errors.push(`transactions[${index}].transactionDate must be YYYY-MM-DD.`);
  }
  const netAmount = roundMoney(txn.netAmount ?? txn.net);
  if (netAmount == null) errors.push(`transactions[${index}].netAmount must be a finite amount.`);

  const vatAmount =
    txn.vatAmount == null && txn.vat == null ? null : roundMoney(txn.vatAmount ?? txn.vat);
  if ((txn.vatAmount != null || txn.vat != null) && vatAmount == null) {
    errors.push(`transactions[${index}].vat must be a finite amount.`);
  }
  let grossAmount =
    txn.grossAmount == null && txn.gross == null ? null : roundMoney(txn.grossAmount ?? txn.gross);
  if ((txn.grossAmount != null || txn.gross != null) && grossAmount == null) {
    errors.push(`transactions[${index}].grossAmount must be a finite amount.`);
  }
  if (grossAmount == null && netAmount != null && vatAmount != null) {
    grossAmount = roundMoney(netAmount + vatAmount);
  }

  const value = {
    localId: txn.id || null,
    importBatch: String(txn.importBatch || ''),
    supplier,
    supplierCode: String(txn.supplierCode || '').trim(),
    costCodeKey,
    transactionDate,
    invoiceNumber: String(txn.invoiceNumber || '').trim(),
    description: String(txn.description || '').trim(),
    netAmount,
    vatAmount,
    grossAmount,
    source: String(txn.source || '').trim(),
    documentType: String(txn.documentType || '').trim(),
    reference: String(txn.reference || '').trim(),
  };

  return { ok: errors.length === 0, errors, value };
}

export async function attachLedgerFingerprints(mappedTransactions) {
  const next = [];
  for (const item of mappedTransactions) {
    const fingerprint = await buildLedgerFingerprint(item);
    next.push({ ...item, fingerprint });
  }
  return next;
}

export function defaultMigrationBatchLabel(developmentName, developmentId) {
  const label = String(developmentName || '').trim();
  return label
    ? `LocalStorage migration - ${label}`
    : `LocalStorage migration - ${developmentId}`;
}

export function groupLocalLedgerBatches({
  transactions,
  importHistory = [],
  developmentId,
  developmentName,
}) {
  const historyByBatch = new Map();
  for (const entry of importHistory) {
    const key = String(entry?.importBatch || entry?.id || '');
    if (key) historyByBatch.set(key, entry);
  }

  const groups = new Map();
  const unbatchedKey = '__local_migration__';

  for (const txn of transactions) {
    const batchKey = String(txn.importBatch || '');
    const history = batchKey ? historyByBatch.get(batchKey) : null;
    const groupKey = batchKey && (history || batchKey) ? batchKey : unbatchedKey;
    if (!groups.has(groupKey)) {
      const fileName = String(history?.fileName || '').trim();
      groups.set(groupKey, {
        localBatchKey: groupKey === unbatchedKey ? null : groupKey,
        originalFileName:
          fileName ||
          (groupKey === unbatchedKey
            ? defaultMigrationBatchLabel(developmentName, developmentId)
            : `LocalStorage import ${groupKey}`),
        sourceProfile: String(history?.importProfile || txn.source || ''),
        importedBy: history?.importedBy || null,
        transactions: [],
      });
    }
    groups.get(groupKey).transactions.push(txn);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      rowCount: group.transactions.length,
      totalNet: group.transactions.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0),
    }))
    .sort((a, b) => {
      if (!a.localBatchKey && b.localBatchKey) return 1;
      if (a.localBatchKey && !b.localBatchKey) return -1;
      return String(a.originalFileName).localeCompare(String(b.originalFileName));
    });
}

export function readLocalLedgerDevelopment(developmentId, storage = globalThis.localStorage) {
  const all = readRawLocalLedgerStore(storage);
  if (all.__invalid) {
    return {
      exists: false,
      invalid: true,
      errors: ['buildlite_purchase_ledgers_v1 is not valid JSON.'],
      transactions: [],
      importHistory: [],
    };
  }
  if (!Object.prototype.hasOwnProperty.call(all, developmentId)) {
    return {
      exists: false,
      invalid: false,
      errors: [],
      transactions: [],
      importHistory: [],
      localNetTotal: 0,
    };
  }
  const record = all[developmentId];
  if (!record || typeof record !== 'object') {
    return {
      exists: true,
      invalid: true,
      errors: ['Local ledger development record is not an object.'],
      transactions: [],
      importHistory: [],
    };
  }

  const errors = [];
  const transactions = [];
  const source = Array.isArray(record.transactions) ? record.transactions : [];
  source.forEach((txn, index) => {
    const mapped = mapLocalLedgerTransaction(txn, index);
    if (!mapped.ok) {
      errors.push(...mapped.errors);
      return;
    }
    transactions.push(mapped.value);
  });

  return {
    exists: true,
    invalid: errors.length > 0,
    errors,
    transactions,
    importHistory: Array.isArray(record.importHistory) ? record.importHistory : [],
    localNetTotal: transactions.reduce((sum, item) => sum + (Number(item.netAmount) || 0), 0),
  };
}

export function importBatchPayload(group) {
  return {
    originalFileName: group.originalFileName,
    sourceProfile: group.sourceProfile,
    importedBy: group.importedBy || undefined,
    metadata: {
      migratedFrom: 'localStorage',
      localImportBatch: group.localBatchKey,
    },
    transactions: group.transactions.map((txn) => ({
      supplier: txn.supplier,
      supplierCode: txn.supplierCode,
      costCodeKey: txn.costCodeKey,
      transactionDate: txn.transactionDate,
      invoiceNumber: txn.invoiceNumber,
      description: txn.description,
      netAmount: txn.netAmount,
      vatAmount: txn.vatAmount,
      grossAmount: txn.grossAmount,
      source: txn.source,
      documentType: txn.documentType,
      reference: txn.reference,
    })),
  };
}
