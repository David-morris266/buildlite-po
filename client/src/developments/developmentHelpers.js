import { formatMoney, formatPoDate } from '../components/poDrawerHelpers';
import { getDevelopmentStatusMeta } from './developmentStore';
import { getPlotCount } from './plotMaster';
import { getTotalActualCost, getTransactionCount } from '../ledger/ledgerTransactionStore';

export function formatDevelopmentListRow(development) {
  const status = getDevelopmentStatusMeta(development.status);
  return {
    ...development,
    statusMeta: status,
    lastUpdatedLabel: formatPoDate(development.updatedAt),
    plotsLabel: getPlotCount(development) > 0 ? getPlotCount(development) : '—',
    packagesLabel: development.packageCount > 0 ? development.packageCount : '—',
  };
}

export function formatPlotsSummary(plotCount) {
  const count = Number(plotCount) || 0;
  return `${count} plot${count === 1 ? '' : 's'} imported`;
}

export function buildDevelopmentWorkspaceModel(development) {
  if (!development) return null;

  const status = getDevelopmentStatusMeta(development.status);

  const plotCount = getPlotCount(development);
  const ledgerTransactionCount = getTransactionCount(development.id);
  const actualCost = getTotalActualCost(development.id);

  return {
    ...development,
    statusMeta: status,
    plotCount,
    ledgerTransactionCount,
    actualCost,
    summaryCards: [
      {
        label: 'Plots',
        value: formatPlotsSummary(plotCount),
        modifier: 'default',
      },
      {
        label: 'Purchase Orders',
        value:
          development.purchaseOrderCount > 0
            ? String(development.purchaseOrderCount)
            : '—',
        modifier: 'default',
      },
      {
        label: 'Packages',
        value:
          development.packageCount > 0 ? String(development.packageCount) : '—',
        modifier: 'default',
      },
      {
        label: 'Certificates',
        value:
          development.certificateCount > 0
            ? String(development.certificateCount)
            : '—',
        modifier: 'muted',
      },
      {
        label: 'Forecast',
        value: '—',
        modifier: 'muted',
      },
    ],
    commercialCards: [
      { label: 'Committed value', value: '—' },
      { label: 'Certified to date', value: '—' },
      { label: 'Actual cost', value: actualCost > 0 ? `£${formatMoney(actualCost)}` : '—' },
      { label: 'Overall progress', value: '—' },
    ],
  };
}
