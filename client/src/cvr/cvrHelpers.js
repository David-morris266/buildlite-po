/**
 * BL-012B — CVR view models and formatting.
 */

import { formatMoney } from '../components/poDrawerHelpers';
import { buildCvrModel } from './cvrEngine';
import { getVarianceState } from './cvrCalculations';
import { getAdjustmentState } from './cvrForecastEngine';

export function formatCvrMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `£${formatMoney(n)}`;
}

function formatSignedCvrMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  if (n > 0) return `+£${formatMoney(n)}`;
  if (n < 0) return `-£${formatMoney(Math.abs(n))}`;
  return '£0.00';
}

export function formatCvrRow(row) {
  return {
    ...row,
    originalBudgetLabel: formatCvrMoney(row.originalBudget),
    currentBudgetLabel: formatCvrMoney(row.currentBudget),
    committedLabel: formatCvrMoney(row.committed),
    certifiedLabel: formatCvrMoney(row.certified),
    actualCostLabel: formatCvrMoney(row.actualCost),
    manualAccrualLabel: formatCvrMoney(row.manualAccrual),
    currentCostLabel: formatCvrMoney(row.currentCost),
    systemForecastLabel: formatCvrMoney(row.systemForecast),
    outstandingCertifiedLabel: formatCvrMoney(row.outstandingCertified),
    commercialAdjustmentLabel: formatSignedCvrMoney(row.commercialAdjustment),
    finalForecastLabel: formatCvrMoney(row.finalForecast),
    forecastFinalCostLabel: formatCvrMoney(row.finalForecast),
    costToCompleteLabel: formatCvrMoney(row.costToComplete),
    varianceLabel: formatCvrMoney(row.variance),
    varianceState: row.varianceState || getVarianceState(row.variance),
    adjustmentState: row.adjustmentState || getAdjustmentState(row.commercialAdjustment),
  };
}

export function formatCvrTotals(totals) {
  return {
    ...totals,
    originalBudgetLabel: formatCvrMoney(totals.originalBudget),
    currentBudgetLabel: formatCvrMoney(totals.currentBudget),
    committedLabel: formatCvrMoney(totals.committed),
    certifiedLabel: formatCvrMoney(totals.certified),
    actualCostLabel: formatCvrMoney(totals.actualCost),
    manualAccrualLabel: formatCvrMoney(totals.manualAccrual),
    currentCostLabel: formatCvrMoney(totals.currentCost),
    systemForecastLabel: formatCvrMoney(totals.systemForecast),
    outstandingCertifiedLabel: formatCvrMoney(totals.outstandingCertified),
    commercialAdjustmentLabel: formatSignedCvrMoney(totals.commercialAdjustment),
    finalForecastLabel: formatCvrMoney(totals.finalForecast),
    forecastFinalCostLabel: formatCvrMoney(totals.finalForecast),
    costToCompleteLabel: formatCvrMoney(totals.costToComplete),
    varianceLabel: formatCvrMoney(totals.variance),
    varianceState: getVarianceState(totals.variance),
    adjustmentState: getAdjustmentState(totals.commercialAdjustment),
  };
}

export function buildCvrWorkspaceModel(development, options = {}) {
  if (!development) return null;

  const periodKey = options.periodKey;
  const model = buildCvrModel(development.id, { ...options, periodKey });
  const { summary, totals } = model;
  const period = options.period || null;
  const historic = Boolean(model.historic);
  const historicUnavailable = Boolean(model.historicUnavailable);

  if (model.unavailable) {
    return {
      developmentId: development.id,
      developmentName: development.developmentName,
      developmentNumber: development.jobNumber,
      periodKey: model.periodKey,
      period,
      readOnly: Boolean(options.readOnly) || historicUnavailable,
      ready: false,
      unavailable: true,
      historic: false,
      historicUnavailable,
      loadState: model.loadState,
      error: model.error || null,
      rows: [],
      totals: formatCvrTotals(totals),
      developmentNotes: '',
      summaryCards: [],
    };
  }

  return {
    developmentId: development.id,
    developmentName: development.developmentName,
    developmentNumber: development.jobNumber,
    periodKey: model.periodKey,
    period,
    readOnly: Boolean(options.readOnly),
    ready: true,
    unavailable: false,
    historic,
    historicUnavailable: false,
    ledgerReady: model.ledgerReady !== false,
    rows: model.rows.map(formatCvrRow),
    totals: formatCvrTotals(totals),
    developmentNotes: model.developmentNotes,
    summaryCards: [
      {
        label: 'Original Budget',
        value: formatCvrMoney(summary.originalBudget),
        modifier: 'default',
      },
      {
        label: 'Current Budget',
        value: formatCvrMoney(summary.currentBudget),
        modifier: 'default',
      },
      {
        label: 'Committed',
        value: formatCvrMoney(summary.committed),
        modifier: 'muted',
      },
      {
        label: 'Certified',
        value: formatCvrMoney(summary.certified),
        modifier: 'default',
      },
      {
        label: 'Actual',
        value: formatCvrMoney(summary.actualCost),
        modifier: 'accent',
      },
      {
        label: 'Outstanding Certified (Not Yet in Ledger)',
        value: formatCvrMoney(summary.outstandingCertified),
        modifier: 'outstanding',
      },
      {
        label: 'System Forecast',
        value: formatCvrMoney(summary.systemForecast),
        modifier: 'default',
      },
      {
        label: 'Final Forecast',
        value: formatCvrMoney(summary.finalForecast),
        modifier: 'default',
      },
      {
        label: 'Cost To Complete',
        value: formatCvrMoney(summary.costToComplete),
        modifier: 'ctc',
      },
      {
        label: 'Variance',
        value: formatCvrMoney(summary.variance),
        modifier: getVarianceState(summary.variance),
      },
    ],
  };
}
