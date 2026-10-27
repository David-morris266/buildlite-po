import { parseCsvFile, extractHeaders, isBlankRow, isAcceptedCsvFile } from '../ledger/csvImport';
import { isAcceptedExcelFile, parseExcelFile } from '../payments/excelImport';
import { normaliseCostCodeKey } from './cvrCalculations';

export const FORECAST_FIELDS = Object.freeze({
  costCode: { label: 'Company Cost Code', required: true },
  targetEfc: { label: 'Target EFC', required: true },
  description: { label: 'Description', required: false },
  ignore: { label: 'Ignore', required: false },
});

const aliases = {
  costCode: ['cost code', 'company cost code', 'code', 'element code'],
  targetEfc: ['target efc', 'efc', 'forecast final cost', 'final forecast', 'latest forecast'],
  description: ['description', 'cost code description', 'name'],
};
const normal = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const rowScore = row => (row || []).reduce((score, value) => score + Object.values(aliases).flat().some(alias => normal(value).includes(alias)) * 3 + Boolean(normal(value)), 0);

export function detectForecastHeader(rows) {
  let best = 0; let score = -1;
  rows.slice(0, 20).forEach((row, index) => { const next = rowScore(row); if (next > score) { score = next; best = index; } });
  return best;
}

export function mappingFor(headers) {
  const used = new Set();
  return headers.map((header) => {
    for (const [field, values] of Object.entries(aliases)) {
      if (!used.has(field) && values.some(alias => normal(header) === alias || normal(header).includes(alias))) { used.add(field); return field; }
    }
    return 'ignore';
  });
}

export function excelColumnLetter(index) {
  let value = Number(index) + 1; let result = '';
  while (value > 0) { const remainder = (value - 1) % 26; result = String.fromCharCode(65 + remainder) + result; value = Math.floor((value - 1) / 26); }
  return result;
}

