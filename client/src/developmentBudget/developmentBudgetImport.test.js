import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildOpeningBudgetEventLines, developmentBudgetSheetToRows, parseDevelopmentBudgetFile, parseMoneyToPence, selectDevelopmentBudgetWorksheet, setDevelopmentBudgetHeaderMode, setDevelopmentBudgetHeaderRow, validateDevelopmentBudgetImport } from './developmentBudgetImport';

const parsed = (rows, fieldByColumn = ['costCode', 'description', 'amount']) => ({
  rows: [['Cost Code', 'Description', 'Budget'], ...rows],
  headerRowIndex: 0,
  headers: ['Cost Code', 'Description', 'Budget'],
  fieldByColumn,
});
const master = [
  { id: 'cc-a', code: 'A', description: 'Code A', active: true },
  { id: 'cc-b', code: 'B', description: 'Code B', active: false },
];

function workbookFile(sheets) {
  const workbook = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([name, rows]) => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name));
  return new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'appraisal.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

describe('Development Budget import', () => {
  it('parses exact monetary values to integer pennies', () => {
    expect(parseMoneyToPence('£100,000.01')).toBe(10000001);
    expect(parseMoneyToPence('-0.01')).toBe(-1);
    expect(parseMoneyToPence('1.001')).toBeNull();
  });

  it('validates Cost Code Master membership and totals a valid preview', () => {
    const result = validateDevelopmentBudgetImport(parsed([['A', 'Opening', '100000.01']]), master);
    expect(result.canCommit).toBe(true);
    expect(result.totalPence).toBe(10000001);
    expect(result.rows[0]).toMatchObject({ costCodeId: 'cc-a', amountPence: 10000001 });
  });

  it('accepts zero opening rows, omits their zero-effect journal lines, and rejects negative or over-precision values', () => {
    const result = validateDevelopmentBudgetImport(parsed([['A', 'Funded', '100.01'], ['B', 'Zero budget', '0.00']]), [{ ...master[0] }, { ...master[1], active: true }]);
    expect(result.canCommit).toBe(true);
    expect(result.rows[1].issues).toEqual([]);
    expect(result.totalPence).toBe(10001);
    expect(buildOpeningBudgetEventLines(result.rows)).toEqual([{ costCodeId: 'cc-a', amount: '100.01', explanation: 'Funded' }]);
    expect(validateDevelopmentBudgetImport(parsed([['A', '', '-0.01']]), master).canCommit).toBe(false);
    expect(validateDevelopmentBudgetImport(parsed([['A', '', '1.001']]), master).canCommit).toBe(false);
  });

  it('blocks duplicate, unknown, inactive and missing mappings', () => {
    const result = validateDevelopmentBudgetImport(parsed([['A', '', '1'], ['A', '', '2'], ['B', '', '3'], ['X', '', '4']]), master);
    expect(result.canCommit).toBe(false);
    expect(result.errors.flatMap(row => row.issues).join(' ')).toMatch(/Duplicate Cost Code/);
    expect(result.errors.flatMap(row => row.issues).join(' ')).toMatch(/inactive/);
    expect(result.errors.flatMap(row => row.issues).join(' ')).toMatch(/not in the company Cost Code Master/);
    expect(validateDevelopmentBudgetImport(parsed([['A', '', '1']], ['costCode', 'description', 'ignore']), master).missing).toEqual(['amount']);
  });

  it('preserves the first financial row in a headerless workbook', async () => {
    const result = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['A', 'Land purchase', 60000], ['B', 'Fees', 5000]] }));
    expect(result.hasHeader).toBe(false);
    expect(result.headerRowIndex).toBe(-1);
    expect(result.headers).toEqual(['Column 1', 'Column 2', 'Column 3']);
    const mapped = { ...result, fieldByColumn: ['costCode', 'description', 'amount'] };
    const review = validateDevelopmentBudgetImport(mapped, [{ ...master[0] }, { ...master[1], active: true }]);
    expect(review.rows.map(row => row.rowNumber)).toEqual([1, 2]);
    expect(review.totalPence).toBe(6500000);
  });

  it('preserves the first financial row in a headerless CSV', async () => {
    const result = await parseDevelopmentBudgetFile({ name: 'appraisal.csv', type: 'text/csv', text: async () => 'A,Land purchase,60000.01\nB,Fees,5000.02' });
    const review = validateDevelopmentBudgetImport({ ...result, fieldByColumn: ['costCode', 'description', 'amount'] }, [{ ...master[0] }, { ...master[1], active: true }]);
    expect(review.rows.map(row => row.rowNumber)).toEqual([1, 2]);
    expect(review.totalPence).toBe(6500003);
  });

  it('discovers every worksheet and validates only the selected one', async () => {
    const initial = await parseDevelopmentBudgetFile(workbookFile({ Notes: [['Instructions']], Appraisal: [['Cost Code', 'Description', 'Budget'], ['A', 'Land', 60000]] }));
    expect(initial.worksheets.map(sheet => sheet.name)).toEqual(['Notes', 'Appraisal']);
    const selected = selectDevelopmentBudgetWorksheet(initial, 'Appraisal');
    expect(selected.selectedWorksheet).toBe('Appraisal');
    expect(selected.hasHeader).toBe(true);
    expect(validateDevelopmentBudgetImport(selected, master)).toMatchObject({ canCommit: true, totalPence: 6000000 });
  });

  it('allows the user to correct header detection without losing row one', async () => {
    const detected = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['Cost Code', 'Description', 'Budget'], ['A', 'Land', 60000]] }));
    const headerless = setDevelopmentBudgetHeaderMode(detected, false);
    expect(headerless.headerRowIndex).toBe(-1);
    expect(headerless.rows[0]).toEqual(['Cost Code', 'Description', 'Budget']);
    const restored = setDevelopmentBudgetHeaderMode(headerless, true);
    expect(restored.headerRowIndex).toBe(0);
    expect(restored.fieldByColumn).toEqual(['costCode', 'description', 'amount']);
  });

  it('keeps a heading-like word in headerless data as a financial row', async () => {
    const result = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['A', 'Description', 60000], ['B', 'Fees', 5000]] }));
    expect(result.headerRowIndex).toBe(-1);
    const review = validateDevelopmentBudgetImport({ ...result, fieldByColumn: ['costCode', 'description', 'amount'] }, [{ ...master[0] }, { ...master[1], active: true }]);
    expect(review.acceptedRowCount).toBe(2);
  });

  it('shows title and financial rows above an explicitly selected header as excluded evidence', async () => {
    const source = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['Approved appraisal'], ['A', 'Early land row', 60000], ['Cost Code', 'Description', 'Budget'], ['B', 'Fees', 5000]] }));
    expect(source.headerRowIndex).toBe(2);
    const review = validateDevelopmentBudgetImport(source, [{ ...master[0] }, { ...master[1], active: true }]);
    expect(review.sourceNonBlankRowCount).toBe(4);
    expect(review.excludedRows.map(row => row.rowNumber)).toEqual([1, 2, 3]);
    expect(review.firstFinancialRow).toMatchObject({ rowNumber: 4, code: 'B' });
  });

  it('rejects duplicate destination mappings', () => {
    const review = validateDevelopmentBudgetImport(parsed([['A', 'Opening', '100']], ['costCode', 'amount', 'amount']), master);
    expect(review.canCommit).toBe(false);
    expect(review.duplicateMappings).toEqual(['amount']);
  });

  it('requires an explicit choice between Original and Revised Budget columns', async () => {
    const source = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['Cost Code', 'Original Budget £', 'Revised Budget (GBP)'], ['A', 60000, 65000]] }));
    expect(source.fieldByColumn).toEqual(['costCode', 'ignore', 'ignore']);
    expect(validateDevelopmentBudgetImport(source, master).ambiguousMappings[0].message).toMatch(/Explicitly map/);
    const selected = { ...source, fieldByColumn: ['costCode', 'amount', 'ignore'] };
    expect(validateDevelopmentBudgetImport(selected, master)).toMatchObject({ canCommit: true, totalPence: 6000000 });
  });

  it('uses underlying Excel numbers rather than formatted display text', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Cost Code', 'Budget'], ['A', 60000.01]]);
    sheet.B2.z = '£#,##0.00';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Appraisal');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'money.xlsx');
    const source = await parseDevelopmentBudgetFile(file);
    expect(source.rows[1][1]).toBe('60000.01');
    expect(source.numericRows[1][1]).toBe(60000.01);
    expect(validateDevelopmentBudgetImport(source, master).totalPence).toBe(6000001);
  });

  it('fails safely for an empty selected worksheet', async () => {
    const source = await parseDevelopmentBudgetFile(workbookFile({ Empty: [], Appraisal: [['Cost Code', 'Budget'], ['A', 1]] }));
    expect(validateDevelopmentBudgetImport(source, master).canCommit).toBe(false);
    const selected = selectDevelopmentBudgetWorksheet(source, 'Appraisal');
    expect(validateDevelopmentBudgetImport(selected, master).canCommit).toBe(true);
    expect(setDevelopmentBudgetHeaderRow(selected, -1).rows[0]).toEqual(['Cost Code', 'Budget']);
  });

  it('aligns a B3 used range to actual Excel rows without substituting neighbouring numerics', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = {};
    XLSX.utils.sheet_add_aoa(sheet, [['Cost Code', 'Quantity', 'Rate', 'Budget'], ['A', 6, 10, 60000.01]], { origin: 'B3' });
    sheet['!ref'] = 'B3:E4';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Offset');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'offset.xlsx');
    const source = await parseDevelopmentBudgetFile(file);
    expect(source.sourceRowNumbers).toEqual([3, 4]);
    expect(source.sourceColumnNumbers).toEqual([2, 3, 4, 5]);
    expect(source.fieldByColumn).toEqual(['costCode', 'ignore', 'ignore', 'amount']);
    const review = validateDevelopmentBudgetImport(source, master);
    expect(review.firstFinancialRow).toMatchObject({ rowNumber: 4, amountPence: 6000001 });
    expect(review.totalPence).toBe(6000001);
  });

  it('maps an explicit Budget column ahead of Unit Value, Rate and Quantity', async () => {
    const source = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [
      ['Cost Code', 'Unit Value', 'Rate', 'Quantity', 'Budget'],
      ['A', 1000, 12, 5, 60000.01],
    ] }));
    expect(source.fieldByColumn).toEqual(['costCode', 'ignore', 'ignore', 'ignore', 'amount']);
    expect(validateDevelopmentBudgetImport(source, master)).toMatchObject({ canCommit: true, totalPence: 6000001 });
  });

  it('rejects a date-formatted Excel cell mapped as the Budget amount', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Cost Code', 'Budget'], ['A', new Date(Date.UTC(2026, 9, 23))]], { cellDates: false });
    sheet.B2.z = 'dd/mm/yyyy';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Appraisal');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'date-amount.xlsx');
    const review = validateDevelopmentBudgetImport(await parseDevelopmentBudgetFile(file), master);
    expect(review.canCommit).toBe(false);
    expect(review.errors[0].issues).toContain('Budget amount cannot be an Excel date');
  });

  it('fails safely before expanding an exceptionally large worksheet used range', () => {
    const sheet = { A1: { t: 's', v: 'Cost Code' }, B1: { t: 's', v: 'Budget' }, '!ref': 'A1:XFD1048576' };
    expect(() => developmentBudgetSheetToRows(sheet)).toThrow(/too large to review safely/i);
  });

  it('preserves actual rows for an A3 used range', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = {};
    XLSX.utils.sheet_add_aoa(sheet, [['Cost Code', 'Budget'], ['A', 125.55]], { origin: 'A3' });
    sheet['!ref'] = 'A3:B4';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Offset');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'offset-a.xlsx');
    const review = validateDevelopmentBudgetImport(await parseDevelopmentBudgetFile(file), master);
    expect(review.firstFinancialRow).toMatchObject({ rowNumber: 4, amountPence: 12555 });
  });

  it('preserves displayed leading-zero, decimal-style, text and Hawthorn-style Cost Codes', async () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([['Cost Code', 'Budget'], [10, 1], ['10.20', 2], ['HA-A01', 3], ['3510', 4], ['3640', 5]]);
    sheet.A2.z = '0000';
    XLSX.utils.book_append_sheet(workbook, sheet, 'Appraisal');
    const file = new File([XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })], 'codes.xlsx');
    const source = await parseDevelopmentBudgetFile(file);
    expect(source.rows.slice(1).map(row => row[0])).toEqual(['0010', '10.20', 'HA-A01', '3510', '3640']);
    const codeMaster = source.rows.slice(1).map((row, index) => ({ id: `cc-${index}`, code: row[0], active: true }));
    expect(validateDevelopmentBudgetImport(source, codeMaster)).toMatchObject({ canCommit: true, acceptedRowCount: 5, totalPence: 1500 });
  });

  it('flags financial-looking evidence above the selected header', async () => {
    const source = await parseDevelopmentBudgetFile(workbookFile({ Appraisal: [['A', 'Land omitted?', '60000.00'], ['Cost Code', 'Description', 'Budget'], ['B', 'Fees', 5000]] }));
    const review = validateDevelopmentBudgetImport(source, [{ ...master[0] }, { ...master[1], active: true }]);
    expect(review.excludedRows[0]).toMatchObject({ rowNumber: 1, recognisedCostCodes: ['A'], plausibleAmounts: ['60000.00'], potentialFinancialEvidence: true });
  });
});
