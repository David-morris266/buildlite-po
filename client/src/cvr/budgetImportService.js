/**
 * BL-013 — CVR budget import orchestration.
 */

import { parseCsvFile, extractHeaders, isBlankRow, isAcceptedCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile, parseExcelFile, sheetToRows } from '../payments/excelImport';
import { collectKnownCostCentreKeys } from '../ledger/ledgerCostCentreImport';
import { normaliseCostCodeKey, findMatchingCostCodeKey } from './cvrCalculations';
import {
  autoDetectBudgetColumnMapping,
  budgetMappingToFieldByColumn,
  buildBudgetImportPreview,
  buildBudgetMappedRow,
  detectBudgetHeaderRowIndex,
  getMissingBudgetFields,
} from './budgetImportFields';
import {
  addCostCentre,
  getCostCentreByKey,
  updateCostCentre,
} from './costCentreStore';
import { getEditablePeriodKey } from './cvrPeriodStore';
import { buildCostCentreLabel } from '../ledger/ledgerCostCentreImport';

export async function parseBudgetImportFile(file) {
  let rows = [];
  let fileName = file.name;

  if (isAcceptedCsvFile(file)) {
    rows = await parseCsvFile(file);
  } else if (isAcceptedExcelFile(file)) {
    const workbook = await parseExcelFile(file);
    const sheetName = workbook.SheetNames[0];
    rows = sheetToRows(workbook.Sheets[sheetName]);
  } else {
    throw new Error('Please upload a CSV or Excel (.xlsx) budget file.');
  }

  const headerRowIndex = detectBudgetHeaderRowIndex(rows);
  const headers = extractHeaders(rows[headerRowIndex] || []);
  const autoMapping = autoDetectBudgetColumnMapping(headers);
  const fieldByColumn = budgetMappingToFieldByColumn(headers, autoMapping);

  return {
    fileName,
    rows,
    headerRowIndex,
    headers,
    fieldByColumn,
  };
}

export function validateBudgetImport(parsed, context = {}) {
  const missingMappings = getMissingBudgetFields(parsed.fieldByColumn);
  const knownKeys = collectKnownCostCentreKeys(
    context.developmentId,
    context.knownCostCodes || []
  );

  const validRows = [];
  const errors = [];
  const rowWarnings = [];
  const pendingNewCostCodes = new Map();
  let totalOriginalBudget = 0;
  let totalCurrentBudget = 0;

  for (let index = 0; index < parsed.rows.slice(parsed.headerRowIndex + 1).length; index += 1) {
    const sheetRow = parsed.rows[parsed.headerRowIndex + 1 + index];
    if (isBlankRow(sheetRow)) continue;

    const rowNumber = parsed.headerRowIndex + index + 2;
    const mapped = buildBudgetMappedRow(sheetRow, parsed.fieldByColumn);
    const issues = [];
    const warnings = [];

    if (!mapped.costCode || !mapped.costCodeKey) {
      issues.push('Missing Company Cost Code');
    }

    if (mapped.originalBudget == null) {
      issues.push('Missing or invalid Original Budget');
    }

    if (mapped.currentBudget == null && mapped.originalBudget != null) {
      mapped.currentBudget = mapped.originalBudget;
    }

    if (
      mapped.costCodeKey &&
      !findMatchingCostCodeKey(mapped.costCodeKey, knownKeys) &&
      !pendingNewCostCodes.has(mapped.costCodeKey)
    ) {
      warnings.push('New Cost Code will be created');
      pendingNewCostCodes.set(mapped.costCodeKey, mapped);
    }

    const entry = {
      rowNumber,
      ...mapped,
      issues,
      warnings,
    };

    if (issues.length) {
      errors.push(entry);
      continue;
    }

    if (warnings.length) rowWarnings.push(entry);
    validRows.push(mapped);
    totalOriginalBudget += mapped.originalBudget || 0;
    totalCurrentBudget += mapped.currentBudget || 0;
  }

  return {
    mappingComplete: missingMappings.length === 0,
    missingMappings,
    validRows,
    errors,
    rowWarnings,
    pendingNewCostCodes: [...pendingNewCostCodes.values()],
    newCostCodesPending: pendingNewCostCodes.size,
    importedCount: validRows.length,
    errorCount: errors.length,
    warningCount: rowWarnings.length,
    totalOriginalBudget: Math.round((totalOriginalBudget + Number.EPSILON) * 100) / 100,
    totalCurrentBudget: Math.round((totalCurrentBudget + Number.EPSILON) * 100) / 100,
    canImport: missingMappings.length === 0 && validRows.length > 0,
  };
}

export function executeBudgetImport(
  developmentId,
  validationResult,
  { createUnknownCostCodes = true, periodKey } = {}
) {
  if (!validationResult?.canImport) {
    return { ok: false, errors: ['No valid budget rows to import.'] };
  }

  let created = 0;
  let updated = 0;
  const targetPeriodKey = periodKey || getEditablePeriodKey(developmentId);

  for (const row of validationResult.validRows) {
    const key = normaliseCostCodeKey(row.costCodeKey || row.costCode);
    const existing = getCostCentreByKey(developmentId, key, targetPeriodKey);
    const label = buildCostCentreLabel(row.costCode, row.description);
    const currentBudget = row.currentBudget ?? row.originalBudget;

    if (existing) {
      updateCostCentre(
        developmentId,
        existing.id,
        {
          costCodeLabel: label,
          description: row.description || existing.description || '',
          originalBudget: row.originalBudget,
          currentBudget,
        },
        targetPeriodKey
      );
      updated += 1;
      continue;
    }

    if (!createUnknownCostCodes) continue;

    const result = addCostCentre(
      developmentId,
      {
        costCodeKey: key,
        costCodeLabel: label,
        description: row.description || '',
        originalBudget: row.originalBudget,
        currentBudget,
      },
      targetPeriodKey
    );

    if (result.ok) created += 1;
  }

  return {
    ok: true,
    importedCount: validationResult.importedCount,
    created,
    updated,
    totalOriginalBudget: validationResult.totalOriginalBudget,
    totalCurrentBudget: validationResult.totalCurrentBudget,
  };
}

export { buildBudgetImportPreview };
