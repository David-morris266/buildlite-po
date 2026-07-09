/**
 * BL-011B.03 — Client-side Excel parsing and column detection (Doc 31).
 */

let xlsxModulePromise;

async function getXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx');
  }
  const mod = await xlsxModulePromise;
  return mod.default || mod;
}

export const IMPORT_FIELDS = {
  description: { label: 'Description', required: true },
  orderValue: { label: 'Order Value', required: true },
  notes: { label: 'Notes', required: false },
  costCode: { label: 'Cost Code', required: false },
  plot: { label: 'Plot', required: false },
  phase: { label: 'Phase', required: false },
  trade: { label: 'Trade', required: false },
  ignore: { label: 'Ignore', required: false },
};

const HEADER_ALIASES = {
  description: [
    'description',
    'desc',
    'item',
    'work item',
    'scope',
    'works',
    'activity',
    'work description',
  ],
  orderValue: [
    'order value',
    'value',
    'amount',
    'price',
    'total',
    'sum',
    'order amount',
    'contract value',
    'line value',
    'budget',
  ],
  notes: ['notes', 'note', 'comments', 'comment', 'remarks', 'remark'],
  costCode: ['cost code', 'code', 'cost centre', 'cost center', 'cc'],
  plot: ['plot', 'unit', 'plot no', 'plot number', 'plot no.'],
  phase: ['phase', 'stage'],
  trade: ['trade', 'package', 'discipline'],
};

const ACCEPTED_EXTENSIONS = ['.xlsx', '.xls'];
const ACCEPTED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

export function isAcceptedExcelFile(file) {
  if (!file) return false;
  const name = String(file.name || '').toLowerCase();
  if (ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))) return true;
  if (ACCEPTED_MIME.includes(file.type)) return true;
  return false;
}

let XLSX;

export async function parseExcelFile(file) {
  XLSX = await getXlsx();
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  return workbook;
}

export function getWorksheetSummaries(workbook) {
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    const rows = sheetToRows(sheet);
    return {
      name,
      rowCount: rows.length,
    };
  });
}

export function sheetToRows(sheet) {
  if (!sheet || !XLSX) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  return rows.map((row) =>
    (Array.isArray(row) ? row : []).map((cell) => String(cell ?? '').trim())
  );
}

function normaliseHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[£$€]/g, '')
    .replace(/\s+/g, ' ');
}

function scoreHeaderRow(row) {
  let score = 0;
  for (const cell of row) {
    const text = normaliseHeader(cell);
    if (!text) continue;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((alias) => text === alias || text.includes(alias))) {
        score += field === 'description' || field === 'orderValue' ? 2 : 1;
      }
    }
  }
  return score;
}

