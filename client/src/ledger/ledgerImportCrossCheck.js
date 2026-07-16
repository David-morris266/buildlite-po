/**
 * BL-017A — Purchase ledger import total cross-check.
 */

import { isBlankRow } from './csvImport';
import { buildMappedRow } from './ledgerImportFields';

function parseLedgerAmount(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return 0;
  const normalised = raw.replace(/[£,\s]/g, '');
  const amount = Number.parseFloat(normalised);
  return Number.isFinite(amount) ? amount : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function computeCsvLedgerTotal(parsedState = {}) {
  const { rows = [], headerRowIndex = 0, fieldByColumn = [] } = parsedState;
  const bodyRows = rows.slice(headerRowIndex + 1);
  let total = 0;
  let countedRows = 0;

  for (const row of bodyRows) {
    if (isBlankRow(row)) continue;
    const mapped = buildMappedRow(row, fieldByColumn);
    const amount = parseLedgerAmount(mapped.transactionAmount);
    if (!amount) continue;
    total += amount;
    countedRows += 1;
  }

  return {
    rowCount: countedRows,
    totalValue: roundMoney(total),
  };
}

export function buildLedgerImportCrossCheck(parsedState, validationResult = {}) {
  const csv = computeCsvLedgerTotal(parsedState);
  const buildliteTotal = roundMoney(validationResult.totalValue || 0);
  const difference = roundMoney(csv.totalValue - buildliteTotal);

  return {
    importedRows: validationResult.importedCount || 0,
    importedValue: buildliteTotal,
    csvRows: csv.rowCount,
    csvTotal: csv.totalValue,
    buildliteTotal,
    difference,
    balanced: Math.abs(difference) < 0.01,
  };
}
