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
import { classifyImportedTenure } from './plotTenureAuthority';

export const PLOT_IMPORT_FIELDS = {
  plotNumber: { label: 'Plot Number', required: true },
  houseType: { label: 'House Type', required: true },
  configuration: { label: 'Configuration', required: false },
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
  configuration: [
    'configuration',
    'config',
    'dwelling configuration',
    'house configuration',
    'plot configuration',
    'property type',
  ],
  bedrooms: ['beds', 'bedrooms', 'bed', 'no beds', 'no. beds'],
  gia: ['gia', 'g.i.a', 'floor area', 'ft2', 'ft²', 'sq ft', 'sq. ft', 'sqm', 'sq m', 'internal area'],
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
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : null;
}

function parseAreaCell(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text.replaceAll(',', ''));
  return Number.isFinite(n) && n > 0 ? n : null;
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
    configuration: String(get('configuration') || '').trim(),
    bedrooms: parseIntegerCell(get('bedrooms')),
    gia: parseAreaCell(get('gia')),
    phase: String(get('phase') || '').trim(),
    tenure: String(get('tenure') ?? ''),
    tenureCode: 'UNREVIEWED',
    tenureSuggestion: classifyImportedTenure(get('tenure')),
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
  const bedroomsIndex = fieldByColumn.indexOf('bedrooms');
  const giaIndex = fieldByColumn.indexOf('gia');

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
    if (bedroomsIndex >= 0 && String(row[bedroomsIndex] ?? '').trim() && plot.bedrooms == null) {
      issues.push('Invalid Bedrooms');
    }
    if (giaIndex >= 0 && String(row[giaIndex] ?? '').trim() && plot.gia == null) {
      issues.push('Invalid GIA');
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

export const PLOT_UPDATE_FIELDS = Object.freeze([
  'houseType',
  'configuration',
  'bedrooms',
  'gia',
  'phase',
]);

export function getSpreadsheetReadError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (name.includes('notallowed') || message.includes('permission')) {
    return 'The browser could not access that file. Choose it again and retry.';
  }
  if (message.includes('password') || message.includes('encrypt')) {
    return 'That spreadsheet is password-protected or encrypted. Save an unprotected .xlsx copy and retry.';
  }
  if (message.includes('zip') || message.includes('format') || message.includes('corrupt')) {
    return 'That spreadsheet appears damaged or is not a valid Excel workbook. Open it in Excel and save a new .xlsx copy.';
  }
  if (name.includes('typeerror') && (message.includes('fetch') || message.includes('import'))) {
    return 'The spreadsheet reader could not load. Refresh BuildLite and retry.';
  }
  return 'We could not read that spreadsheet. Open it in Excel, save a new unprotected .xlsx copy, and retry.';
}

function normalizePlotNumber(value) {
  return String(value || '').trim().toLocaleLowerCase('en-GB');
}

function comparableValue(field, value) {
  if (field === 'bedrooms' || field === 'gia' || field === 'niaFt2' || field === 'niaM2') {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return String(value ?? '').trim();
}

function nearlyEqual(left, right, tolerance = 0.005) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
}

function derivedSquareMetres(niaFt2) {
  return Math.round(Number(niaFt2) * 0.092903 * 100) / 100;
}

function duplicatePlotNumbers(plots = []) {
  const counts = new Map();
  for (const plot of plots) {
    const key = normalizePlotNumber(plot?.plotNumber);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([plotNumber]) => plotNumber);
}

