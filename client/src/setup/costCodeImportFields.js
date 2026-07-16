/**
 * BL-016F — Setup cost code import field metadata.
 */

import { extractHeaders } from '../ledger/csvImport';

export const COST_CODE_IMPORT_FIELDS = {
  costCode: { label: 'Cost Code', required: true },
  description: { label: 'Description', required: true },
  commercialHead: { label: 'Commercial Head', required: false },
  commercialFamily: { label: 'Commercial Family', required: false },
  trade: { label: 'Reporting Group', required: false },
  reportingGroup: { label: 'Reporting Group', required: false },
  defaultOrderType: { label: 'Order Type', required: false },
  defaultVatTreatment: { label: 'VAT', required: false },
  reportingOrder: { label: 'Reporting Order', required: false },
  active: { label: 'Active', required: false },
  ignore: { label: 'Ignore', required: false },
};

export const COST_CODE_IMPORT_FIELD_ORDER = [
  'costCode',
  'description',
  'commercialHead',
  'commercialFamily',
  'trade',
  'reportingGroup',
  'defaultOrderType',
  'defaultVatTreatment',
  'reportingOrder',
  'active',
  'ignore',
];

const HEADER_ALIASES = {
  costCode: ['cost code', 'code', 'cost centre', 'cost center', 'cc', 'company cost code'],
  description: ['description', 'desc', 'item', 'name', 'cost description'],
  commercialHead: [
    'cost group',
    'commercial head',
    'commercial group',
    'category',
    'head',
    'reporting head',
    'group',
  ],
  commercialFamily: ['commercial family', 'family', 'sub heading', 'subheading', 'sub group', 'subgroup'],
  trade: [
    'cost type',
    'reporting group',
    'trade / reporting group',
    'trade',
    'element',
    'package',
    'discipline',
    'type',
  ],
  reportingGroup: ['reporting group', 'cost type', 'trade / reporting group', 'group type'],
  defaultOrderType: ['order type', 'po type'],
  defaultVatTreatment: ['vat', 'vat treatment', 'tax'],
  reportingOrder: ['reporting order', 'sort order', 'sequence'],
  active: ['active', 'status', 'enabled'],
};

function scoreHeaderAliasMatch(header, alias) {
  const normalisedAlias = normaliseHeader(alias);
  if (!header || !normalisedAlias) return 0;
  if (header === normalisedAlias) return 100 + normalisedAlias.length;
  if (header.startsWith(`${normalisedAlias} `) || header.endsWith(` ${normalisedAlias}`)) {
    return 90 + normalisedAlias.length;
  }
  if (header.includes(normalisedAlias)) {
    return 60 + normalisedAlias.length;
  }
  return 0;
}

export function normaliseHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function autoDetectCostCodeColumnMapping(headers = []) {
  const candidates = [];

  for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
    const header = normaliseHeader(headers[columnIndex]);
    if (!header) continue;

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const score = aliases.reduce(
        (best, alias) => Math.max(best, scoreHeaderAliasMatch(header, alias)),
        0
      );
      if (score > 0) {
        candidates.push({ columnIndex, field, score });
      }
    }
  }

  candidates.sort((left, right) => right.score - left.score);

  const mapping = {};
  const usedColumns = new Set();
  const usedFields = new Set();

  for (const candidate of candidates) {
    if (usedColumns.has(candidate.columnIndex) || usedFields.has(candidate.field)) continue;
    mapping[candidate.field] = candidate.columnIndex;
    usedColumns.add(candidate.columnIndex);
    usedFields.add(candidate.field);
  }

  return mapping;
}

export function costCodeMappingToFieldByColumn(headers = [], mapping = {}) {
  return headers.map((_, columnIndex) => {
    const match = Object.entries(mapping).find(([, index]) => index === columnIndex);
    return match ? match[0] : 'ignore';
  });
}

export function getMissingCostCodeFields(fieldByColumn = []) {
  const mapped = new Set(fieldByColumn.filter((field) => field && field !== 'ignore'));
  const missing = [];
  for (const [field, meta] of Object.entries(COST_CODE_IMPORT_FIELDS)) {
    if (meta.required && field !== 'ignore' && !mapped.has(field)) {
      missing.push(meta.label);
    }
  }
  return missing;
}

export function detectCostCodeHeaderRowIndex(rows = []) {
  for (let index = 0; index < Math.min(rows.length, 20); index += 1) {
    const row = rows[index] || [];
    const headers = row.map((cell) => normaliseHeader(cell));
    const hits = headers.filter((header) =>
      Object.values(HEADER_ALIASES).flat().some((alias) => header.includes(alias))
    );
    if (hits.length >= 2) return index;
  }
  return 0;
}

function cellValue(row, columnIndex) {
  if (columnIndex == null || columnIndex < 0) return '';
  return String(row[columnIndex] ?? '').trim();
}

export function buildCostCodeMappedRow(row, fieldByColumn = []) {
  const mapped = {};
  fieldByColumn.forEach((field, columnIndex) => {
    if (!field || field === 'ignore') return;
    mapped[field] = cellValue(row, columnIndex);
  });
  const reportingGroup = String(mapped.reportingGroup || mapped.trade || '').trim();
  if (reportingGroup) {
    mapped.reportingGroup = reportingGroup;
    mapped.trade = reportingGroup;
  }
  return mapped;
}

export function buildCostCodeImportPreview(rows, headerRowIndex, fieldByColumn, limit = 5) {
  const bodyRows = rows.slice(headerRowIndex + 1, headerRowIndex + 1 + limit);
  return bodyRows.map((row, index) => ({
    rowNumber: headerRowIndex + index + 2,
    ...buildCostCodeMappedRow(row, fieldByColumn),
  }));
}

export function buildCostCodeSourceColumnPreview(rows, headerRowIndex, limit = 8) {
  const headers = extractHeaders(rows[headerRowIndex] || []);
  const bodyRows = rows.slice(headerRowIndex + 1, headerRowIndex + 1 + limit);

  return {
    headers,
    rows: bodyRows.map((row, index) => ({
      rowNumber: headerRowIndex + index + 2,
      cells: headers.map((_, columnIndex) => String(row[columnIndex] ?? '').trim()),
    })),
  };
}
