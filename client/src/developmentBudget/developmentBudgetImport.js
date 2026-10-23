import { extractHeaders, isAcceptedCsvFile, isBlankRow, parseCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile, parseExcelFile } from '../payments/excelImport';

export const IMPORT_FIELDS = {
  costCode: 'Cost Code',
  amount: 'Budget amount',
  description: 'Description',
  ignore: 'Ignore',
};

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalHeader = value => normal(value)
  .replace(/[£$€]/g, ' ')
  .replace(/\b(gbp|sterling)\b/g, ' ')
  .replace(/[()[\]:]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const aliases = {
  costCode: ['cost code', 'company cost code', 'code', 'cost centre', 'cost center'],
  amount: ['budget amount', 'budget', 'original budget', 'amount', 'value'],
  description: ['description', 'desc', 'name'],
};

const isPlausibleAmountHeader = value => /^(?:(?:original|revised|current|approved|governed) )?budget(?: (?:amount|value))?$|^(?:amount|value)$/.test(normalHeader(value));

export function parseMoneyToPence(value) {
  const cleaned = String(value ?? '').trim().replace(/[£,\s]/g, '');
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const pence = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(pence)) return null;
  return (match[1] ? -1 : 1) * pence;
}

function headerRow(rows) {
  let best = -1;
  let score = -1;
  rows.slice(0, 15).forEach((row, index) => {
    const values = row.map(normalHeader);
    const hasCostCode = values.some(value => aliases.costCode.some(alias => value === alias));
    const hasAmount = values.some(isPlausibleAmountHeader);
    if (!hasCostCode || !hasAmount) return;
    const rowScore = row.reduce((total, value) => total + Object.values(aliases).flat().some(alias => normal(value) === alias) * 3, 0);
    if (rowScore > score) { best = index; score = rowScore; }
  });
  return { index: best, score };
}

function autoMap(headers) {
  const used = new Set();
  const fieldByColumn = headers.map(header => {
    const value = normalHeader(header);
    const field = Object.entries(aliases).find(([key, values]) => key !== 'amount' && !used.has(key) && values.some(alias => value === alias || value.includes(alias)))?.[0];
    if (field) used.add(field);
    return field || 'ignore';
  });
  const amountCandidates = headers.reduce((matches, header, index) => isPlausibleAmountHeader(header) ? [...matches, index] : matches, []);
  const ambiguousFields = [];
  if (amountCandidates.length === 1) fieldByColumn[amountCandidates[0]] = 'amount';
  else if (amountCandidates.length > 1) {
    ambiguousFields.push({ field: 'amount', columns: amountCandidates, message: 'Multiple plausible Budget columns were found. Explicitly map the authoritative appraisal amount column.' });
  }
  return { fieldByColumn, ambiguousFields };
}

function columnHeaders(rows) {
  const count = rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return Array.from({ length: count }, (_, index) => `Column ${index + 1}`);
}

function excelColumnName(index) {
  let value = index + 1;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function developmentBudgetSheetToRows(sheet) {
  const reference = String(sheet?.['!ref'] || '');
  const match = reference.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);
  if (!match) return { rows: [], numericRows: [], sourceRowNumbers: [], sourceColumnNumbers: [] };
  const columnNumber = label => [...label.toUpperCase()].reduce((total, character) => total * 26 + character.charCodeAt(0) - 64, 0) - 1;
  const startColumn = columnNumber(match[1]);
  const startRow = Number(match[2]) - 1;
  const endColumn = columnNumber(match[3] || match[1]);
  const endRow = Number(match[4] || match[2]) - 1;
  const rowCount = endRow - startRow + 1;
  const columnCount = endColumn - startColumn + 1;
  if (rowCount > 10000 || columnCount > 500 || rowCount * columnCount > 250000) throw new Error('The selected worksheet range is too large to review safely. Remove unused formatted rows or columns and try again.');
  const rows = [], numericRows = [], cellTypeRows = [], sourceRowNumbers = [];
  const isDateFormat = format => /(^|[^a-z])[dmy]{1,4}([^a-z]|$)/i.test(String(format || '').replace(/"[^"]*"/g, ''));
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    const row = [], numericRow = [], cellTypeRow = [];
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const cell = sheet?.[`${excelColumnName(columnIndex)}${rowIndex + 1}`];
      const displayed = cell?.w ?? cell?.v ?? '';
      row.push(String(displayed).trim());
      numericRow.push(cell?.t === 'n' && Number.isFinite(cell.v) ? cell.v : null);
      const displayedDate = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(String(cell?.w || '').trim());
      cellTypeRow.push(cell?.t === 'd' || (cell?.t === 'n' && (isDateFormat(cell.z) || displayedDate)) ? 'date' : cell?.t || null);
    }
    rows.push(row); numericRows.push(numericRow); cellTypeRows.push(cellTypeRow); sourceRowNumbers.push(rowIndex + 1);
  }
  return {
    rows,
    numericRows,
    cellTypeRows,
    sourceRowNumbers,
    sourceColumnNumbers: Array.from({ length: endColumn - startColumn + 1 }, (_, offset) => startColumn + offset + 1),
  };
}

