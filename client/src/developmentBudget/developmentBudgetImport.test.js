import { describe, expect, it } from 'vitest';
import { buildOpeningBudgetEventLines, parseMoneyToPence, validateDevelopmentBudgetImport } from './developmentBudgetImport';

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
});
