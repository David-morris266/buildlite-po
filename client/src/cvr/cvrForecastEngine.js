/**
 * BL-012C / BL-012D — CVR forecast engine (system facts + QS judgement).
 * System Forecast hierarchy per Doc 40 — Commercial Cost Code Architecture.
 */

import {
  roundMoney,
  calculateCostToComplete,
  calculateIncurredCost,
  calculateVariance,
  getVarianceState,
} from './cvrCalculations.js';

function moneyValueExists(value) {
  if (value == null || value === '') return false;
  const money = roundMoney(value);
  return money != null && Math.abs(money) > 0.005;
}

/**
 * System Forecast hierarchy (Doc 40):
 * 1. Approved Commitments exist → Total Approved Commitments
 * 2. Else Current Budget exists → Current Budget
 * 3. Else Actual Cost exists → Actual Cost
 * 4. Else → 0
 */
export function calculateSystemForecast({ committed, actualCost, currentBudget }) {
  const committedValue = roundMoney(committed);

  if (committedValue != null && committedValue > 0) {
    return committedValue;
  }

  if (moneyValueExists(currentBudget)) {
    return roundMoney(currentBudget);
  }

  const actual = roundMoney(actualCost);
  if (moneyValueExists(actualCost) && actual != null && actual > 0) {
    return actual;
  }

  return 0;
}

export function calculateFinalForecast(systemForecast, commercialAdjustment = 0) {
  const adjustment = roundMoney(commercialAdjustment) ?? 0;

  if (systemForecast == null || systemForecast === '') {
    return adjustment === 0 ? null : adjustment;
  }

  const system = roundMoney(systemForecast);
  if (system == null) {
    return adjustment === 0 ? null : adjustment;
  }

  return roundMoney(system + adjustment);
}

export function getAdjustmentState(commercialAdjustment) {
  const value = roundMoney(commercialAdjustment) ?? 0;
  if (value > 0.005) return 'positive';
  if (value < -0.005) return 'negative';
  return 'zero';
}

export function validateCommercialAdjustment(commercialAdjustment, commercialReason) {
  const adjustment = roundMoney(commercialAdjustment) ?? 0;
  const reason = String(commercialReason || '').trim();
  const errors = [];

  if (Math.abs(adjustment) > 0.005 && !reason) {
    errors.push('Commercial Reason is required when Commercial Adjustment is not zero.');
  }

  return {
    commercialAdjustment: adjustment,
    commercialReason: reason,
    errors,
    valid: errors.length === 0,
  };
}

export function applyCostCentreSaveToCvrRow(row, savedCentre = {}) {
  return enrichCvrForecastRow({
    ...row,
    id: savedCentre.id || row.id,
    version: savedCentre.version ?? row.version,
    originalBudget:
      savedCentre.originalBudget !== undefined
        ? savedCentre.originalBudget
        : row.originalBudget,
    currentBudget:
      savedCentre.currentBudget !== undefined
        ? savedCentre.currentBudget
        : row.currentBudget,
    commercialAdjustment:
      savedCentre.commercialAdjustment !== undefined
        ? savedCentre.commercialAdjustment
        : row.commercialAdjustment,
    commercialReason:
      savedCentre.commercialReason !== undefined
        ? savedCentre.commercialReason
        : row.commercialReason,
    adjustmentHistory: savedCentre.adjustmentHistory || row.adjustmentHistory,
    commercialNotes:
      savedCentre.commercialNotes ?? savedCentre.notes ?? row.commercialNotes,
    manualAccrual:
      savedCentre.manualAccrual !== undefined
        ? savedCentre.manualAccrual
        : row.manualAccrual,
  });
}

export function enrichCvrForecastRow(row) {
  const systemForecast = calculateSystemForecast({
    committed: row.committed,
    actualCost: row.actualCost,
    currentBudget: row.currentBudget,
  });

  const commercialAdjustment = roundMoney(row.commercialAdjustment) ?? 0;
  const manualAccrual = roundMoney(row.manualAccrual) ?? 0;
  const finalForecast = calculateFinalForecast(systemForecast, commercialAdjustment);
  const currentCost = calculateIncurredCost(row.actualCost, manualAccrual);
  const costToComplete = calculateCostToComplete(finalForecast, row.actualCost, manualAccrual);
  const variance = calculateVariance(row.currentBudget, finalForecast);

  return {
    ...row,
    manualAccrual,
    currentCost,
    systemForecast,
    commercialAdjustment,
    commercialReason: String(row.commercialReason || ''),
    finalForecast,
    forecastFinalCost: finalForecast,
    costToComplete,
    variance,
    varianceState: getVarianceState(variance),
    adjustmentState: getAdjustmentState(commercialAdjustment),
  };
}
