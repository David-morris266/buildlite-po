/**
 * BL-009A.02 — Plot Schedule Excel import (Doc 34).
 */

import {
  detectHeaderRowIndex,
  extractHeaders,
  mappingToFieldByColumn,
  parseExcelFile,
  sheetToRows,
  getWorksheetSummaries,
  isAcceptedExcelFile,
} from '../payments/excelImport';

export const PLOT_IMPORT_FIELDS = {
  plotNumber: { label: 'Plot Number', required: true },
  houseType: { label: 'House Type', required: true },
  bedrooms: { label: 'Bedrooms', required: false },
  gia: { label: 'GIA', required: false },
  phase: { label: 'Phase', required: false },
  tenure: { label: 'Tenure', required: false },
  status: { label: 'Status', required: false },
  ignore: { label: 'Ignore', required: false },
};

const PLOT_HEADER_ALIASES = {
  plotNumber: ['plot', 'plot no', 'plot no.', 'plot number', 'plot #', 'unit'],
  houseType: ['house type', 'type', 'dwelling type', 'product', 'design'],
  bedrooms: ['beds', 'bedrooms', 'bed', 'no beds', 'no. beds'],
  gia: ['gia', 'g.i.a', 'floor area', 'sqm', 'sq m', 'internal area'],
  phase: ['phase', 'stage', 'release'],
  tenure: ['tenure', 'ownership', 'sale type'],
  status: ['status', 'plot status'],
};

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isBlankRow(values) {
  return values.every((cell) => !String(cell || '').trim());
}

function parseIntegerCell(value) {
  if (value == null || value === '') return null;
  const n = Number.parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function parseAreaCell(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function autoDetectPlotColumnMapping(headers) {
  const mapping = {};
  const used = new Set();

  for (const [field, aliases] of Object.entries(PLOT_HEADER_ALIASES)) {
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

export function plotMappingToFieldByColumn(headers, mapping) {
  return mappingToFieldByColumn(headers, mapping);
}

export {
  detectHeaderRowIndex,
  extractHeaders,
  parseExcelFile,
  sheetToRows,
  getWorksheetSummaries,
  isAcceptedExcelFile,
};

export function buildPlotImportPreview(rows, headerRowIndex, fieldByColumn, limit = 5) {
  const preview = [];
  const dataRows = rows.slice(headerRowIndex + 1);

  for (const row of dataRows) {
    if (preview.length >= limit) break;
    if (isBlankRow(row)) continue;

    preview.push(buildPlotRowFromSheetRow(row, fieldByColumn));
  }

  return preview;
}

function buildPlotRowFromSheetRow(row, fieldByColumn) {
  const get = (field) => {
    const index = fieldByColumn.indexOf(field);
    return index >= 0 ? row[index] : '';
  };

  return {
    plotNumber: String(get('plotNumber') || '').trim(),
    houseType: String(get('houseType') || '').trim(),
    bedrooms: parseIntegerCell(get('bedrooms')),
    gia: parseAreaCell(get('gia')),
    phase: String(get('phase') || '').trim(),
    tenure: String(get('tenure') || '').trim(),
    status: String(get('status') || '').trim(),
  };
}

export function validateAndBuildPlotImport(rows, headerRowIndex, fieldByColumn) {
  const errors = [];
  const rowErrors = [];
  const plots = [];
  const plotNumbersSeen = new Map();
  let blankRowsIgnored = 0;

  const plotNumberIndex = fieldByColumn.indexOf('plotNumber');
  const houseTypeIndex = fieldByColumn.indexOf('houseType');

  if (plotNumberIndex < 0) {
    errors.push('Choose which column contains the Plot Number.');
  }
  if (houseTypeIndex < 0) {
    errors.push('Choose which column contains the House Type.');
  }

  if (errors.length) {
    return {
      plots: [],
      errors,
      rowErrors,
      detectedCount: 0,
      validCount: 0,
      errorCount: 0,
      blankRowsIgnored: 0,
      ready: false,
    };
  }

  const dataRows = rows.slice(headerRowIndex + 1);

  dataRows.forEach((row, offset) => {
    if (isBlankRow(row)) {
      blankRowsIgnored += 1;
      return;
    }

    const plot = buildPlotRowFromSheetRow(row, fieldByColumn);
    const issues = [];
    const rowLabel = `Row ${headerRowIndex + offset + 2}`;

    if (!plot.plotNumber) {
      issues.push('Blank Plot Number');
    }
    if (!plot.houseType) {
      issues.push('Missing House Type');
    }

    const key = plot.plotNumber.toLowerCase();
    if (plot.plotNumber) {
      if (plotNumbersSeen.has(key)) {
        issues.push(`Duplicate Plot Number "${plot.plotNumber}"`);
      } else {
        plotNumbersSeen.set(key, true);
      }
    }

    if (issues.length) {
      rowErrors.push({ rowLabel, issues });
    } else {
      plots.push(plot);
    }
  });

  const detectedCount = plots.length + rowErrors.length;
  const validCount = plots.length;
  const errorCount = rowErrors.length;

  const infoMessages = [];
  if (blankRowsIgnored > 0) {
    infoMessages.push({
      rowLabel: 'Spreadsheet',
      issues: [`${blankRowsIgnored} blank row${blankRowsIgnored === 1 ? '' : 's'} ignored`],
    });
  }

  return {
    plots,
    errors,
    rowErrors,
    infoMessages,
    detectedCount,
    validCount,
    errorCount,
    blankRowsIgnored,
    ready: errorCount === 0 && validCount > 0,
  };
}

export function getPlotDetectedColumnsSummary(fieldByColumn, headers) {
  const detected = [];
  fieldByColumn.forEach((field, index) => {
    if (field === 'ignore') return;
    detected.push({
      field,
      label: PLOT_IMPORT_FIELDS[field]?.label || field,
      header: headers[index],
    });
  });
  return detected;
}
