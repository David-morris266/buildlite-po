/**
 * BL-012A — Purchase Ledger import orchestration service.
 */

import { parseCsvFile, extractHeaders } from './csvImport';
import {
  autoDetectLedgerColumnMapping,
  detectLedgerHeaderRowIndex,
  ledgerMappingToFieldByColumn,
} from './ledgerImportFields';
import { validateLedgerImport, validateMappingComplete } from './ledgerValidationService';
import {
  appendImportHistory,
  appendTransactions,
  createTransaction,
} from './ledgerTransactionStore';

function sessionActor() {
  return (
    localStorage.getItem('userName') ||
    localStorage.getItem('userEmail') ||
    'Commercial Manager'
  );
}

function newBatchId() {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function parseLedgerCsvFile(file) {
  const rows = await parseCsvFile(file);
  const headerDetection = detectLedgerHeaderRowIndex(rows);
  const headerRowIndex = headerDetection.index;
  const headers = extractHeaders(rows[headerRowIndex] || []);
  const autoMapping = autoDetectLedgerColumnMapping(headers);
  const fieldByColumn = ledgerMappingToFieldByColumn(headers, autoMapping);

  return {
    fileName: file.name,
    rows,
    headerRowIndex,
    headerUncertain: headerDetection.uncertain,
    headers,
    fieldByColumn,
  };
}

export function buildLedgerValidationResult(parsed, context) {
  const mappingCheck = validateMappingComplete(parsed.fieldByColumn);
  if (!mappingCheck.ok) {
    return {
      ...validateLedgerImport(parsed.rows, parsed.headerRowIndex, parsed.fieldByColumn, context),
      mappingComplete: false,
      missingMappings: mappingCheck.missing,
      canImport: false,
    };
  }

  return validateLedgerImport(
    parsed.rows,
    parsed.headerRowIndex,
    parsed.fieldByColumn,
    context
  );
}

export function executeLedgerImport(developmentId, validationResult, metadata = {}) {
  if (!validationResult?.canImport || !validationResult.validRows?.length) {
    return { ok: false, errors: ['No valid rows to import.'] };
  }

  const importBatch = newBatchId();
  const actor = sessionActor();
  const transactions = validationResult.validRows.map((row) =>
    createTransaction({
      developmentId,
      supplier: row.supplier,
      supplierCode: row.supplierCode,
      costCode: row.costCode,
      description: row.description,
      transactionDate: row.transactionDate,
      invoiceNumber: row.invoiceNumber,
      netAmount: row.netAmount,
      vat: row.vat,
      grossAmount: row.grossAmount,
      source: row.source || metadata.importProfile || 'CSV Import',
      documentType: row.documentType,
      reference: row.reference,
      importBatch,
      importedBy: actor,
    })
  );

  appendTransactions(developmentId, transactions);

  appendImportHistory(developmentId, {
    importDate: new Date().toISOString(),
    importedBy: actor,
    rowsImported: validationResult.importedCount,
    rowsRejected: validationResult.errorCount,
    totalValue: validationResult.totalValue,
    fileName: metadata.fileName || '',
    importProfile: metadata.importProfile || 'Custom',
    importBatch,
  });

  return {
    ok: true,
    importBatch,
    importedCount: validationResult.importedCount,
    rejectedCount: validationResult.errorCount,
    totalValue: validationResult.totalValue,
  };
}
