import { extractHeaders, isAcceptedCsvFile, isBlankRow, parseCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile, parseExcelFile, sheetToRows } from '../payments/excelImport';

export const IMPORT_FIELDS = {
  costCode: 'Cost Code',
  amount: 'Budget amount',
  description: 'Description',
  ignore: 'Ignore',
};

const normal = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const aliases = {
  costCode: ['cost code', 'company cost code', 'code', 'cost centre', 'cost center'],
  amount: ['budget amount', 'budget', 'original budget', 'amount', 'value'],
  description: ['description', 'desc', 'name'],
};

export function parseMoneyToPence(value) {
  const cleaned = String(value ?? '').trim().replace(/[£,\s]/g, '');
  const match = cleaned.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const pence = Number(match[2]) * 100 + Number((match[3] || '').padEnd(2, '0'));
  if (!Number.isSafeInteger(pence)) return null;
  return (match[1] ? -1 : 1) * pence;
}

function headerRow(rows) {
  let best = 0;
  let score = -1;
  rows.slice(0, 15).forEach((row, index) => {
    const rowScore = row.reduce((total, value) => total + Object.values(aliases).flat().some(alias => normal(value) === alias) * 3, 0);
    if (rowScore > score) { best = index; score = rowScore; }
  });
  return best;
}

function autoMap(headers) {
  const used = new Set();
  return headers.map(header => {
    const value = normal(header);
    const field = Object.entries(aliases).find(([key, values]) => !used.has(key) && values.some(alias => value === alias || value.includes(alias)))?.[0];
    if (field) used.add(field);
    return field || 'ignore';
  });
}

export async function parseDevelopmentBudgetFile(file) {
  let rows;
  if (isAcceptedCsvFile(file)) rows = await parseCsvFile(file);
  else if (isAcceptedExcelFile(file)) {
    const workbook = await parseExcelFile(file);
    rows = sheetToRows(workbook.Sheets[workbook.SheetNames[0]]);
  } else throw new Error('Please choose a CSV or Excel (.xlsx or .xls) file.');
  const headerRowIndex = headerRow(rows);
  const headers = extractHeaders(rows[headerRowIndex] || []);
  return { fileName: file.name, rows, headerRowIndex, headers, fieldByColumn: autoMap(headers) };
}

export function validateDevelopmentBudgetImport(parsed, costCodes = []) {
  const missing = ['costCode', 'amount'].filter(field => !parsed.fieldByColumn.includes(field));
  const master = new Map(costCodes.map(code => [normal(code.code), code]));
  const seen = new Set();
  const rows = [];
  const errors = [];
  for (const [offset, source] of parsed.rows.slice(parsed.headerRowIndex + 1).entries()) {
    if (isBlankRow(source)) continue;
    const get = field => source[parsed.fieldByColumn.indexOf(field)] ?? '';
    const code = String(get('costCode')).trim();
    const amountPence = parseMoneyToPence(get('amount'));
    const record = master.get(normal(code));
    const issues = [];
    if (!code) issues.push('Cost Code is required');
    if (amountPence == null || amountPence <= 0) issues.push('Budget amount must be greater than zero with no more than two decimal places');
    if (code && seen.has(normal(code))) issues.push('Duplicate Cost Code');
    if (code) seen.add(normal(code));
    if (code && !record) issues.push('Cost Code is not in the company Cost Code Master');
    else if (record?.active === false) issues.push('Cost Code is inactive');
    const row = { rowNumber: parsed.headerRowIndex + offset + 2, code, description: String(get('description') || record?.description || record?.element || '').trim(), costCodeId: record?.id, amountPence, issues };
    rows.push(row);
    if (issues.length) errors.push(row);
  }
  return { rows, errors, missing, canCommit: !missing.length && rows.length > 0 && !errors.length, totalPence: rows.filter(row => !row.issues.length).reduce((sum, row) => sum + row.amountPence, 0) };
}
