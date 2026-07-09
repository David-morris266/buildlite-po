/**
 * BL-012A — Purchase Ledger import validation (Doc 38–40).
 */

import { parseMoneyCell } from '../payments/excelImport';
import { normaliseCostCodeKey, findMatchingCostCodeKey } from '../cvr/cvrCalculations';
import { isBlankRow } from './csvImport';
import { buildMappedRow, getMissingRequiredFields } from './ledgerImportFields';
import {
  buildImportCostCentreDescription,
  collectKnownCostCentreKeys,
} from './ledgerCostCentreImport';
import { getExistingInvoiceKeys } from './ledgerTransactionStore';

export const WARNING_TYPES = {
  DEVELOPMENT_MISMATCH: 'Development identifier mismatch',
  NEW_COST_CODE: 'New Cost Code will be created',
};

export const ERROR_TYPES = {
  MISSING_SUPPLIER: 'Missing Supplier',
  MISSING_AMOUNT: 'Missing Amount',
  INVALID_AMOUNT: 'Invalid Amount',
  MISSING_DATE: 'Missing Transaction Date',
  INVALID_DATE: 'Invalid Transaction Date',
  DUPLICATE_TRANSACTION: 'Duplicate Transaction',
  MISSING_COST_CODE: 'Missing Cost Code',
  UNKNOWN_COST_CODE: 'Unknown Cost Code',
};

function normaliseText(value) {
  return String(value || '').trim().toLowerCase();
}

function parseLedgerDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const ukMatch = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (ukMatch) {
    const day = Number.parseInt(ukMatch[1], 10);
    const month = Number.parseInt(ukMatch[2], 10) - 1;
    let year = Number.parseInt(ukMatch[3], 10);
    if (year < 100) year += 2000;
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }

  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) {
    return iso.toISOString().slice(0, 10);
  }

  return null;
}

function developmentMatches(identifier, context) {
  const value = normaliseText(identifier);
  if (!value) return true;

  const candidates = [
    context.developmentId,
    context.developmentNumber,
    context.developmentName,
  ]
    .map(normaliseText)
    .filter(Boolean);

  return candidates.some(
    (candidate) => value === candidate || value.includes(candidate) || candidate.includes(value)
  );
}

export function buildDevelopmentMismatchWarning(csvIdentifier, context) {
  const csvLabel = String(csvIdentifier || '').trim() || '—';
  const devNumber = context.developmentNumber || '—';
  const devName = context.developmentName || 'this development';

  return `CSV contract ${csvLabel} does not match Development ${devNumber}. Transactions will be imported into ${devName}.`;
}

function normaliseCostCode(value) {
  return String(value || '').trim();
}

function buildTransactionKey({ supplier, invoiceNumber, transactionDate, netAmount, description }) {
  const invoice = normaliseText(invoiceNumber);
  if (invoice) {
    return `${normaliseText(supplier)}::inv::${invoice}`;
  }

  return [
    normaliseText(supplier),
    transactionDate || '',
    String(netAmount ?? ''),
    normaliseText(description),
  ].join('::');
}