function getDevelopmentBudgetWorksheetSummaries(workbook) {
  return workbook.SheetNames.map(name => {
    const reference = String(workbook.Sheets[name]?.['!ref'] || '');
    const match = reference.match(/^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/i);
    return { name, rowCount: match ? Number(match[2] || match[1]) - Number(match[1]) + 1 : 0 };
  });
}

function configureWorksheet({ fileName, rows, numericRows = [], cellTypeRows = [], sourceRowNumbers = [], sourceColumnNumbers = [], workbook = null, worksheets = [], selectedWorksheet = null, selectedHeaderRowIndex = null }) {
  const detected = headerRow(rows);
  const headerRowIndex = selectedHeaderRowIndex == null ? detected.index : Number(selectedHeaderRowIndex);
  const resolvedHasHeader = headerRowIndex >= 0 && headerRowIndex < rows.length;
  const headers = resolvedHasHeader ? extractHeaders(rows[headerRowIndex] || []) : columnHeaders(rows);
  const mapping = resolvedHasHeader ? autoMap(headers) : { fieldByColumn: headers.map(() => 'ignore'), ambiguousFields: [] };
  return {
    fileName, rows, numericRows, cellTypeRows, sourceRowNumbers: sourceRowNumbers.length ? sourceRowNumbers : rows.map((_, index) => index + 1), sourceColumnNumbers, workbook, worksheets, selectedWorksheet,
    hasHeader: resolvedHasHeader,
    headerRowIndex,
    headers,
    fieldByColumn: mapping.fieldByColumn,
    ambiguousFields: mapping.ambiguousFields,
  };
}

export async function parseDevelopmentBudgetFile(file) {
  if (isAcceptedCsvFile(file)) {
    return configureWorksheet({ fileName: file.name, rows: await parseCsvFile(file) });
  }
  if (isAcceptedExcelFile(file)) {
    const workbook = await parseExcelFile(file);
    const worksheets = getDevelopmentBudgetWorksheetSummaries(workbook);
    const selectedWorksheet = worksheets[0]?.name || null;
    const extracted = developmentBudgetSheetToRows(workbook.Sheets[selectedWorksheet]);
    return configureWorksheet({
      fileName: file.name,
      ...extracted,
      workbook,
      worksheets,
      selectedWorksheet,
    });
  }
  throw new Error('Please choose a CSV or Excel (.xlsx or .xls) file.');
}

export function selectDevelopmentBudgetWorksheet(parsed, selectedWorksheet) {
  if (!parsed?.workbook?.Sheets?.[selectedWorksheet]) throw new Error('Choose a valid worksheet.');
  const extracted = developmentBudgetSheetToRows(parsed.workbook.Sheets[selectedWorksheet]);
  return configureWorksheet({
    fileName: parsed.fileName,
    ...extracted,
    workbook: parsed.workbook,
    worksheets: parsed.worksheets,
    selectedWorksheet,
  });
}

export function setDevelopmentBudgetHeaderRow(parsed, headerRowIndex) {
  return configureWorksheet({
    fileName: parsed.fileName,
    rows: parsed.rows,
    numericRows: parsed.numericRows,
    cellTypeRows: parsed.cellTypeRows,
    sourceRowNumbers: parsed.sourceRowNumbers,
    sourceColumnNumbers: parsed.sourceColumnNumbers,
    workbook: parsed.workbook,
    worksheets: parsed.worksheets,
    selectedWorksheet: parsed.selectedWorksheet,
    selectedHeaderRowIndex: Number(headerRowIndex),
  });
}