export function buildExistingPlotUpdatePreview({
  existingPlots = [],
  importedPlots = [],
  mappedFields = [],
  rowErrors = [],
  allowTenureChange = false,
} = {}) {
  const selectedFields = PLOT_UPDATE_FIELDS.filter((field) => mappedFields.includes(field));
  if (allowTenureChange && mappedFields.includes('tenure')) selectedFields.push('tenure');

  const duplicateExistingPlotNumbers = duplicatePlotNumbers(existingPlots);
  const duplicateImportedPlotNumbers = duplicatePlotNumbers(importedPlots);
  const existingByNumber = new Map(
    existingPlots.map((plot) => [normalizePlotNumber(plot.plotNumber), plot])
  );
  const importedByNumber = new Map(
    importedPlots.map((plot) => [normalizePlotNumber(plot.plotNumber), plot])
  );
  const unmatchedImportedPlots = importedPlots.filter(
    (plot) => !existingByNumber.has(normalizePlotNumber(plot.plotNumber))
  );
  const missingExistingPlots = existingPlots.filter(
    (plot) => !importedByNumber.has(normalizePlotNumber(plot.plotNumber))
  );
  const changes = [];
  const updates = [];
  const blankStructuralValues = [];
  const areaImplications = [];
  let matchedCount = 0;
  let unchangedCount = 0;

  for (const imported of importedPlots) {
    const existing = existingByNumber.get(normalizePlotNumber(imported.plotNumber));
    if (!existing) continue;
    matchedCount += 1;
    const fieldChanges = [];
    const patch = { id: existing.id };
    for (const field of selectedFields) {
      const before = comparableValue(field, existing[field]);
      const after = comparableValue(field, imported[field]);
      if ((after == null || after === '') && before != null && before !== '') {
        blankStructuralValues.push({ plotNumber: existing.plotNumber, field });
        continue;
      }
      if (before === after) continue;
      fieldChanges.push({ field, before, after });
      patch[field] = after;
      if (field === 'gia') {
        const previousGia = comparableValue('gia', existing.gia);
        const storedNia = comparableValue('niaFt2', existing.niaFt2);
        const storedNiaM2 = comparableValue('niaM2', existing.niaM2);
        if (storedNia == null) {
          areaImplications.push({
            plotNumber: existing.plotNumber,
            state: 'gia_fallback',
            message: 'Revenue area uses the governed GIA fallback, so live auto-pricing can change.',
          });
        } else if (nearlyEqual(storedNia, previousGia)) {
          patch.niaFt2 = after;
          fieldChanges.push({ field: 'niaFt2', before: storedNia, after, derivedCompatibility: true });
          const previousDerivedM2 = derivedSquareMetres(storedNia);
          const reconciledM2 = storedNiaM2 != null && nearlyEqual(storedNiaM2, previousDerivedM2);
          if (reconciledM2) {
            const nextM2 = derivedSquareMetres(after);
            patch.niaM2 = nextM2;
            fieldChanges.push({ field: 'niaM2', before: storedNiaM2, after: nextM2, derivedCompatibility: true });
          }
          areaImplications.push({
            plotNumber: existing.plotNumber,
            state: reconciledM2 || storedNiaM2 == null
              ? 'derived_nia_updated'
              : 'derived_nia_ft2_m2_mismatch',
            message: reconciledM2 || storedNiaM2 == null
              ? 'Stored NIA ft² matched the previous GIA and will move with it; live auto-pricing can change.'
              : 'Stored NIA ft² matched the previous GIA and will move with it, but independently entered NIA m² does not reconcile and will be preserved.',
          });
        } else {
          areaImplications.push({
            plotNumber: existing.plotNumber,
            state: 'explicit_nia_preserved',
            message: 'Stored NIA differs from GIA and is preserved as potentially independent Revenue evidence.',
          });
        }
      }
      if (field === 'tenure') {
        patch.tenureCode = 'UNREVIEWED';
        patch.tenureSuggestion = imported.tenureSuggestion || 'UNREVIEWED';
      }
    }
    if (fieldChanges.length) {
      changes.push({
        plotId: existing.id,
        plotNumber: existing.plotNumber,
        fields: fieldChanges,
      });
      updates.push(patch);
    } else {
      unchangedCount += 1;
    }
  }

  const errors = [];
  if (!selectedFields.length) errors.push('Map at least one supported structural field to update.');
  if (duplicateExistingPlotNumbers.length) errors.push('The existing Plot Master has duplicate Plot Numbers.');
  if (duplicateImportedPlotNumbers.length) errors.push('The spreadsheet has duplicate Plot Numbers.');
  if (rowErrors.length) errors.push('The spreadsheet contains invalid plot rows.');
  if (blankStructuralValues.length) errors.push('Mapped structural cells cannot clear existing Plot Master evidence.');
  if (unmatchedImportedPlots.length) errors.push('Some imported plots do not match the existing Plot Master.');
  if (missingExistingPlots.length) errors.push('Some existing plots are missing from the spreadsheet.');
  if (existingPlots.length !== importedPlots.length) errors.push('Existing and imported plot counts do not reconcile.');

  return {
    existingCount: existingPlots.length,
    importedCount: importedPlots.length + rowErrors.length,
    matchedCount,
    changedCount: changes.length,
    unchangedCount,
    unmatchedImportedPlots,
    missingExistingPlots,
    duplicateExistingPlotNumbers,
    duplicateImportedPlotNumbers,
    invalidRows: rowErrors,
    blankStructuralValues,
    areaImplications,
    selectedFields,
    changes,
    updates,
    errors: [...new Set(errors)],
    ready: errors.length === 0 && matchedCount === existingPlots.length,
  };
}