export function validateLedgerImport(rows, headerRowIndex, fieldByColumn, context = {}) {
  const dataRows = rows.slice(headerRowIndex + 1);
  const existingInvoices = getExistingInvoiceKeys(context.developmentId);
  const batchTransactionKeys = new Set();
  const knownCostCentreKeys = collectKnownCostCentreKeys(
    context.developmentId,
    context.knownCostCodes || []
  );
  const createUnknownCostCentres = Boolean(context.createUnknownCostCentres);
  const developmentScoped = context.developmentScoped !== false;

  const validRows = [];
  const errors = [];
  const rowWarnings = [];
  const globalWarnings = [];
  const pendingNewCostCentres = new Map();

  let totalValue = 0;
  let rowCount = 0;

  for (let index = 0; index < dataRows.length; index += 1) {
    const sheetRow = dataRows[index];
    if (isBlankRow(sheetRow)) continue;

    rowCount += 1;
    const rowNumber = headerRowIndex + index + 2;
    const mapped = buildMappedRow(sheetRow, fieldByColumn);
    const hardIssues = [];
    const softIssues = [];

    const csvDevelopmentId = String(mapped.developmentIdentifier || '').trim();
    const supplier = String(mapped.supplier || '').trim();
    const costCode = normaliseCostCode(mapped.costCode);
    const costCodeKey = normaliseCostCodeKey(costCode);
    const invoiceNumber = String(mapped.invoiceNumber || '').trim();
    const description = buildImportCostCentreDescription(mapped);
    const rawAmount = mapped.transactionAmount;
    const netAmount = parseMoneyCell(rawAmount);
    const vatAmount = parseMoneyCell(mapped.vat);
    const transactionDate = parseLedgerDate(mapped.transactionDate);

    if (developmentScoped && csvDevelopmentId && !developmentMatches(csvDevelopmentId, context)) {
      softIssues.push(WARNING_TYPES.DEVELOPMENT_MISMATCH);
      const warningMessage = buildDevelopmentMismatchWarning(csvDevelopmentId, context);
      if (!globalWarnings.includes(warningMessage)) {
        globalWarnings.push(warningMessage);
      }
    }

    if (!supplier) hardIssues.push(ERROR_TYPES.MISSING_SUPPLIER);

    if (!costCode || !costCodeKey) {
      hardIssues.push(ERROR_TYPES.MISSING_COST_CODE);
    } else if (!findMatchingCostCodeKey(costCode, knownCostCentreKeys)) {
      softIssues.push(WARNING_TYPES.NEW_COST_CODE);
      if (!pendingNewCostCentres.has(costCodeKey)) {
        pendingNewCostCentres.set(costCodeKey, {
          costCodeKey,
          costCode,
          description,
        });
      }
    }

    if (!String(mapped.transactionDate || '').trim()) {
      hardIssues.push(ERROR_TYPES.MISSING_DATE);
    } else if (!transactionDate) {
      hardIssues.push(ERROR_TYPES.INVALID_DATE);
    }

    if (rawAmount == null || String(rawAmount).trim() === '') {
      hardIssues.push(ERROR_TYPES.MISSING_AMOUNT);
    } else if (netAmount == null) {
      hardIssues.push(ERROR_TYPES.INVALID_AMOUNT);
    }

    if (hardIssues.length === 0 && netAmount != null) {
      const transactionKey = buildTransactionKey({
        supplier,
        invoiceNumber,
        transactionDate,
        netAmount,
        description: mapped.description,
      });

      const legacyInvoiceKey = invoiceNumber
        ? `${normaliseText(supplier)}::${normaliseText(invoiceNumber)}`
        : null;

      if (
        batchTransactionKeys.has(transactionKey) ||
        (legacyInvoiceKey && existingInvoices.has(legacyInvoiceKey))
      ) {
        hardIssues.push(ERROR_TYPES.DUPLICATE_TRANSACTION);
      } else {
        batchTransactionKeys.add(transactionKey);
      }
    }

    const entry = {
      rowNumber,
      developmentIdentifier: csvDevelopmentId,
      supplier,
      costCode,
      description: mapped.description,
      invoiceNumber,
      transactionAmount: mapped.transactionAmount,
      issues: hardIssues,
      warnings: softIssues,
    };

    if (hardIssues.length) {
      errors.push(entry);
      continue;
    }

    if (softIssues.length) {
      rowWarnings.push(entry);
    }

    const grossAmount =
      vatAmount != null && netAmount != null ? netAmount + vatAmount : null;

    validRows.push({
      rowNumber,
      developmentId: context.developmentId,
      supplier,
      supplierCode: String(mapped.supplierCode || '').trim(),
      costCode,
      costCodeKey,
      description: mapped.description || description,
      transactionDate,
      invoiceNumber,
      netAmount,
      vat: vatAmount,
      grossAmount,
      source: String(mapped.transactionSource || '').trim(),
      documentType: String(mapped.documentType || '').trim(),
      reference: String(mapped.reference || '').trim(),
      warnings: softIssues,
    });

    totalValue += netAmount;
  }

  const importedCount = validRows.length;
  const errorCount = errors.length;
  const warningCount = rowWarnings.length + globalWarnings.length;
  const pendingList = [...pendingNewCostCentres.values()];

  if (!rowCount) {
    globalWarnings.push('No data rows were found below the header row.');
  }

  return {
    rowCount,
    importedCount,
    warningCount,
    errorCount,
    newCostCentresPending: pendingList.length,
    totalValue: Math.round((totalValue + Number.EPSILON) * 100) / 100,
    validRows,
    errors,
    exceptions: errors,
    rowWarnings,
    warnings: globalWarnings,
    pendingNewCostCentres: pendingList,
    canImport: importedCount > 0,
    mappingComplete: true,
    createUnknownCostCentres,
  };
}

export function validateMappingComplete(fieldByColumn, headers) {
  const missing = getMissingRequiredFields(fieldByColumn, headers);
  return {
    ok: missing.length === 0,
    missing,
  };
}
