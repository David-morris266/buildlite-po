import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { detectForecastHeader, mappingFor, parseForecastFile, validateForecastSheet } from './forecastOnboardingImport';

describe('Forecast onboarding spreadsheet mapping', () => {
  it('maps a Matt-style Cost Code and column-F EFC worksheet without treating intervening values as authority', () => {
    const rows = [
      ['CVR Reconciliation'],
      ['Cost Code', 'Description', 'Budget', 'Actual', 'Commitment', 'EFC'],
      ['0100', 'Land', 715437.88, 405569.54, 0, 803236.69],
      ['0200', 'Groundworks', 100, 20, 30, 125.01],
    ];
    const headerRowIndex = detectForecastHeader(rows);
    const fieldByColumn = mappingFor(rows[headerRowIndex]);
    const result = validateForecastSheet({ rows, headerRowIndex }, fieldByColumn);
    expect(headerRowIndex).toBe(1);
    expect(fieldByColumn).toEqual(['costCode', 'description', 'ignore', 'ignore', 'ignore', 'targetEfc']);
    expect(result.canPreview).toBe(true);
    expect(result.rows).toEqual([
      expect.objectContaining({ costCode: '0100', costCodeKey: '0100', targetEfc: 803236.69 }),
      expect.objectContaining({ costCode: '0200', costCodeKey: '0200', targetEfc: 125.01 }),
    ]);
  });

  it('blocks duplicate Cost Codes, invalid money and duplicate required mappings', () => {
    const sheet = { headerRowIndex: 0, rows: [['Code', 'EFC', 'Other'], ['1000', '1.00', '2.00'], ['1000', 'bad', '3.00']] };
    const invalid = validateForecastSheet(sheet, ['costCode', 'targetEfc', 'targetEfc']);
    expect(invalid.canPreview).toBe(false);
    expect(invalid.duplicateMappings).toEqual(['targetEfc']);
    expect(invalid.errors).toHaveLength(1);
  });

  it('handles a 100-row workbook with headings, blanks and reviewed subtotals without hiding financial evidence', () => {
    const data = Array.from({ length: 95 }, (_, index) => [`${1000 + index}`, `Cost ${index + 1}`, index + 0.01]);
    const rows = [
      ['Cost Code', 'Description', 'Target EFC'],
      ['', 'Groundworks section', ''],
      ...data.slice(0, 48),
      ['', 'Subtotal', 1176.48],
      [],
      ...data.slice(48),
      ['', 'Financial row missing identity', 25],
    ];
    const result = validateForecastSheet({ rows, displayRows: rows, headerRowIndex: 0 }, ['costCode', 'description', 'targetEfc']);
    expect(rows).toHaveLength(100);
    expect(result.rows).toHaveLength(95);
    expect(result.excludedRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 2, reason: 'Heading or note row', reviewRequired: false }),
      expect.objectContaining({ rowNumber: 51, reason: 'Identified subtotal row', reviewRequired: true }),
    ]));
    expect(result.blankRowCount).toBe(1);
    expect(result.errors).toEqual([expect.objectContaining({ rowNumber: 100, importedValue: '25', issues: ['Financial value has no Cost Code'] })]);
    expect(result.canPreview).toBe(false);
  });

  it('uses underlying Excel numbers, preserving hidden pence and accounting-format zero', () => {
    const sheet = {
      headerRowIndex: 0,
      rows: [['Cost Code', 'EFC'], ['1000', 1234.567], ['2000', 0]],
      displayRows: [['Cost Code', 'EFC'], ['1000', '£1,235'], ['2000', '–']],
    };
    const result = validateForecastSheet(sheet, ['costCode', 'targetEfc']);
    expect(result.canPreview).toBe(true);
    expect(result.rows).toEqual([
      expect.objectContaining({ costCode: '1000', targetEfc: 1234.57, importedValue: '£1,235' }),
      expect.objectContaining({ costCode: '2000', targetEfc: 0, importedValue: '–' }),
    ]);
  });

  it('extracts underlying XLSX numeric authority instead of formatted display text', async () => {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet([['Cost Code', 'Target EFC'], ['1000', 1234.56], ['2000', 0]]);
    worksheet.B2.z = '0'; worksheet.B3.z = '#,##0;[Red](#,##0);–';
    XLSX.utils.book_append_sheet(workbook, worksheet, 'CVR Reconciliation');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseForecastFile({ name: 'Matt CVR.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => bytes });
    const sheet = parsed.worksheets[0];
    const result = validateForecastSheet(sheet, sheet.fieldByColumn);
    expect(sheet.displayRows[1][1]).toBe('1235');
    expect(result.rows.map(row => row.targetEfc)).toEqual([1234.56, 0]);
    expect(parsed.sourceFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts the real Poplar Road CVR worksheet without modifying structural rows', async () => {
    const bytes = readFileSync('../docs/Levison Rose/CVR - Poplar Road.xlsx');
    const parsed = await parseForecastFile({ name: 'CVR - Poplar Road.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
    const sheet = parsed.worksheets.find(item => item.name === 'CVR Reconciliation');
    const mapping = sheet.headers.map((_, index) => index === 0 ? 'costCode' : index === 1 ? 'description' : index === 5 ? 'targetEfc' : 'ignore');
    const initial = validateForecastSheet(sheet, mapping);
    expect(initial.rows).toHaveLength(94);
    expect(initial.errors).toHaveLength(7);
    const reviewProblemRows = [
      ...initial.errors,
      ...initial.excludedRows.filter(row => ['Repeated worksheet header', 'Repeated reporting-date header'].includes(row.reason) || row.importedValue === 'CURRENT FORECAST'),
    ];
    expect(reviewProblemRows).toHaveLength(19);
    expect(initial.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 45, costCode: '5122', targetEfc: -643 }),
      expect.objectContaining({ rowNumber: 15, costCode: '', targetEfc: 97600 }),
    ]));
    expect(initial.excludedRows.filter(row => row.reason === 'Repeated worksheet header').map(row => row.rowNumber)).toEqual([21, 68, 114, 137]);
    const excludableTotals = initial.errors.filter(row => !row.costCode && row.targetEfc >= 0).map(row => row.rowNumber);
    const reviewed = validateForecastSheet(sheet, mapping, new Set(excludableTotals));
    expect(reviewed.rows).toHaveLength(94);
    expect(reviewed.errors).toEqual([expect.objectContaining({ rowNumber: 45, costCode: '5122', targetEfc: -643 })]);
    expect(reviewed.excludedRows.filter(row => row.explicitlyExcluded)).toHaveLength(excludableTotals.length);
    expect(reviewed.excludedReviewRequired).toBe(true);
    expect(reviewed.importedTotal).toBe(707466.39);
    expect(reviewed.displayedImportedTotal).toBe(707466);
    expect(reviewed.roundingDifference).toBe(0.39);
    expect(reviewed.excludedMonetaryTotal).toBeGreaterThan(reviewed.importedTotal);
  });
});
