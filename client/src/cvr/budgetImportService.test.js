import { describe, expect, it } from 'vitest';
import { validateBudgetImport, formatBudgetImportMasterError } from './budgetImportService';

function parsed(rows, fieldByColumn = ['costCode', 'description', 'originalBudget', 'currentBudget']) {
  return {
    rows: [['Cost Code', 'Description', 'Budget', 'Current'], ...rows],
    headerRowIndex: 0,
    fieldByColumn,
  };
}

describe('BL-037B budget import validation', () => {
  it('accepts a valid Master code including explicit £0', () => {
    const result = validateBudgetImport(
      parsed([
        ['1110', 'Stamp Duty', '25000', ''],
        ['2300', 'Brickwork', '0', '0'],
      ]),
      { knownCostCodes: ['1110', '2300'] }
    );
    expect(result.canImport).toBe(true);
    expect(result.validRows).toHaveLength(2);
    expect(result.validRows[1].originalBudget).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('fails closed on unknown Master codes', () => {
    const result = validateBudgetImport(parsed([['9999', 'Miscellaneous', '10', '']]), {
      knownCostCodes: ['1110'],
    });
    expect(result.canImport).toBe(false);
    expect(result.unknownCodes.map((item) => item.costCodeKey)).toContain('9999');
    expect(formatBudgetImportMasterError(result.unknownCodes)).toMatch(/9999 — Miscellaneous/);
    expect(formatBudgetImportMasterError(result.unknownCodes)).toMatch(
      /not available in your Cost Code Master/
    );
  });

  it('fails closed on duplicate cost codes in the file', () => {
    const result = validateBudgetImport(
      parsed([
        ['1110', 'Stamp Duty', '10', ''],
        ['1110', 'Stamp Duty again', '20', ''],
      ]),
      { knownCostCodes: ['1110'] }
    );
    expect(result.canImport).toBe(false);
    expect(result.duplicateCodes.length).toBeGreaterThan(0);
  });

  it('does not offer to create arbitrary headings', () => {
    const result = validateBudgetImport(parsed([['8888', 'Temporary', '1', '']]), {
      knownCostCodes: ['1110'],
    });
    expect(result.newCostCodesPending).toBe(0);
    expect(result.pendingNewCostCodes).toEqual([]);
  });
});
