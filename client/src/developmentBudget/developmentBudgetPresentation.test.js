import { describe, expect, it } from 'vitest';
import { budgetHistoryRow, signedMoney } from './developmentBudgetPresentation';

describe('Development Budget presentation', () => {
  it('formats positive, negative and zero movement signs', () => {
    expect(signedMoney(10000)).toBe('+£10,000.00');
    expect(signedMoney(-5000)).toBe('−£5,000.00');
    expect(signedMoney(0)).toBe('£0.00');
  });

  it('presents an opening as a useful baseline total', () => {
    expect(budgetHistoryRow({ eventType: 'opening_budget', effectiveDate: '2026-09-09', reference: 'OPEN', reason: 'Approved baseline', lines: [{ signedAmount: 100 }, { signedAmount: 50 }] })).toMatchObject({ date: '09/09/26', type: 'Opening Budget', reference: 'OPEN', details: 'Approved baseline', effect: '£150.00 baseline' });
  });

  it('presents a transfer as direction and amount rather than net zero', () => {
    expect(budgetHistoryRow({ eventType: 'transfer', effectiveDate: '2026-09-09', reference: 'TR-1', reason: 'Reallocate', lines: [{ costCode: '4120', description: 'Brickwork', signedAmount: -2000 }, { costCode: '4130', description: 'Carpentry', signedAmount: 2000 }] })).toMatchObject({ details: '4120 — Brickwork → 4130 — Carpentry · Reallocate', effect: '£2,000.00 transferred' });
  });
  it('falls back safely for malformed legacy dates without losing movement evidence', () => {
    const row = budgetHistoryRow({ eventType: 'addition', effectiveDate: 'Wed Sep 09', reference: 'ADD-1', reason: 'Allowance', lines: [{ costCode: '4120', description: 'Brickwork', signedAmount: 10000 }] });
    expect(row.date).toBe('—');
    expect(row.reference).toBe('ADD-1');
    expect(row.details).toContain('Brickwork');
    expect(row.effect).toBe('+£10,000.00');
  });
});
