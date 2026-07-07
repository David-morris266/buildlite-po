/**
 * BL-012A — Purchase Ledger column mapping definitions (Doc 38–40).
 */

import { mappingToFieldByColumn } from '../payments/excelImport';
import { isBlankRow } from './csvImport';

export const LEDGER_IMPORT_FIELDS = {
  developmentIdentifier: {
    label: 'Development Identifier',
    required: false,
  },
  costCode: { label: 'Cost Code', required: true },
  supplier: { label: 'Supplier', required: true },
  transactionDate: { label: 'Transaction Date', required: true },
  transactionAmount: { label: 'Transaction Amount', required: true },
  description: { label: 'Description', required: true },
  invoiceNumber: { label: 'Invoice Number', required: false },
  vat: { label: 'VAT', required: false },
  reference: { label: 'Reference', required: false },
  documentType: { label: 'Document Type', required: false },
  transactionSource: { label: 'Transaction Source', required: false },
  period: { label: 'Period', required: false },
  year: { label: 'Year', required: false },
  activity: { label: 'Activity', required: false },
  userReference: { label: 'User Reference', required: false },
  supplierCode: { label: 'Supplier Code', required: false },
  ignore: { label: 'Ignore', required: false },
};

export const LEDGER_REQUIRED_FIELDS = Object.entries(LEDGER_IMPORT_FIELDS)
  .filter(([, meta]) => meta.required)
  .map(([key]) => key);

const LEDGER_HEADER_ALIASES = {
  developmentIdentifier: [
    'development',
    'development id',
    'development identifier',
    'job',
    'job no',
    'job number',
    'job code',
    'site',
    'site code',
    'project',
    'project code',
    'contract',
    'contract code',
  ],
  costCode: [
    'cost code',
    'cost centre',
    'cost center',
    'cc',
    'code',
    'commercial code',
    'element code',
  ],
  supplier: [
    'supplier',
    'supplier name',
    'subcontractor',
    'vendor',
    'creditor',
    'payee',
    'account name',
  ],
  transactionDate: [
    'date',
    'transaction date',
    'invoice date',
    'posting date',
    'doc date',
    'document date',
  ],
  transactionAmount: [
    'amount',
    'net',
    'net amount',
    'value',
    'transaction amount',
    'invoice amount',
    'total',
    'line value',
    'debit',
    'credit',
  ],
  description: [
    'description',
    'desc',
    'narrative',
    'details',
    'particulars',
    'memo',
    'comment',
  ],
  invoiceNumber: [
    'invoice',
    'invoice no',
    'invoice number',
    'invoice #',
    'inv no',
    'document no',
    'document number',
    'ref no',
  ],
  vat: ['vat', 'tax', 'vat amount', 'sales tax'],
  reference: ['reference', 'ref', 'external ref', 'your ref'],
  documentType: ['document type', 'doc type', 'type', 'transaction type'],
  transactionSource: ['source', 'transaction source', 'origin', 'module'],
  period: ['period', 'accounting period', 'month'],
  year: ['year', 'financial year', 'fy'],
  activity: ['activity', 'work package', 'trade'],
  userReference: ['user reference', 'user ref', 'entered by'],
  supplierCode: [
    'supplier code',
    'creditor code',
    'vendor code',
    'account code',
    'supplier ref',
  ],
};

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function scoreLedgerHeaderRow(row) {
  const headers = (row || []).map(normaliseHeader).filter(Boolean);
  if (!headers.length) return 0;

  let score = headers.length;
  for (const aliases of Object.values(LEDGER_HEADER_ALIASES)) {
    if (headers.some((header) => aliases.some((alias) => header === alias || header.includes(alias)))) {
      score += 4;
    }
  }
  return score;
}

