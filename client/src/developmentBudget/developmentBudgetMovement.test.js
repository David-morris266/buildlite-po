import { describe, expect, it } from 'vitest';
import { buildBudgetMovementLines } from './developmentBudgetMovement';

describe('Development Budget movement UX translation', () => {
  it('turns natural positive additions and omissions into authoritative signs', () => {
    expect(buildBudgetMovementLines({ type: 'addition', costCodeId: 'a', amount: '10.01' })).toEqual([{ costCodeId: 'a', amount: '10.01' }]);
    expect(buildBudgetMovementLines({ type: 'omission', costCodeId: 'a', amount: '10.01' })).toEqual([{ costCodeId: 'a', amount: '-10.01' }]);
  });

  it('balances transfers automatically and rejects a self-transfer', () => {
    expect(buildBudgetMovementLines({ type: 'transfer', costCodeId: 'a', toCostCodeId: 'b', amount: '25.01' })).toEqual([{ costCodeId: 'a', amount: '-25.01' }, { costCodeId: 'b', amount: '25.01' }]);
    expect(buildBudgetMovementLines({ type: 'transfer', costCodeId: 'a', toCostCodeId: 'a', amount: '25.01' })).toBeNull();
  });

  it('preserves explicit signed correction and opening-adjustment effects', () => {
    expect(buildBudgetMovementLines({ type: 'correction', costCodeId: 'a', amount: '-0.01' })).toEqual([{ costCodeId: 'a', amount: '-0.01' }]);
    expect(buildBudgetMovementLines({ type: 'opening_adjustment', costCodeId: 'a', amount: '0.01' })).toEqual([{ costCodeId: 'a', amount: '0.01' }]);
  });
});
