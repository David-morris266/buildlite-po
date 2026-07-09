/**
 * BL-013 — CVR budget import field definitions.
 */

import { parseMoneyCell } from '../payments/excelImport';
import { isBlankRow } from '../ledger/csvImport';
import { normaliseCostCodeKey } from './cvrCalculations';

export const BUDGET_IMPORT_FIELDS = {
  costCode: { label: 'Company Cost Code', required: true },
  description: { label: 'Description', required: false },
  originalBudget: { label: 'Original Budget', required: true },
  currentBudget: { label: 'Current Budget', required: false },
  ignore: { label: 'Ignore', required: false },
};

export const BUDGET_REQUIRED_FIELDS = Object.entries(BUDGET_IMPORT_FIELDS)
  .filter(([, meta]) => meta.required)
  .map(([key]) => key);

const HEADER_ALIASES = {
  costCode: [
    'cost code',
    'company cost code',
    'code',
    'cc',
    'element',
    'element code',
  ],
  description: ['description', 'desc', 'name', 'cost code description'],
  originalBudget: [
    'original budget',
    'budget',
    'original',
    'orig budget',
    'baseline budget',
  ],
  currentBudget: [
    'current budget',
    'revised budget',
    'current',
    'updated budget',
  ],
};

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function scoreBudgetHeaderRow(row) {
  const headers = (row || []).map(normaliseHeader).filter(Boolean);
  if (!headers.length) return 0;

  let score = headers.length;
  for (const aliases of Object.values(HEADER_ALIASES)) {
    if (headers.some((header) => aliases.some((alias) => header.includes(alias)))) {
      score += 3;
    }
  }
  return score;
}

export function detectBudgetHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 15);
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < scanLimit; index += 1) {
    const score = scoreBudgetHeaderRow(rows[index] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

export function autoDetectBudgetColumnMapping(headers) {
  const mapping = {};
  const used = new Set();

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = headers.findIndex((header, colIndex) => {
      if (used.has(colIndex)) return false;
      const text = normaliseHeader(header);
      return aliases.some((alias) => text === alias || text.includes(alias));
    });

    if (index >= 0) {
      mapping[field] = index;
      used.add(index);
    }
  }

  return mapping;
}

export function budgetMappingToFieldByColumn(headers, mapping) {
  const fieldByColumn = headers.map(() => 'ignore');
  for (const [field, colIndex] of Object.entries(mapping)) {
    if (colIndex >= 0 && colIndex < fieldByColumn.length) {
      fieldByColumn[colIndex] = field;
    }
  }
  return fieldByColumn;
}

export function getMissingBudgetFields(fieldByColumn) {
  return BUDGET_REQUIRED_FIELDS.filter((field) => !fieldByColumn.includes(field));
}

export function buildBudgetMappedRow(row, fieldByColumn) {
  const get = (field) => {
    const index = fieldByColumn.indexOf(field);
    return index >= 0 ? row[index] : '';
  };

  const costCode = String(get('costCode') || '').trim();
  const description = String(get('description') || '').trim();
  const originalBudget = parseMoneyCell(get('originalBudget'));
  const currentBudgetRaw = get('currentBudget');
  const currentBudget =
    String(currentBudgetRaw || '').trim() === ''
      ? originalBudget
      : parseMoneyCell(currentBudgetRaw);

  return {
    costCode,
    costCodeKey: normaliseCostCodeKey(costCode),
    description,
    originalBudget,
    currentBudget,
  };
}

export function buildBudgetImportPreview(rows, headerRowIndex, fieldByColumn, limit = 5) {
  const preview = [];

  for (const row of rows.slice(headerRowIndex + 1)) {
    if (preview.length >= limit) break;
    if (isBlankRow(row)) continue;

    const mapped = buildBudgetMappedRow(row, fieldByColumn);
    if (!mapped.costCode) continue;
    preview.push(mapped);
  }

  return preview;
}
