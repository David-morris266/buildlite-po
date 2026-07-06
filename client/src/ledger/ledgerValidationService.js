/**
 * BL-012A — Purchase Ledger import validation (Doc 38–40).
 */

import { parseMoneyCell } from '../payments/excelImport';
import { isBlankRow } from './csvImport';
import { buildMappedRow } from './ledgerImportFields';
import { getExistingInvoiceKeys } from './ledgerTransactionStore';

export const EXCEPTION_TYPES = {
  MISSING_DEVELOPMENT: 'Missing Development',
  UNKNOWN_DEVELOPMENT: 'Unknown Development',
  MISSING_SUPPLIER: 'Missing Supplier',
  MISSING_AMOUNT: 'Missing Amount',
  UNKNOWN_COST_CODE: 'Unknown Cost Code',
  UNKNOWN_COST_CENTRE: 'Unknown Cost Centre',
  DUPLICATE_INVOICE: 'Duplicate Invoice',
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
  if (!value) return false;

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

function normaliseCostCode(value) {
  return String(value || '').trim();
}

function extractCostCodeKey(value) {
  const raw = normaliseCostCode(value);
  if (!raw) return '';
  const codePart = raw.split('—')[0].split(' - ')[0].trim();
  return codePart.toLowerCase();
}

export function validateLedgerImport(rows, headerRowIndex, fieldByColumn, context = {}) {
  const dataRows = rows.slice(headerRowIndex + 1);
  const existingInvoices = getExistingInvoiceKeys(context.developmentId);
  const batchInvoiceKeys = new Set();

  const validRows = [];
  const exceptions = [];
  const warnings = [];

  let totalValue = 0;
  let rowCount = 0;

  for (let index = 0; index < dataRows.length; index += 1) {
    const sheetRow = dataRows[index];
    if (isBlankRow(sheetRow)) continue;

    rowCount += 1;
    const rowNumber = headerRowIndex + index + 2;
    const mapped = buildMappedRow(sheetRow, fieldByColumn);
    const issues = [];

    const developmentId = String(mapped.developmentIdentifier || '').trim();
    const supplier = String(mapped.supplier || '').trim();
    const costCode = normaliseCostCode(mapped.costCode);
    const costCodeKey = extractCostCodeKey(costCode);
    const invoiceNumber = String(mapped.invoiceNumber || '').trim();
    const description = String(mapped.description || '').trim();
    const netAmount = parseMoneyCell(mapped.transactionAmount);
    const vatAmount = parseMoneyCell(mapped.vat);
    const transactionDate = parseLedgerDate(mapped.transactionDate);

    if (!developmentId) {
      issues.push(EXCEPTION_TYPES.MISSING_DEVELOPMENT);
    } else if (!developmentMatches(developmentId, context)) {
      issues.push(EXCEPTION_TYPES.UNKNOWN_DEVELOPMENT);
    }

    if (!supplier) issues.push(EXCEPTION_TYPES.MISSING_SUPPLIER);
    if (netAmount == null || netAmount === 0) issues.push(EXCEPTION_TYPES.MISSING_AMOUNT);

    if (!costCode) {
      issues.push(EXCEPTION_TYPES.UNKNOWN_COST_CENTRE);
    } else if (
      context.knownCostCodes?.length &&
      !context.knownCostCodes.includes(costCodeKey)
    ) {
      issues.push(EXCEPTION_TYPES.UNKNOWN_COST_CODE);
    }

    const invoiceKey = `${normaliseText(supplier)}::${normaliseText(invoiceNumber)}`;
    if (invoiceNumber) {
      if (existingInvoices.has(invoiceKey) || batchInvoiceKeys.has(invoiceKey)) {
        issues.push(EXCEPTION_TYPES.DUPLICATE_INVOICE);
      } else {
        batchInvoiceKeys.add(invoiceKey);
      }
    }

    const exceptionEntry = {
      rowNumber,
      developmentIdentifier: developmentId,
      supplier,
      costCode,
      description,
      invoiceNumber,
      transactionAmount: mapped.transactionAmount,
      issues,
    };

    if (issues.length) {
      exceptions.push(exceptionEntry);
      continue;
    }

    const grossAmount =
      vatAmount != null ? netAmount + vatAmount : mapped.grossAmount || null;

    validRows.push({
      rowNumber,
      developmentId: context.developmentId,
      supplier,
      supplierCode: String(mapped.supplierCode || '').trim(),
      costCode,
      description,
      transactionDate,
      invoiceNumber,
      netAmount,
      vat: vatAmount,
      grossAmount,
      source: String(mapped.transactionSource || '').trim(),
      documentType: String(mapped.documentType || '').trim(),
      reference: String(mapped.reference || '').trim(),
    });

    totalValue += netAmount;
  }

  const importedCount = validRows.length;
  const errorCount = exceptions.length;

  if (!rowCount) {
    warnings.push('No data rows were found below the header row.');
  }

  return {
    rowCount,
    importedCount,
    warningCount: warnings.length,
    errorCount,
    totalValue: Math.round((totalValue + Number.EPSILON) * 100) / 100,
    validRows,
    exceptions,
    warnings,
    canImport: importedCount > 0,
    mappingComplete: true,
  };
}

export function validateMappingComplete(fieldByColumn) {
  const required = [
    'developmentIdentifier',
    'costCode',
    'supplier',
    'transactionDate',
    'transactionAmount',
    'description',
    'invoiceNumber',
  ];
  const missing = required.filter((field) => !fieldByColumn.includes(field));
  return {
    ok: missing.length === 0,
    missing,
  };
}
