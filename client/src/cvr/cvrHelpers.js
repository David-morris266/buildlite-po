/**
 * BL-012B — CVR view models and formatting.
 */

import { formatMoney } from '../components/poDrawerHelpers';
import { buildCvrModel } from './cvrEngine';
import { getVarianceState } from './cvrCalculations';

export function formatCvrMoney(value) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `£${formatMoney(n)}`;
}

export function formatCvrRow(row) {
  return {
    ...row,
    originalBudgetLabel: formatCvrMoney(row.originalBudget),
    currentBudgetLabel: formatCvrMoney(row.currentBudget),
    committedLabel: formatCvrMoney(row.committed),
    actualCostLabel: formatCvrMoney(row.actualCost),
    forecastFinalCostLabel: formatCvrMoney(row.forecastFinalCost),
    costToCompleteLabel: formatCvrMoney(row.costToComplete),
    varianceLabel: formatCvrMoney(row.variance),
    varianceState: row.varianceState || getVarianceState(row.variance),
  };
}

export function buildCvrWorkspaceModel(development, options = {}) {
  if (!development) return null;

  const model = buildCvrModel(development.id, options);
  const { summary, totals } = model;

  return {
    developmentId: development.id,
    developmentName: development.developmentName,
    developmentNumber: development.jobNumber,
    periodKey: model.periodKey,
    rows: model.rows.map(formatCvrRow),
    totals: {
      ...totals,
      originalBudgetLabel: formatCvrMoney(totals.originalBudget),
      currentBudgetLabel: formatCvrMoney(totals.currentBudget),
      committedLabel: formatCvrMoney(totals.committed),
      actualCostLabel: formatCvrMoney(totals.actualCost),
      forecastFinalCostLabel: formatCvrMoney(totals.forecastFinalCost),
      costToCompleteLabel: formatCvrMoney(totals.costToComplete),
      varianceLabel: formatCvrMoney(totals.variance),
      varianceState: getVarianceState(totals.variance),
    },
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
        label: 'Actual Cost',
        value: formatCvrMoney(summary.actualCost),
        modifier: 'accent',
      },
      {
        label: 'Forecast Final Cost',
        value: formatCvrMoney(summary.forecastFinalCost),
        modifier: 'default',
      },
      {
        label: 'Variance',
        value: formatCvrMoney(summary.variance),
        modifier: getVarianceState(summary.variance),
      },
      {
        label: 'Cost To Complete',
        value: formatCvrMoney(summary.costToComplete),
        modifier: 'muted',
      },
      {
        label: 'Gross Margin',
        value: '—',
        modifier: 'muted',
      },
    ],
  };
}
