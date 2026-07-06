/**
 * BL-012B — CVR calculation helpers (period-ready, read-only derived fields).
 */

export function normaliseCostCodeKey(costCode) {
  const raw = String(costCode || '').trim();
  if (!raw) return '';

  const codePart = raw.split('—')[0].split(' - ')[0].trim();
  return codePart.toLowerCase();
}

export function buildCostCodeLabel(costCodeKey, fallback = '') {
  const value = String(fallback || costCodeKey || '').trim();
  return value || costCodeKey || '—';
}

export function costCodesMatch(left, right) {
  const a = normaliseCostCodeKey(left);
  const b = normaliseCostCodeKey(right);
  if (!a || !b) return false;
  return a === b;
}

export function roundMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calculateCostToComplete(forecastFinalCost, actualCost) {
  const forecast = roundMoney(forecastFinalCost);
  const actual = roundMoney(actualCost) ?? 0;
  if (forecast == null) return null;
  return roundMoney(forecast - actual);
}

export function calculateVariance(currentBudget, forecastFinalCost) {
  const budget = roundMoney(currentBudget);
  const forecast = roundMoney(forecastFinalCost);
  if (budget == null || forecast == null) return null;
  return roundMoney(budget - forecast);
}

export function getVarianceState(variance) {
  const value = roundMoney(variance);
  if (value == null) return 'neutral';
  if (value > 0.005) return 'saving';
  if (value < -0.005) return 'overspend';
  return 'neutral';
}

export function sumNullable(values) {
  let hasValue = false;
  let total = 0;

  for (const value of values) {
    const n = roundMoney(value);
    if (n == null) continue;
    hasValue = true;
    total += n;
  }

  return hasValue ? roundMoney(total) : null;
}

export function buildCvrTotals(rows) {
  return {
    originalBudget: sumNullable(rows.map((row) => row.originalBudget)),
    currentBudget: sumNullable(rows.map((row) => row.currentBudget)),
    committed: sumNullable(rows.map((row) => row.committed)),
    actualCost: sumNullable(rows.map((row) => row.actualCost)),
    forecastFinalCost: sumNullable(rows.map((row) => row.forecastFinalCost)),
    costToComplete: sumNullable(rows.map((row) => row.costToComplete)),
    variance: sumNullable(rows.map((row) => row.variance)),
  };
}

export function enrichCvrRow(row) {
  const costToComplete = calculateCostToComplete(
    row.forecastFinalCost,
    row.actualCost
  );
  const variance = calculateVariance(row.currentBudget, row.forecastFinalCost);

  return {
    ...row,
    costToComplete,
    variance,
    varianceState: getVarianceState(variance),
  };
}