export function detectLedgerHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 20);
  let bestIndex = 0;
  let bestScore = -1;
  let secondBestScore = -1;

  for (let i = 0; i < scanLimit; i += 1) {
    const score = scoreLedgerHeaderRow(rows[i] || []);
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestIndex = i;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  const uncertain = bestScore > 0 && secondBestScore >= bestScore - 3;
  return { index: bestIndex, uncertain };
}

export function autoDetectLedgerColumnMapping(headers) {
  const mapping = {};
  const used = new Set();

  for (const [field, aliases] of Object.entries(LEDGER_HEADER_ALIASES)) {
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

export function ledgerMappingToFieldByColumn(headers, mapping) {
  return mappingToFieldByColumn(headers, mapping);
}

export function fieldByColumnToMapping(fieldByColumn) {
  const mapping = {};
  fieldByColumn.forEach((field, index) => {
    if (field && field !== 'ignore') {
      mapping[field] = index;
    }
  });
  return mapping;
}

export function applyProfileMappingToHeaders(headers, profileMapping) {
  const mapping = {};
  const normalisedHeaders = headers.map(normaliseHeader);

  for (const [field, headerName] of Object.entries(profileMapping || {})) {
    const target = normaliseHeader(headerName);
    const index = normalisedHeaders.findIndex(
      (header) => header === target || header.includes(target)
    );
    if (index >= 0) {
      mapping[field] = index;
    }
  }

  return ledgerMappingToFieldByColumn(headers, mapping);
}

export function getLedgerDetectedColumnsSummary(fieldByColumn, headers) {
  return fieldByColumn
    .map((field, index) => {
      if (!field || field === 'ignore') return null;
      const meta = LEDGER_IMPORT_FIELDS[field];
      return {
        field,
        label: meta?.label || field,
        header: headers[index] || `Column ${index + 1}`,
      };
    })
    .filter(Boolean);
}

export function alignFieldByColumnToHeaders(headers, fieldByColumn = []) {
  return (headers || []).map((_, index) => fieldByColumn[index] || 'ignore');
}

export function getMissingRequiredFields(fieldByColumn, headers) {
  const aligned = headers?.length
    ? alignFieldByColumnToHeaders(headers, fieldByColumn)
    : [...(fieldByColumn || [])];

  return LEDGER_REQUIRED_FIELDS.filter((field) => !aligned.includes(field));
}

export function formatMissingRequiredFieldsMessage(missing) {
  if (!missing?.length) return '';

  const labels = missing.map(
    (field) => LEDGER_IMPORT_FIELDS[field]?.label || field
  );

  return `Map the following required columns before continuing: ${labels.join(', ')}.`;
}

export function buildLedgerImportPreview(rows, headerRowIndex, fieldByColumn, limit = 5) {
  const preview = [];
  const dataRows = rows.slice(headerRowIndex + 1);

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    if (preview.length >= limit) break;
    const row = dataRows[rowIndex];
    if (isBlankRow(row)) continue;
    preview.push({
      rowNumber: headerRowIndex + rowIndex + 2,
      ...buildMappedRow(row, fieldByColumn),
    });
  }

  return preview;
}

export function buildMappedRow(row, fieldByColumn) {
  const get = (field) => {
    const index = fieldByColumn.indexOf(field);
    return index >= 0 ? row[index] : '';
  };

  return {
    developmentIdentifier: String(get('developmentIdentifier') || '').trim(),
    costCode: String(get('costCode') || '').trim(),
    supplier: String(get('supplier') || '').trim(),
    transactionDate: String(get('transactionDate') || '').trim(),
    transactionAmount: String(get('transactionAmount') || '').trim(),
    description: String(get('description') || '').trim(),
    invoiceNumber: String(get('invoiceNumber') || '').trim(),
    vat: String(get('vat') || '').trim(),
    reference: String(get('reference') || '').trim(),
    documentType: String(get('documentType') || '').trim(),
    transactionSource: String(get('transactionSource') || '').trim(),
    supplierCode: String(get('supplierCode') || '').trim(),
    activity: String(get('activity') || '').trim(),
  };
}