export function setDevelopmentBudgetHeaderMode(parsed, hasHeader) {
  return setDevelopmentBudgetHeaderRow(parsed, hasHeader ? Math.max(0, headerRow(parsed.rows).index) : -1);
}

export function validateDevelopmentBudgetImport(parsed, costCodes = []) {
  const missing = ['costCode', 'amount'].filter(field => !parsed.fieldByColumn.includes(field));
  const duplicateMappings = Object.keys(IMPORT_FIELDS).filter(field => field !== 'ignore' && parsed.fieldByColumn.filter(mapped => mapped === field).length > 1);
  const ambiguousMappings = (parsed.ambiguousFields || []).filter(item => parsed.fieldByColumn.filter(mapped => mapped === item.field).length !== 1);
  const master = new Map(costCodes.map(code => [normal(code.code), code]));
  const seen = new Set();
  const rows = [];
  const errors = [];
  const dataStart = parsed.headerRowIndex + 1;
  const excludedRows = parsed.rows.slice(0, dataStart).map((source, index) => ({
    rowNumber: parsed.sourceRowNumbers?.[index] ?? index + 1,
    values: source,
    reason: index === parsed.headerRowIndex ? 'Selected heading row' : 'Above selected heading row',
  })).filter(row => !isBlankRow(row.values));
  excludedRows.forEach(row => {
    const recognisedCostCodes = row.values.filter(value => master.has(normal(value))).map(String);
    const plausibleAmounts = row.values.filter(value => !master.has(normal(value)) && parseMoneyToPence(value) != null).map(String);
    row.recognisedCostCodes = recognisedCostCodes;
    row.plausibleAmounts = plausibleAmounts;
    row.potentialFinancialEvidence = recognisedCostCodes.length > 0 || plausibleAmounts.length > 0;
  });
  for (const [offset, source] of parsed.rows.slice(dataStart).entries()) {
    if (isBlankRow(source)) continue;
    const get = field => source[parsed.fieldByColumn.indexOf(field)] ?? '';
    const code = String(get('costCode')).trim();
    const sourceIndex = dataStart + offset;
    const amountColumn = parsed.fieldByColumn.indexOf('amount');
    const rawAmount = parsed.numericRows?.[sourceIndex]?.[amountColumn];
    const amountIsDate = parsed.cellTypeRows?.[sourceIndex]?.[amountColumn] === 'date';
    const amountPence = amountIsDate ? null : parseMoneyToPence(rawAmount ?? get('amount'));
    const record = master.get(normal(code));
    const issues = [];
    if (!code) issues.push('Cost Code is required');
    if (amountIsDate) issues.push('Budget amount cannot be an Excel date');
    else if (amountPence == null || amountPence < 0) issues.push('Budget amount must be zero or greater with no more than two decimal places');
    if (code && seen.has(normal(code))) issues.push('Duplicate Cost Code');
    if (code) seen.add(normal(code));
    if (code && !record) issues.push('Cost Code is not in the company Cost Code Master');
    else if (record?.active === false) issues.push('Cost Code is inactive');
    const row = { rowNumber: parsed.sourceRowNumbers?.[sourceIndex] ?? sourceIndex + 1, code, description: String(get('description') || record?.description || record?.element || '').trim(), costCodeId: record?.id, amountPence, issues };
    rows.push(row);
    if (issues.length) errors.push(row);
  }
  const acceptedRows = rows.filter(row => !row.issues.length);
  return {
    rows, acceptedRows, errors, missing, duplicateMappings, ambiguousMappings, excludedRows,
    sourceNonBlankRowCount: parsed.rows.filter(row => !isBlankRow(row)).length,
    acceptedRowCount: acceptedRows.length,
    rejectedRowCount: errors.length,
    excludedRowCount: excludedRows.length,
    firstFinancialRow: acceptedRows[0] || null,
    lastFinancialRow: acceptedRows.at(-1) || null,
    canCommit: !missing.length && !duplicateMappings.length && !ambiguousMappings.length && rows.length > 0 && !errors.length,
    totalPence: acceptedRows.reduce((sum, row) => sum + row.amountPence, 0),
  };
}

export function buildOpeningBudgetEventLines(rows = []) {
  return rows
    .filter(row => !row.issues?.length && row.amountPence > 0)
    .map(row => ({
      costCodeId: row.costCodeId,
      amount: (row.amountPence / 100).toFixed(2),
      explanation: row.description,
    }));
}