export function detectHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 15);
  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i += 1) {
    const score = scoreHeaderRow(rows[i] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

export function extractHeaders(row) {
  return (row || []).map((cell, index) => {
    const label = String(cell || '').trim();
    return label || `Column ${index + 1}`;
  });
}

export function autoDetectColumnMapping(headers) {
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

export function mappingToFieldByColumn(headers, mapping) {
  const fieldByColumn = headers.map(() => 'ignore');
  for (const [field, colIndex] of Object.entries(mapping)) {
    if (field === 'ignore') continue;
    if (colIndex == null || colIndex < 0 || colIndex >= headers.length) continue;
    fieldByColumn[colIndex] = field;
  }
  return fieldByColumn;
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

export function parseMoneyCell(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value)
    .replace(/[£$€,\s]/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function isBlankRow(values) {
  return values.every((cell) => !String(cell || '').trim());
}

/**
 * Summary / total rows that should not be imported as plot or line items.
 */
export function isSummaryTotalRow(label) {
  const text = normaliseHeader(label);
  if (!text) return false;

  if (
    /^(grand total|overall total|plot totals?|sub\s*total|subtotal|totals?|sum)$/.test(
      text
    )
  ) {
    return true;
  }

  if (text.includes('grand total') || text.includes('overall total')) {
    return true;
  }

  return /^plot totals?$/.test(text);
}

/**
 * Locate the plot × stage header row (stage names come from uploaded headers).
 */
export function detectPlotStageHeaderRowIndex(rows) {
  const scanLimit = Math.min(rows.length, 25);

  for (let index = 0; index < scanLimit; index += 1) {
    if (detectPlotStageLayout(rows, index)) {
      return index;
    }
  }

  return detectHeaderRowIndex(rows);
}

function buildNotesBase(row, fieldByColumn) {
  const parts = [];
  const notesIndex = fieldByColumn.indexOf('notes');
  if (notesIndex >= 0 && row[notesIndex]) {
    parts.push(String(row[notesIndex]).trim());
  }

  for (const field of ['costCode', 'plot', 'phase', 'trade']) {
    const index = fieldByColumn.indexOf(field);
    if (index >= 0 && row[index]) {
      const label = IMPORT_FIELDS[field].label;
      parts.push(`${label}: ${String(row[index]).trim()}`);
    }
  }

  return parts.filter(Boolean).join(' · ');
}

export function buildImportPreview(rows, headerRowIndex, fieldByColumn, limit = 5) {
  const dataRows = rows.slice(headerRowIndex + 1);
  const preview = [];

  for (const row of dataRows) {
    if (preview.length >= limit) break;
    if (isBlankRow(row)) continue;

    const descriptionIndex = fieldByColumn.indexOf('description');
    const valueIndex = fieldByColumn.indexOf('orderValue');
    const notesIndex = fieldByColumn.indexOf('notes');
    const description =
      descriptionIndex >= 0 ? String(row[descriptionIndex] || '').trim() : '';

    if (isSummaryTotalRow(description)) continue;

    preview.push({
      description:
        descriptionIndex >= 0 ? String(row[descriptionIndex] || '').trim() : '',
      orderValue:
        valueIndex >= 0 ? parseMoneyCell(row[valueIndex]) : null,
      notes:
        notesIndex >= 0
          ? String(row[notesIndex] || '').trim()
          : buildNotesBase(row, fieldByColumn),
    });
  }

  return preview;
}

export function validateAndBuildImportRows(
  rows,
  headerRowIndex,
  fieldByColumn,
  committedValue
) {
  const warnings = [];
  const errors = [];
  const importRows = [];
  const descriptionsSeen = new Map();

  const descriptionIndex = fieldByColumn.indexOf('description');
  const valueIndex = fieldByColumn.indexOf('orderValue');

  if (descriptionIndex < 0) {
    errors.push('Choose which column contains the description.');
  }
  if (valueIndex < 0) {
    errors.push('Choose which column contains the order value.');
  }

  if (errors.length) {
    return {
      rows: [],
      warnings,
      errors,
      importedTotal: 0,
      committedValue: Number(committedValue) || 0,
      difference: Number(committedValue) || 0,
      blankRowsIgnored: 0,
    };
  }

  let blankRowsIgnored = 0;
  let missingValues = 0;
  let negativeValues = 0;

  const dataRows = rows.slice(headerRowIndex + 1);

  dataRows.forEach((row, rowOffset) => {
    if (isBlankRow(row)) {
      blankRowsIgnored += 1;
      return;
    }

    const description = String(row[descriptionIndex] || '').trim();
    const rawValue = row[valueIndex];
    const parsedValue = parseMoneyCell(rawValue);
    const notes = buildNotesBase(row, fieldByColumn);

    if (isSummaryTotalRow(description)) {
      return;
    }

    if (!description) {
      missingValues += 1;
      return;
    }

    const orderValue = parsedValue == null ? 0 : parsedValue;
    if (parsedValue == null) {
      missingValues += 1;
    }
    if (orderValue < 0) {
      negativeValues += 1;
    }

    const key = description.toLowerCase();
    if (descriptionsSeen.has(key)) {
      warnings.push(`Duplicate description: "${description}".`);
    } else {
      descriptionsSeen.set(key, true);
    }

    importRows.push({
      id: `import-${rowOffset}-${Date.now()}-${importRows.length}`,
      description,
      orderValue,
      notes,
    });
  });

  if (blankRowsIgnored > 0) {
    warnings.push(`${blankRowsIgnored} blank row${blankRowsIgnored === 1 ? '' : 's'} will be ignored.`);
  }
  if (missingValues > 0) {
    warnings.push(`${missingValues} row${missingValues === 1 ? '' : 's'} had missing descriptions or values.`);
  }
  if (negativeValues > 0) {
    warnings.push(`${negativeValues} row${negativeValues === 1 ? ' has' : 's have'} a negative value.`);
  }

  if (importRows.length === 0) {
    errors.push('No usable rows were found in this worksheet.');
  }

  const importedTotal = importRows.reduce(
    (sum, row) => sum + (Number(row.orderValue) || 0),
    0
  );
  const committed = Number(committedValue) || 0;
  const difference = committed - importedTotal;

  if (Math.abs(difference) > 0.005 && importRows.length > 0) {
    if (difference > 0) {
      warnings.push(
        `Imported total is £${difference.toFixed(2)} below the committed value.`
      );
    } else {
      warnings.push(
        `Imported total is £${Math.abs(difference).toFixed(2)} above the committed value.`
      );
    }
  }

  return {
    rows: importRows,
    warnings: [...new Set(warnings)],
    errors,
    importedTotal,
    committedValue: committed,
    difference,
    blankRowsIgnored,
  };
}

export function getDetectedColumnsSummary(fieldByColumn, headers) {
  const detected = [];
  fieldByColumn.forEach((field, index) => {
    if (field === 'ignore') return;
    detected.push({
      field,
      label: IMPORT_FIELDS[field]?.label || field,
      header: headers[index],
    });
  });
  return detected;
}

const PLOT_HEADER_ALIASES = ['plot', 'unit', 'plot no', 'plot number', 'plot no.'];

function isPlotHeaderCell(value) {
  const text = normaliseHeader(value);
  return PLOT_HEADER_ALIASES.some(
    (alias) => text === alias || text.includes(alias)
  );
}

function extractPlotStageHeaders(headerRow) {
  const stages = [];
  const columnIndexes = [];

  (headerRow || []).slice(1).forEach((cell, offset) => {
    const header = String(cell || '').trim();
    if (!header || isSummaryTotalRow(header)) return;
    stages.push(header);
    columnIndexes.push(offset + 1);
  });

  return { stages, columnIndexes };
}

/**
 * Doc 32 — Detect housebuilder plot × stage valuation matrices.
 */
export function detectPlotStageLayout(rows, headerRowIndex = 0) {
  const headerRow = rows[headerRowIndex] || [];
  if (headerRow.length < 3) return false;
  if (!isPlotHeaderCell(headerRow[0])) return false;

  const { stages, columnIndexes } = extractPlotStageHeaders(headerRow);
  if (stages.length < 2) return false;

  let plotRows = 0;
  for (const row of rows.slice(headerRowIndex + 1)) {
    if (isBlankRow(row)) continue;
    const plotLabel = String(row[0] || '').trim();
    if (!plotLabel || isSummaryTotalRow(plotLabel)) continue;
    const numericValues = columnIndexes
      .map((index) => row[index])
      .filter((cell) => parseMoneyCell(cell) != null);
    if (numericValues.length >= 1) plotRows += 1;
  }

  return plotRows >= 1;
}

export function buildPlotStagePreview(rows, headerRowIndex, limit = 5) {
  const headerRow = rows[headerRowIndex] || [];
  const { stages, columnIndexes } = extractPlotStageHeaders(headerRow);
  const preview = [];

  for (const row of rows.slice(headerRowIndex + 1)) {
    if (preview.length >= limit) break;
    if (isBlankRow(row)) continue;
    const plot = String(row[0] || '').trim();
    if (!plot || isSummaryTotalRow(plot)) continue;
    preview.push({
      plot,
      values: columnIndexes.map((index) => parseMoneyCell(row[index])),
    });
  }

  return { stages, preview };
}

export function buildPlotStageImport(rows, headerRowIndex, committedValue) {
  const warnings = [];
  const errors = [];
  const headerRow = rows[headerRowIndex] || [];
  const { stages, columnIndexes } = extractPlotStageHeaders(headerRow);

  if (!isPlotHeaderCell(headerRow[0])) {
    errors.push('The first column must identify each plot.');
  }
  if (stages.length < 2) {
    errors.push('Add at least two payment stage columns across the top row.');
  }

  const plots = [];
  let blankRowsIgnored = 0;
  const plotLabelsSeen = new Set();

  for (const row of rows.slice(headerRowIndex + 1)) {
    if (isBlankRow(row)) {
      blankRowsIgnored += 1;
      continue;
    }

    const label = String(row[0] || '').trim();
    if (!label || isSummaryTotalRow(label)) continue;

    const values = columnIndexes.map((index) => {
      const parsed = parseMoneyCell(row[index]);
      return parsed == null ? 0 : parsed;
    });

    const key = label.toLowerCase();
    if (plotLabelsSeen.has(key)) {
      warnings.push(`Duplicate plot: "${label}".`);
    } else {
      plotLabelsSeen.add(key);
    }

    plots.push({
      id: `plot-${plots.length}-${label.replace(/\s+/g, '-').toLowerCase()}`,
      label,
      values,
    });
  }

  if (blankRowsIgnored > 0) {
    warnings.push(
      `${blankRowsIgnored} blank row${blankRowsIgnored === 1 ? '' : 's'} will be ignored.`
    );
  }

  if (plots.length === 0) {
    errors.push('No plot rows were found in this worksheet.');
  }

  const importedTotal = plots.reduce(
    (sum, plot) =>
      sum + plot.values.reduce((plotSum, value) => plotSum + (Number(value) || 0), 0),
    0
  );
  const committed = Number(committedValue) || 0;
  const difference = committed - importedTotal;

  if (Math.abs(difference) > 0.005 && plots.length > 0) {
    if (difference > 0) {
      warnings.push(
        `Imported total is £${difference.toFixed(2)} below the committed value.`
      );
    } else {
      warnings.push(
        `Imported total is £${Math.abs(difference).toFixed(2)} above the committed value.`
      );
    }
  }

  return {
    layout: 'plot-stage',
    stages,
    plots,
    warnings: [...new Set(warnings)],
    errors,
    importedTotal,
    committedValue: committed,
    difference,
    blankRowsIgnored,
  };
}
