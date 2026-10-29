import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseExcelFile, sheetToRawRows } from '../payments/excelImport';
import {
  autoDetectSalesRegisterColumns,
  buildSalesRegisterReview,
  canonicalCurrencyValue,
  sourceSalesStatuses,
} from './salesRegisterImport';

const plots = [
  { id: 'p1', plotNumber: '1', houseType: 'A', revenueStatus: 'Available', sellingPrice: 0 },
  { id: 'p2', plotNumber: '2', houseType: 'B', revenueStatus: 'Available', sellingPrice: 0 },
];

describe('reviewed Sales Register import', () => {
  it('detects supported and unsupported Willow columns', () => {
    const headers = ['Plot', 'House Type', 'Selling Price', 'Extras', 'Incentives', 'Net Revenue', 'Status', 'Forecast Completion'];
    expect(autoDetectSalesRegisterColumns(headers)).toEqual([
      'plotNumber', 'houseTypeEvidence', 'sellingPrice', 'unsupportedExtras',
      'unsupportedIncentives', 'unsupportedNetRevenue', 'salesStatus', 'unsupportedForecastCompletion',
    ]);
  });

  it('matches existing plots and maps controlled status without mutating source plots', () => {
    const rows = [['Plot', 'Status', 'Selling Price'], ['1', 'Completed', '£250,000'], ['2', 'Reserved', '260000']];
    const fields = ['plotNumber', 'salesStatus', 'sellingPrice'];
    const result = buildSalesRegisterReview({
      rows, headerRowIndex: 0, fieldByColumn: fields, plots,
      statusMapping: { Completed: 'Completed', Reserved: 'Reserved' },
    });
    expect(sourceSalesStatuses(rows, 0, fields)).toEqual(['Completed', 'Reserved']);
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({ plotId: 'p1', revenueStatus: 'Completed', sellingPrice: 250000 });
    expect(plots[0]).toMatchObject({ revenueStatus: 'Available', sellingPrice: 0 });
  });

  it('fails closed for unknown, duplicate and unmapped status rows', () => {
    const unknown = buildSalesRegisterReview({ rows: [['Plot', 'Status', 'Selling Price'], ['99', 'Sold', '1']], headerRowIndex: 0, fieldByColumn: ['plotNumber', 'salesStatus', 'sellingPrice'], plots, statusMapping: {} });
    expect(unknown.ready).toBe(false);
    expect(unknown.errors.join(' ')).toContain('does not exist');
    const duplicate = buildSalesRegisterReview({ rows: [['Plot', 'Status', 'Selling Price'], ['1', 'Available', '1'], ['1', 'Available', '1']], headerRowIndex: 0, fieldByColumn: ['plotNumber', 'salesStatus', 'sellingPrice'], plots, statusMapping: { Available: 'Available' } });
    expect(duplicate.errors.join(' ')).toContain('more than once');
  });

  it('reports unsupported mapped columns rather than importing them', () => {
    const result = buildSalesRegisterReview({
      rows: [['Plot', 'Status', 'Selling Price', 'Extras'], ['1', 'Available', '1', '500']], headerRowIndex: 0,
      fieldByColumn: ['plotNumber', 'salesStatus', 'sellingPrice', 'unsupportedExtras'], plots,
      statusMapping: { Available: 'Available' },
    });
    expect(result.unsupportedColumns).toEqual([{ field: 'unsupportedExtras', label: 'Extras — not imported', index: 3 }]);
    expect(result.changes[0]).not.toHaveProperty('extras');
  });

  it('maps forecast Revenue separately from contractual Selling Price', () => {
    const rows=[['Plot','Revenue'],['1',343864.8],['2',251443.8]];
    const result=buildSalesRegisterReview({rows,headerRowIndex:0,fieldByColumn:['plotNumber','forecastPrice'],plots,statusMapping:{},treatment:'forecast_manual_value'});
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({plotId:'p1',importedPrice:343864.8,sourceRowNumber:2});
    expect(result.changes[0]).not.toHaveProperty('sellingPrice');
  });

  it('uses underlying XLSX numbers so display formatting cannot discard pence', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Plot', 'Revenue'], ['1', 343864.81]]);
    sheet.B2.z = '£#,##0';
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, sheet, 'Revenue');
    const bytes = XLSX.write(source, { type: 'array', bookType: 'xlsx' });
    const parsed = await parseExcelFile({ arrayBuffer: async () => bytes });
    const rows = sheetToRawRows(parsed.Sheets.Revenue);
    expect(rows[1][1]).toBe(343864.81);
  });

  it('canonicalises binary Excel currency artefacts but rejects real sub-penny and zero forecasts', () => {
    expect(canonicalCurrencyValue(218582.99999999997, { positive: true })).toBe(218583);
    expect(canonicalCurrencyValue(301908.6, { positive: true })).toBe(301908.6);
    expect(canonicalCurrencyValue(100.001, { positive: true })).toBeNull();
    expect(canonicalCurrencyValue(0, { positive: true })).toBeNull();
    expect(canonicalCurrencyValue('', { positive: true })).toBeNull();
  });

  it('retains status-only contractual imports without inventing a price', () => {
    const rows = [['Plot', 'Status'], ['1', 'Reserved']];
    const result = buildSalesRegisterReview({
      rows,
      headerRowIndex: 0,
      fieldByColumn: ['plotNumber', 'salesStatus'],
      plots: [{ id: 'p1', plotNumber: '1', revenueStatus: 'Available', sellingPrice: 275000 }],
      statusMapping: { Reserved: 'Reserved' },
      treatment: 'contractual_selling_price',
    });
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({ plotId: 'p1', revenueStatus: 'Reserved' });
    expect(result.changes[0]).not.toHaveProperty('importedPrice');
  });

  it('preserves a visible House Type mismatch warning without changing Plot Master', () => {
    const result = buildSalesRegisterReview({
      rows: [['Plot', 'Type', 'Revenue'], ['1', 'Different Type', 250000]],
      headerRowIndex: 0,
      fieldByColumn: ['plotNumber', 'houseTypeEvidence', 'forecastPrice'],
      plots,
      treatment: 'forecast_manual_value',
    });
    expect(result.ready).toBe(true);
    expect(result.changes[0]).toMatchObject({
      houseTypeEvidence: 'Different Type',
      currentHouseType: 'A',
      houseTypeMismatch: true,
    });
    expect(plots[0].houseType).toBe('A');
  });
});
