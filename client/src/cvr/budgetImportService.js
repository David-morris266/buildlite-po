/**
 * BL-013 / BL-037B — CVR budget import orchestration.
 *
 * Client mapping/preview remain. Authoritative membership and budget writes
 * go through the BL-037B server command when CVR server authority is ON.
 * Unknown or inactive Master codes fail closed. Duplicate file codes fail closed.
 * Arbitrary CVR headings are not created.
 */

import { parseCsvFile, extractHeaders, isBlankRow, isAcceptedCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile, parseExcelFile, sheetToRows } from '../payments/excelImport';
import { expandCostCodeKeys, findMatchingCostCodeKey, normaliseCostCodeKey } from './cvrCalculations';
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
import { importBudgetOnServer } from './cvrPeriodAuthorityWrites';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import { getEditablePeriodKey } from './cvrPeriodStore';

function masterKeySet(knownCostCodes = []) {
  const keys = new Set();
  for (const key of knownCostCodes) {
    for (const variant of expandCostCodeKeys(key)) {
      if (variant) keys.add(variant);
    }
  }
  return keys;
}

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
  const knownKeys = masterKeySet(context.knownCostCodes || []);

  const validRows = [];
  const errors = [];
  const unknownCodes = [];
  const duplicateCodes = [];
  const seen = new Map();
  let totalOriginalBudget = 0;
  let totalCurrentBudget = 0;

  for (let index = 0; index < parsed.rows.slice(parsed.headerRowIndex + 1).length; index += 1) {
    const sheetRow = parsed.rows[parsed.headerRowIndex + 1 + index];
    if (isBlankRow(sheetRow)) continue;

    const rowNumber = parsed.headerRowIndex + index + 2;
    const mapped = buildBudgetMappedRow(sheetRow, parsed.fieldByColumn);
    const issues = [];

    if (!mapped.costCode || !mapped.costCodeKey) {
      issues.push('Missing Company Cost Code');
    }

    if (mapped.originalBudget == null) {
      issues.push('Missing or invalid Original Budget');
    }

    if (mapped.currentBudget == null && mapped.originalBudget != null) {
      mapped.currentBudget = mapped.originalBudget;
    }

    if (mapped.costCodeKey && seen.has(mapped.costCodeKey)) {
      issues.push('Duplicate cost code in this file');
      duplicateCodes.push({
        costCodeKey: mapped.costCodeKey,
        rowNumbers: [seen.get(mapped.costCodeKey), rowNumber],
      });
    } else if (mapped.costCodeKey) {
      seen.set(mapped.costCodeKey, rowNumber);
    }

    if (mapped.costCodeKey && !findMatchingCostCodeKey(mapped.costCodeKey, knownKeys)) {
      issues.push('Not available in Cost Code Master');
      unknownCodes.push({
        costCodeKey: mapped.costCode || mapped.costCodeKey,
        description: mapped.description || '',
        rowNumber,
      });
    }

    const entry = {
      rowNumber,
      ...mapped,
      issues,
      warnings: [],
    };

    if (issues.length) {
      errors.push(entry);
      continue;
    }

    validRows.push(mapped);
    totalOriginalBudget += mapped.originalBudget || 0;
    totalCurrentBudget += mapped.currentBudget || 0;
  }

  const masterBlocked = unknownCodes.length > 0 || duplicateCodes.length > 0;
  return {
    mappingComplete: missingMappings.length === 0,
    missingMappings,
    validRows,
    errors,
    rowWarnings: [],
    pendingNewCostCodes: [],
    unknownCodes,
    duplicateCodes,
    newCostCodesPending: 0,
    importedCount: validRows.length,
    errorCount: errors.length,
    warningCount: 0,
    totalOriginalBudget: Math.round((totalOriginalBudget + Number.EPSILON) * 100) / 100,
    totalCurrentBudget: Math.round((totalCurrentBudget + Number.EPSILON) * 100) / 100,
    canImport:
      missingMappings.length === 0 && validRows.length > 0 && !masterBlocked && errors.length === 0,
  };
}

export function formatBudgetImportMasterError(unknownCodes = []) {
  if (!unknownCodes.length) return '';
  const lines = unknownCodes.map((item) => {
    const description = String(item.description || '').trim();
    return description ? `${item.costCodeKey} — ${description}` : item.costCodeKey;
  });
  return [
    'Budget cannot be imported.',
    'The following cost codes are not available in your Cost Code Master:',
    ...lines,
    'Add or map these codes in Cost Code Master and retry.',
  ].join('\n');
}

export async function executeBudgetImport(
  developmentId,
  validationResult,
  { periodKey, actor } = {}
) {
  if (!validationResult?.canImport) {
    return {
      ok: false,
      errors: [
        formatBudgetImportMasterError(validationResult?.unknownCodes) ||
          'No valid budget rows to import.',
      ],
    };
  }

  const targetPeriodKey = periodKey || getEditablePeriodKey(developmentId);
  const rows = validationResult.validRows.map((row) => ({
    costCodeKey: row.costCodeKey || row.costCode,
    originalBudget: row.originalBudget,
    currentBudget: row.currentBudget ?? row.originalBudget,
  }));

  if (isCvrServerAuthorityEnabled()) {
    return importBudgetOnServer(developmentId, targetPeriodKey, rows, actor);
  }

  let created = 0;
  let updated = 0;
  for (const row of validationResult.validRows) {
    const key = normaliseCostCodeKey(row.costCodeKey || row.costCode);
    const existing = getCostCentreByKey(developmentId, key, targetPeriodKey);
    const currentBudget = row.currentBudget ?? row.originalBudget;
    if (existing) {
      updateCostCentre(
        developmentId,
        existing.id,
        {
          originalBudget: row.originalBudget,
          currentBudget,
        },
        targetPeriodKey
      );
      updated += 1;
      continue;
    }
    const result = addCostCentre(
      developmentId,
      {
        costCodeKey: key,
        costCodeLabel: row.costCode || key,
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
