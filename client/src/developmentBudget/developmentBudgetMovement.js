import { parseMoneyToPence } from './developmentBudgetImport';

export function buildBudgetMovementLines({ type, costCodeId, toCostCodeId, amount }) {
  const pence = parseMoneyToPence(amount);
  if (!pence) return null;
  if (type === 'transfer') {
    if (!costCodeId || !toCostCodeId || costCodeId === toCostCodeId) return null;
    return [
      { costCodeId, amount: (-Math.abs(pence) / 100).toFixed(2) },
      { costCodeId: toCostCodeId, amount: (Math.abs(pence) / 100).toFixed(2) },
    ];
  }
  if (!costCodeId) return null;
  const signed = type === 'omission' ? -Math.abs(pence) : type === 'addition' ? Math.abs(pence) : pence;
  return [{ costCodeId, amount: (signed / 100).toFixed(2) }];
}
