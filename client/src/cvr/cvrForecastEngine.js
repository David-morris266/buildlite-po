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

/**
 * Baseline retention model:
 * recognised obligation = max(commitment, certified, current cost)
 * uncommitted forecast = max(current budget - recognised obligation, 0)
 * system forecast = recognised obligation + uncommitted forecast
 */
export function calculateRecognisedObligation({ committed, certified, currentCost }) {
  return Math.max(
    0,
    roundMoney(committed) ?? 0,
    roundMoney(certified) ?? 0,
    roundMoney(currentCost) ?? 0,
  );
}

export function calculateUncommittedForecast(currentBudget, recognisedObligation = 0) {
  const budget = roundMoney(currentBudget) ?? 0;
  const obligation = roundMoney(recognisedObligation) ?? 0;
  return roundMoney(Math.max(budget - obligation, 0));
}

export function calculateSystemForecast({
  currentBudget,
  recognisedObligation = null,
  committed,
  certified,
  currentCost,
  actualCost,
}) {
  const obligation = recognisedObligation == null
    ? calculateRecognisedObligation({ committed, certified, currentCost: currentCost ?? actualCost })
    : roundMoney(recognisedObligation) ?? 0;
  return roundMoney(obligation + calculateUncommittedForecast(currentBudget, obligation));
}

export function calculateFinalForecast(
  systemForecast,
  commercialAdjustment = 0,
  expectedLiability = 0,
  vaExposureUplift = 0,
  recognisedObligation = null,
  changeExposure = null,
) {
  const toPence = (value) => Math.round((Number(value) || 0) * 100);
  const exposure = changeExposure == null ? toPence(expectedLiability) + toPence(vaExposureUplift) : toPence(changeExposure);
  const additions = exposure + toPence(commercialAdjustment);

  if (systemForecast == null || systemForecast === '') {
    const forecast = additions / 100;
    return forecast === 0 ? null : forecast;
  }

  const system = roundMoney(systemForecast);
  if (system == null) {
    const forecast = additions / 100;
    return forecast === 0 ? null : forecast;
  }

  const provisional = (toPence(system) + additions) / 100;
  if (recognisedObligation == null) return provisional;

  // The floor constrains favourable Commercial Adjustment only. Signed CE/VA
  // credits remain authoritative and therefore participate in the floor.
  const exposureFloor = (
    toPence(recognisedObligation) +
    exposure
  ) / 100;
  return Math.max(provisional, exposureFloor);
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
  const manualAccrual = roundMoney(row.manualAccrual) ?? 0;
  const currentCost = calculateIncurredCost(row.actualCost, manualAccrual);
  const recognisedObligation = calculateRecognisedObligation({
    committed: row.committed,
    certified: row.certified,
    currentCost,
  });
  const uncommittedForecast = calculateUncommittedForecast(
    row.currentBudget,
    recognisedObligation,
  );
  const systemForecast = calculateSystemForecast({
    currentBudget: row.currentBudget,
    recognisedObligation,
  });

  const commercialAdjustment = roundMoney(row.commercialAdjustment) ?? 0;
  const expectedLiability = roundMoney(row.expectedLiability) ?? 0;
  const vaExposureUplift = roundMoney(row.vaExposureUplift) ?? 0;
  const changeExposure = row.changeExposure == null ? roundMoney(expectedLiability + vaExposureUplift) ?? 0 : roundMoney(row.changeExposure) ?? 0;
  const finalForecast = calculateFinalForecast(
    systemForecast,
    commercialAdjustment,
    expectedLiability,
    vaExposureUplift,
    recognisedObligation,
    changeExposure,
  );
  const costToComplete = calculateCostToComplete(finalForecast, row.actualCost, manualAccrual);
  const variance = calculateVariance(row.currentBudget, finalForecast);

  return {
    ...row,
    manualAccrual,
    currentCost,
    recognisedObligation,
    uncommittedForecast,
    systemForecast,
    expectedLiability,
    vaExposureUplift,
    changeExposure,
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
