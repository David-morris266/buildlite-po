/**
 * BL-012B — CVR calculation helpers (period-ready, read-only derived fields).
 */

export function normaliseCostCodeKey(costCode) {
  const raw = String(costCode || '').trim();
  if (!raw) return '';

  let codePart = raw.split('—')[0].split(' - ')[0].split(' – ')[0].trim();
  if (codePart.includes('-') && !/\s/.test(codePart)) {
    const hyphenParts = codePart.split('-');
    if (hyphenParts.length === 2 && hyphenParts[0].length <= 12) {
      codePart = hyphenParts[0].trim();
    }
  }

  return codePart.replace(/\s+/g, '').toLowerCase();
}

export function stripLeadingZeros(value) {
  const text = String(value || '');
  if (!text) return '';
  const stripped = text.replace(/^0+/, '');
  return stripped || text;
}

export function expandCostCodeKeys(costCode) {
  const normalised = normaliseCostCodeKey(costCode);
  if (!normalised) return [];

  const keys = new Set([normalised]);
  const withoutZeros = stripLeadingZeros(normalised);
  if (withoutZeros) keys.add(withoutZeros);

  const alphanumeric = normalised.replace(/[^a-z0-9]/gi, '');
  if (alphanumeric) keys.add(alphanumeric.toLowerCase());

  return [...keys];
}

export function findMatchingCostCodeKey(costCode, knownKeys) {
  const candidates = expandCostCodeKeys(costCode);
  for (const candidate of candidates) {
    if (knownKeys.has(candidate)) return candidate;
  }

  for (const known of knownKeys) {
    if (costCodesMatch(known, costCode)) return known;
    if (stripLeadingZeros(known) === stripLeadingZeros(normaliseCostCodeKey(costCode))) {
      return known;
    }
  }

  return null;
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
  const budget = roundMoney(currentBudget) ?? 0;
  const forecast = roundMoney(forecastFinalCost);
  if (forecast == null) return null;
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

export { enrichCvrForecastRow as enrichCvrRow } from './cvrForecastEngine.js';

export function buildCvrTotals(rows) {
  return {
    originalBudget: sumNullable(rows.map((row) => row.originalBudget)),
    currentBudget: sumNullable(rows.map((row) => row.currentBudget)),
    committed: sumNullable(rows.map((row) => row.committed)),
    certified: sumNullable(rows.map((row) => row.certified)),
    actualCost: sumNullable(rows.map((row) => row.actualCost)),
    systemForecast: sumNullable(rows.map((row) => row.systemForecast)),
    outstandingCertified: sumNullable(rows.map((row) => row.outstandingCertified)),
    commercialAdjustment: sumNullable(rows.map((row) => row.commercialAdjustment)),
    finalForecast: sumNullable(rows.map((row) => row.finalForecast)),
    forecastFinalCost: sumNullable(rows.map((row) => row.finalForecast)),
    costToComplete: sumNullable(rows.map((row) => row.costToComplete)),
    variance: sumNullable(rows.map((row) => row.variance)),
  };
}