async function sha256(file) {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function excelRows(sheet) {
  const mod = await import('xlsx');
  const XLSX = mod.default || mod;
  const options = { header: 1, defval: '', range: 0 };
  return {
    rows: XLSX.utils.sheet_to_json(sheet, { ...options, raw: true }),
    displayRows: XLSX.utils.sheet_to_json(sheet, { ...options, raw: false }),
  };
}

export async function parseForecastFile(file) {
  const sourceFingerprint = await sha256(file);
  if (isAcceptedCsvFile(file)) {
    const rows = await parseCsvFile(file); const headerRowIndex = detectForecastHeader(rows); const headers = extractHeaders(rows[headerRowIndex] || []);
    return { fileName: file.name, sourceFingerprint, worksheets: [{ name: 'CSV', rows, displayRows: rows, headerRowIndex, headers, fieldByColumn: mappingFor(headers) }], worksheet: 'CSV' };
  }
  if (!isAcceptedExcelFile(file)) throw new Error('Please upload a CSV or Excel (.xlsx) forecast file.');
  const workbook = await parseExcelFile(file);
  const worksheets = await Promise.all(workbook.SheetNames.map(async (name) => {
    const { rows, displayRows } = await excelRows(workbook.Sheets[name]);
    const headerRowIndex = detectForecastHeader(displayRows); const headers = extractHeaders(displayRows[headerRowIndex] || []);
    return { name, rows, displayRows, headerRowIndex, headers, fieldByColumn: mappingFor(headers) };
  }));
  return { fileName: file.name, sourceFingerprint, worksheets, worksheet: worksheets[0]?.name || '' };
}

function roundMoney(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.sign(value || 1) * Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const cleaned = text.replace(/[£$€,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.sign(parsed || 1) * Math.round((Math.abs(parsed) + Number.EPSILON) * 100) / 100 : null;
}

const subtotalPattern = /^(?:grand\s+total|overall\s+total|sub\s*total|total)(?:\b|\s|:)/i;
const isSubtotal = source => (source || []).some(value => subtotalPattern.test(String(value || '').trim()));
const isRepeatedHeader = (costCode, value) => /^cost\s*codes?$/i.test(String(costCode || '').trim()) && /^(?:eso|target\s*efc|efc|current\s*forecast)$/i.test(String(value || '').trim());

export function validateForecastSheet(sheet, fieldByColumn = sheet?.fieldByColumn || [], explicitlyExcludedRows = new Set()) {
  const missingMappings = ['costCode', 'targetEfc'].filter(field => !fieldByColumn.includes(field));
  const duplicateMappings = ['costCode', 'targetEfc', 'description'].filter(field => fieldByColumn.filter(value => value === field).length > 1);
  const rows = []; const errors = []; const excludedRows = []; const duplicates = []; const seen = new Map(); let blankRowCount = 0;
  (sheet?.rows || []).slice((sheet?.headerRowIndex ?? 0) + 1).forEach((source, index) => {
    const rowNumber = (sheet?.headerRowIndex ?? 0) + index + 2;
    const displaySource = sheet?.displayRows?.[rowNumber - 1] || source;
    if (isBlankRow(source)) { blankRowCount += 1; return; }
    const get = field => { const column = fieldByColumn.indexOf(field); return column < 0 ? '' : source[column]; };
    const getDisplay = field => { const column = fieldByColumn.indexOf(field); return column < 0 ? '' : displaySource[column]; };
    const costCode = String(getDisplay('costCode') ?? get('costCode') ?? '').trim(); const costCodeKey = normaliseCostCodeKey(costCode);
    const importedValue = getDisplay('targetEfc'); const targetEfc = roundMoney(get('targetEfc')); const displayedTargetEfc = roundMoney(importedValue);
    const description = String(getDisplay('description') || '').trim();
    if (isRepeatedHeader(costCode, importedValue)) {
      excludedRows.push({ rowNumber, costCode, description, importedValue: String(importedValue ?? ''), monetaryValue: null, reason: 'Repeated worksheet header', reviewRequired: false, structural: true });
      return;
    }
    if (!costCode && /^[A-Za-z]{3}-\d{2,4}$/.test(String(importedValue || '').trim())) {
      excludedRows.push({ rowNumber, costCode, description, importedValue: String(importedValue), monetaryValue: null, reason: 'Repeated reporting-date header', reviewRequired: false, structural: true });
      return;
    }
    if (targetEfc == null && costCode && !description && /\s/.test(costCode)) {
      excludedRows.push({ rowNumber, costCode, description, importedValue: String(importedValue ?? ''), monetaryValue: null, reason: 'Section heading', reviewRequired: false, structural: true });
      return;
    }
    if (!costCodeKey && targetEfc == null) {
      excludedRows.push({ rowNumber, costCode, description, importedValue: String(importedValue ?? ''), monetaryValue: null, reason: isSubtotal(source) ? 'Identified subtotal without an authoritative amount' : 'Heading or note row', reviewRequired: false, structural: true });
      return;
    }
    if (!costCodeKey && targetEfc != null && isSubtotal(source)) {
      excludedRows.push({ rowNumber, costCode, description, importedValue: String(importedValue ?? ''), monetaryValue: targetEfc, reason: 'Identified subtotal row', reviewRequired: true, structural: true });
      return;
    }
    const issues = [];
    if (!costCodeKey) issues.push('Financial value has no Cost Code');
    if (targetEfc == null || targetEfc < 0) issues.push('Target EFC must be a non-negative monetary value');
    if (costCodeKey && seen.has(costCodeKey)) { issues.push(`Duplicate Cost Code (first seen on row ${seen.get(costCodeKey)})`); duplicates.push({ costCodeKey, rowNumbers: [seen.get(costCodeKey), rowNumber] }); } else if (costCodeKey) seen.set(costCodeKey, rowNumber);
    const row = { rowNumber, costCode, costCodeKey, description, targetEfc, displayedTargetEfc, importedValue: String(importedValue ?? ''), issues };
    if (issues.length && explicitlyExcludedRows.has(rowNumber) && targetEfc != null && targetEfc >= 0) {
      excludedRows.push({ ...row, monetaryValue: targetEfc, reason: `Explicitly excluded by QS: ${issues.join('; ')}`, reviewRequired: true, explicitlyExcluded: true });
    } else if (issues.length) errors.push(row); else rows.push(row);
  });
  const importedPence = rows.reduce((total, row) => total + Math.round(row.targetEfc * 100), 0);
  const displayedPence = rows.reduce((total, row) => total + (row.displayedTargetEfc == null ? Math.round(row.targetEfc * 100) : Math.round(row.displayedTargetEfc * 100)), 0);
  const excludedPence = excludedRows.reduce((total, row) => total + Math.round((row.monetaryValue ?? 0) * 100), 0);
  return {
    rows, errors, excludedRows, duplicates, missingMappings, duplicateMappings, blankRowCount,
    excludedReviewRequired: excludedRows.some(row => row.reviewRequired),
    excludedMonetaryTotal: excludedPence / 100,
    importedTotal: importedPence / 100,
    displayedImportedTotal: displayedPence / 100,
    roundingDifference: (importedPence - displayedPence) / 100,
    canPreview: rows.length > 0 && errors.length === 0 && missingMappings.length === 0 && duplicateMappings.length === 0,
  };
}
