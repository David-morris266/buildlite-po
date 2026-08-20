/**
 * BL-015 — CVR Summary Page view model (executive dashboard layer).
 * Composes existing commercial engine outputs; no duplicate calculations.
 */

import { formatMoney, formatPoDate, formatPoDateTime } from '../components/poDrawerHelpers';
import { buildDevelopmentPackageSnapshot } from '../developments/developmentHelpers';
import { getPlots, getPlotCount } from '../developments/plotMaster';
import { buildSubcontractOrdersFromPos } from '../payments/subcontractOrders';
import { buildCvrModel } from './cvrEngine';
import { roundMoney, sumNullable, getVarianceState } from './cvrCalculations';
import { formatCvrMoney, formatCvrRow } from './cvrHelpers';
import { getCvrPeriodCommentary } from './costCentreStore';
import {
  getCvrPeriod,
  getLatestLockedCvrPeriod,
  listCvrPeriods,
} from './cvrPeriodStore';
import {
  canCreateNextCvrPeriod,
  getCvrPeriodStatusMeta,
  isCvrPeriodEditable,
  isCvrPeriodLocked,
  isCvrPeriodSubmitted,
  parsePeriodNumber,
  sortPeriodKeys,
} from './cvrPeriodStatus';

import {
  COMMERCIAL_HEADS,
  COMMERCIAL_FAMILIES,
  buildHierarchyKeyMap,
  migrateCostCentreHierarchy,
  normaliseCommercialFamily,
  normaliseCommercialHead,
  resolveRowCommercialHead,
} from './commercialReportingHierarchy';
import { getActiveHeadNames } from '../admin/commercialStructureStore';

export {
  COMMERCIAL_HEADS,
  COMMERCIAL_FAMILIES,
  buildHierarchyKeyMap,
  buildFamilyKeyMap,
  normaliseCommercialFamily,
  normaliseCommercialHead,
  resolveRowCommercialFamily,
  resolveRowCommercialHead,
  resolveRowTrade,
  migrateCostCentreHierarchy,
  validateCostCentreHierarchy,
} from './commercialReportingHierarchy';

/** @deprecated Use COMMERCIAL_HEADS for summary aggregation. */
export const LEGACY_SUMMARY_FAMILIES = COMMERCIAL_HEADS;

export function buildCommercialCostSummary(rows, periodCentres = [], cvrTotals = {}) {
  const hierarchyMap = buildHierarchyKeyMap(periodCentres);
  const headCatalog = getActiveHeadNames().length ? getActiveHeadNames() : COMMERCIAL_HEADS;
  const buckets = new Map(
    headCatalog.map((head) => [
      head,
      {
        budget: [],
        finalForecast: [],
        variance: [],
        costCodeKeys: [],
        families: new Set(),
        trades: new Set(),
      },
    ])
  );

  for (const row of rows) {
    const head = resolveRowCommercialHead(row.costCodeKey, hierarchyMap);
    const bucket = buckets.get(head);
    if (!bucket) continue;

    const hierarchy = hierarchyMap.get(row.costCodeKey);
    bucket.costCodeKeys.push(row.costCodeKey);
    if (hierarchy?.commercialFamily) bucket.families.add(hierarchy.commercialFamily);
    if (hierarchy?.trade) bucket.trades.add(hierarchy.trade);
    if (row.currentBudget != null) bucket.budget.push(row.currentBudget);
    if (row.finalForecast != null) bucket.finalForecast.push(row.finalForecast);
    if (row.variance != null) bucket.variance.push(row.variance);
  }

  const items = headCatalog.map((head) => {
    const bucket = buckets.get(head);
    const budget = sumNullable(bucket.budget);
    const finalForecast = sumNullable(bucket.finalForecast);
    const variance = sumNullable(bucket.variance);
    const hasData =
      bucket.costCodeKeys.length > 0 ||
      budget != null ||
      finalForecast != null ||
      variance != null;

    return {
      head,
      headKey: head,
      family: null,
      familyKey: null,
      drillDownLevel: 'head',
      families: [...bucket.families],
      trades: [...bucket.trades],
      budget,
      finalForecast,
      variance,
      budgetLabel: formatCvrMoney(budget),
      finalForecastLabel: formatCvrMoney(finalForecast),
      varianceLabel: formatCvrMoney(variance),
      varianceState: getVarianceState(variance),
      costCodeKeys: bucket.costCodeKeys,
      hasData,
    };
  }).filter((item) => item.hasData);

  const aggregatedBudget = sumNullable(items.map((item) => item.budget));
  const aggregatedForecast = sumNullable(items.map((item) => item.finalForecast));
  const aggregatedVariance = sumNullable(items.map((item) => item.variance));

  return {
    available: items.length > 0,
    emptyMessage:
      'Commercial Cost Summary will populate once cost codes are assigned to commercial heads.',
    items,
    totals: {
      budget: cvrTotals.currentBudget,
      finalForecast: cvrTotals.finalForecast,
      variance: cvrTotals.variance,
      budgetLabel: formatCvrMoney(cvrTotals.currentBudget),
      finalForecastLabel: formatCvrMoney(cvrTotals.finalForecast),
      varianceLabel: formatCvrMoney(cvrTotals.variance),
      varianceState: getVarianceState(cvrTotals.variance),
      aggregatedBudget,
      aggregatedForecast,
      aggregatedVariance,
      reconciles:
        aggregatedBudget === roundMoney(cvrTotals.currentBudget) &&
        aggregatedForecast === roundMoney(cvrTotals.finalForecast) &&
        aggregatedVariance === roundMoney(cvrTotals.variance),
    },
  };
}

function moneyValueExists(value) {
  if (value == null || value === '') return false;
  return roundMoney(value) != null;
}

export function formatProportionOfForecast(value, finalForecast) {
  if (!moneyValueExists(value) || !moneyValueExists(finalForecast)) return null;
  const amount = roundMoney(value);
  const forecast = roundMoney(finalForecast);
  if (forecast == null || forecast <= 0 || amount == null) return null;
  return `${Math.round((amount / forecast) * 100)}%`;
}

export function calculateCommittedNotCertified(committed, certified) {
  const c = roundMoney(committed) ?? 0;
  const cert = roundMoney(certified) ?? 0;
  return roundMoney(Math.max(0, c - cert));
}

export function calculateCertifiedNotInLedger(certified, actualCost) {
  const cert = roundMoney(certified) ?? 0;
  const actual = roundMoney(actualCost) ?? 0;
  return roundMoney(Math.max(0, cert - actual));
}

export function formatPeriodMovement(current, previous) {
  if (!moneyValueExists(current) || !moneyValueExists(previous)) return null;
  const currentValue = roundMoney(current);
  const previousValue = roundMoney(previous);
  if (currentValue == null || previousValue == null) return null;

  const delta = roundMoney(currentValue - previousValue);
  if (delta == null || Math.abs(delta) < 0.005) return null;

  const sign = delta > 0 ? '+' : '−';
  return `${sign}£${formatMoney(Math.abs(delta))} vs previous period`;
}

function getPreviousLockedPeriod(developmentId, periodKey) {
  const locked = listCvrPeriods(developmentId)
    .filter((period) => isCvrPeriodLocked(period))
    .sort((a, b) => parsePeriodNumber(a.periodKey) - parsePeriodNumber(b.periodKey));

  const currentNumber = parsePeriodNumber(periodKey);
  const previous = locked.filter((period) => parsePeriodNumber(period.periodKey) < currentNumber);
  return previous[previous.length - 1] || null;
}

function buildExecutiveKpis(summary, previousSummary) {
  const forecastCost = summary.finalForecast;
  const costToComplete = summary.costToComplete;
  const forecastVariance = summary.variance;

  return [
    {
      key: 'forecastCost',
      label: 'Forecast Cost',
      value: formatCvrMoney(forecastCost),
      movement: formatPeriodMovement(forecastCost, previousSummary?.finalForecast),
      modifier: 'primary',
      emphasis: 'hero',
    },
    {
      key: 'forecastRevenue',
      label: 'Forecast Revenue',
      value: '—',
      movement: null,
      modifier: 'pending',
      emphasis: 'future',
      hint: 'Revenue Engine not yet available',
    },
    {
      key: 'forecastProfit',
      label: 'Forecast Profit',
      value: '—',
      movement: null,
      modifier: 'pending',
      emphasis: 'future',
      hint: 'Requires Revenue Engine',
    },
    {
      key: 'forecastMargin',
      label: 'Forecast Margin',
      value: '—',
      movement: null,
      modifier: 'pending',
      emphasis: 'future',
      hint: 'Requires Revenue Engine',
    },
    {
      key: 'costToComplete',
      label: 'Cost To Complete',
      value: formatCvrMoney(costToComplete),
      movement: formatPeriodMovement(costToComplete, previousSummary?.costToComplete),
      modifier: 'ctc',
      emphasis: 'hero',
    },
    {
      key: 'forecastVariance',
      label: 'Forecast Variance',
      value: formatCvrMoney(forecastVariance),
      movement: formatPeriodMovement(forecastVariance, previousSummary?.variance),
      modifier:
        forecastVariance > 0.005
          ? 'saving'
          : forecastVariance < -0.005
            ? 'overspend'
            : 'neutral',
      emphasis: 'hero',
    },
  ];
}

function buildFinancialPosition(summary, { historic } = {}) {
  const finalForecast = summary.finalForecast;
  const committed = summary.committed;
  const certified = summary.certified;
  const actual = summary.actualCost;
  const committedNotCertified = calculateCommittedNotCertified(committed, certified);
  const certifiedNotInLedger = historic
    ? roundMoney(summary.outstandingCertified) ?? 0
    : calculateCertifiedNotInLedger(certified, actual);

  const items = [
    { key: 'committed', label: 'Committed', value: committed },
    { key: 'certified', label: 'Certified', value: certified },
    { key: 'actual', label: 'Actual', value: actual },
    {
      key: 'certifiedNotInLedger',
      label: 'Certified Not in Ledger',
      value: certifiedNotInLedger,
      modifier: certifiedNotInLedger > 0.005 ? 'outstanding' : 'default',
    },
    {
      key: 'committedNotCertified',
      label: 'Committed Not Certified',
      value: committedNotCertified,
    },
  ];

  return items.map((item) => ({
    ...item,
    valueLabel: formatCvrMoney(item.value),
    proportionLabel: formatProportionOfForecast(item.value, finalForecast),
  }));
}

function buildDevelopmentSummaryPanel(development, pos = []) {
  const plots = getPlots(development.id);
  const plotCount = getPlotCount(development);
  const activePlots = plots.filter(
    (plot) => String(plot.status || 'Active').toLowerCase() !== 'inactive'
  ).length;
  const configurations = new Set(
    plots.map((plot) => plot.configuration || plot.houseType).filter(Boolean)
  );
  const snapshot = buildDevelopmentPackageSnapshot(development.id, pos);

  return {
    totalPlots: plotCount,
    plotMasterImported: plotCount > 0,
    plotMasterLabel: plotCount > 0 ? `${plotCount} plots imported` : 'Not imported',
    activePlots,
    configurationCount: configurations.size,
    configurationLabel:
      configurations.size > 0 ? `${configurations.size} configurations` : '—',
    purchaseOrderCount: snapshot.purchaseOrderCount,
    packageCount: snapshot.packageCount,
    certificateCount: snapshot.certificateCount,
    salesReady: false,
    emptySalesHint: 'Sales KPIs will appear when the Sales and Revenue module is available.',
  };
}

function formatVariancePercent(variance, currentBudget) {
  const budget = roundMoney(currentBudget);
  const value = roundMoney(variance);
  if (budget == null || Math.abs(budget) < 0.005 || value == null) return null;
  return `${Math.round((value / budget) * 100)}%`;
}

export function buildTopCostVariances(rows, limit = 5) {
  const ranked = rows
    .filter((row) => row.variance != null)
    .map((row) => ({
      id: row.id,
      costCodeKey: row.costCodeKey,
      costCodeLabel: row.costCodeLabel,
      description: row.description || row.costCodeLabel,
      currentBudget: row.currentBudget,
      currentBudgetLabel: row.currentBudgetLabel,
      finalForecast: row.finalForecast,
      finalForecastLabel: row.finalForecastLabel,
      variance: row.variance,
      varianceLabel: row.varianceLabel,
      varianceState: row.varianceState,
      variancePercentLabel: formatVariancePercent(row.variance, row.currentBudget),
      isAdverse: Number(row.variance) < -0.005,
      isFavourable: Number(row.variance) > 0.005,
      rankValue: Math.abs(Number(row.variance) || 0),
    }))
    .sort((a, b) => {
      if (a.isAdverse !== b.isAdverse) return a.isAdverse ? -1 : 1;
      return b.rankValue - a.rankValue;
    });

  return ranked.slice(0, limit);
}

export function buildCommercialExceptions(rows, summary, { historic } = {}) {
  const negativeCtcRows = rows.filter((row) => Number(row.costToComplete) < -0.005);
  const overBudgetRows = rows.filter((row) => Number(row.variance) < -0.005);
  const adjustmentRows = rows.filter(
    (row) => Math.abs(Number(row.commercialAdjustment) || 0) > 0.005
  );
  const missingBudgetRows = rows.filter((row) => {
    const budget = roundMoney(row.currentBudget);
    const committed = roundMoney(row.committed) ?? 0;
    const actual = roundMoney(row.actualCost) ?? 0;
    return (budget == null || budget === 0) && (committed > 0.005 || actual > 0.005);
  });

  const certifiedNotInLedger = historic
    ? roundMoney(summary.outstandingCertified) ?? 0
    : calculateCertifiedNotInLedger(summary.certified, summary.actualCost);
  const adjustmentTotal = roundMoney(
    adjustmentRows.reduce((sum, row) => sum + (Number(row.commercialAdjustment) || 0), 0)
  );

  return [
    {
      key: 'negativeCtc',
      label: 'Negative Cost To Complete',
      count: negativeCtcRows.length,
      valueLabel: formatCvrMoney(
        roundMoney(negativeCtcRows.reduce((sum, row) => sum + (Number(row.costToComplete) || 0), 0))
      ),
      rows: negativeCtcRows,
    },
    {
      key: 'overBudget',
      label: 'Cost Codes Over Budget',
      count: overBudgetRows.length,
      valueLabel: formatCvrMoney(
        roundMoney(overBudgetRows.reduce((sum, row) => sum + Math.abs(Number(row.variance) || 0), 0))
      ),
      rows: overBudgetRows,
    },
    {
      key: 'adjustments',
      label: 'Commercial Adjustments',
      count: adjustmentRows.length,
      valueLabel: formatCvrMoney(adjustmentTotal),
      rows: adjustmentRows,
    },
    {
      key: 'certifiedNotInLedger',
      label: 'Certified Not in Ledger',
      count: certifiedNotInLedger > 0.005 ? 1 : 0,
      valueLabel: formatCvrMoney(certifiedNotInLedger),
      rows: rows.filter((row) => Number(row.outstandingCertified) > 0.005),
    },
    {
      key: 'journals',
      label: 'Open Commercial Journals',
      count: 0,
      valueLabel: 'Not yet available',
      rows: [],
      unavailable: true,
    },
    {
      key: 'missingBudget',
      label: 'Missing Budget',
      count: missingBudgetRows.length,
      valueLabel: formatCvrMoney(
        roundMoney(
          missingBudgetRows.reduce(
            (sum, row) => sum + Math.max(Number(row.committed) || 0, Number(row.actualCost) || 0),
            0
          )
        )
      ),
      rows: missingBudgetRows,
    },
  ];
}

export function buildPackageAttentionList(developmentId, pos = [], limit = 5) {
  const orders = buildSubcontractOrdersFromPos(pos).filter(
    (order) => order.developmentId === developmentId
  );

  const attention = [];

  for (const order of orders) {
    const reasons = [];
    if (order.matrixReady === false) {
      continue;
    }
    if (!order.hasMatrix) {
      reasons.push('Approved subcontract PO — order matrix not imported');
    }
    if ((Number(order.certificateCount) || 0) === 0 && (Number(order.committedValue) || 0) > 0) {
      reasons.push('No approved certificate');
    }
    if (order.status?.modifier === 'matrix-required') {
      reasons.push('Package setup required');
    }
    if (!order.supplierLabel || !order.costCode) {
      reasons.push('Package record incomplete');
    }

    if (!reasons.length) continue;

    attention.push({
      orderKey: order.orderKey,
      packageLabel: `${order.costCode || '—'} · ${order.supplierLabel || '—'}`,
      supplierLabel: order.supplierLabel || '—',
      costCode: order.costCode,
      committedLabel: formatCvrMoney(order.committedValue),
      certifiedLabel: formatCvrMoney(order.certifiedToDate),
      statusLabel: order.status?.label || '—',
      reason: reasons[0],
      reasons,
      rankValue: Number(order.committedValue) || 0,
    });
  }

  return attention.sort((a, b) => b.rankValue - a.rankValue).slice(0, limit);
}

function buildForecastMovement(developmentId, pos = []) {
  const periods = listCvrPeriods(developmentId);
  if (periods.length < 2) {
    return {
      available: false,
      emptyMessage:
        'Forecast movement will appear after the next CVR period is created.',
      rows: [],
    };
  }

  const rows = sortPeriodKeys(periods.map((item) => item.periodKey)).map((periodKey) => {
    const period = getCvrPeriod(developmentId, periodKey);
    const model = buildCvrModel(developmentId, { pos, periodKey });
    return {
      periodKey,
      status: getCvrPeriodStatusMeta(period.status).label,
      finalForecastLabel: formatCvrMoney(model.summary.finalForecast),
      currentBudgetLabel: formatCvrMoney(model.summary.currentBudget),
      actualCostLabel: formatCvrMoney(model.summary.actualCost),
      finalForecast: model.summary.finalForecast,
      currentBudget: model.summary.currentBudget,
      actualCost: model.summary.actualCost,
    };
  });

  return { available: true, emptyMessage: null, rows };
}

function normaliseCategoryLabel(family) {
  const value = String(family || '').trim();
  if (!value) return 'Other';
  if (value.toLowerCase() === 'direct cost') return 'Direct Costs';
  return value;
}

export function buildForecastBreakdown(developmentId, periodKey, rows, centres = []) {
  const hierarchyByKey = new Map(
    centres.map((centre) => [
      centre.costCodeKey,
      {
        family: normaliseCategoryLabel(centre.commercialFamily),
        reportingGroup: String(centre.trade || '').trim() || normaliseCategoryLabel(centre.description),
      },
    ])
  );

  const hasFamilyData = centres.some((centre) => String(centre.commercialFamily || '').trim());
  const hasReportingGroupData = centres.some((centre) => String(centre.trade || '').trim());

  if (!hasFamilyData && !hasReportingGroupData) {
    return {
      available: false,
      emptyMessage:
        'Forecast breakdown by commercial category will appear once cost codes include reporting groups or commercial families.',
      items: [],
    };
  }

  const buckets = new Map();
  for (const row of rows) {
    const hierarchy = hierarchyByKey.get(row.costCodeKey) || {};
    const label = hasFamilyData
      ? hierarchy.family || 'Other'
      : hierarchy.reportingGroup || 'Other';
    const forecast = roundMoney(row.finalForecast);
    if (forecast == null) continue;
    buckets.set(label, (buckets.get(label) || 0) + forecast);
  }

  if (!buckets.size) {
    return {
      available: false,
      emptyMessage: 'No forecast values available for category breakdown.',
      items: [],
    };
  }

  const total = [...buckets.values()].reduce((sum, value) => sum + value, 0);
  const items = [...buckets.entries()]
    .map(([label, value]) => ({
      label,
      value,
      valueLabel: formatCvrMoney(value),
      proportionLabel:
        total > 0 ? `${Math.round((value / total) * 100)}%` : null,
      sortOrder:
        COMMERCIAL_FAMILIES.indexOf(normaliseCommercialFamily(label)) >= 0
          ? COMMERCIAL_FAMILIES.indexOf(normaliseCommercialFamily(label))
          : COMMERCIAL_FAMILIES.length,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || b.value - a.value);

  return { available: true, emptyMessage: null, items, totalLabel: formatCvrMoney(total) };
}

const AUDIT_ACTION_LABELS = {
  created: 'CVR Created',
  submitted: 'CVR Submitted',
  approved: 'CVR Approved',
  locked: 'CVR Locked',
  rejected: 'CVR Rejected',
  commentary_updated: 'Commercial Commentary Updated',
};

export function buildRecentCommercialActivity(period, rows = []) {
  const items = [];

  for (const entry of period?.auditHistory || []) {
    items.push({
      id: entry.id,
      type: entry.action,
      label: AUDIT_ACTION_LABELS[entry.action] || entry.action,
      actor: entry.actor || '—',
      at: entry.at,
      dateTimeLabel: formatPoDateTime(entry.at),
      description: entry.comment || '',
    });
  }

  for (const row of rows) {
    for (const entry of row.adjustmentHistory || []) {
      items.push({
        id: entry.id,
        type: 'adjustment',
        label: 'Commercial Adjustment changed',
        actor: entry.user || '—',
        at: entry.date,
        dateTimeLabel: formatPoDateTime(entry.date),
        description: `${row.costCodeLabel}: ${entry.reason || '—'}`,
      });
    }
  }

  return items
    .filter((item) => item.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 20);
}

function buildWorkflowActions(period, developmentId) {
  const draft = isCvrPeriodEditable(period);
  const submitted = isCvrPeriodSubmitted(period);
  const locked = isCvrPeriodLocked(period);
  const canCreateNext = canCreateNextCvrPeriod(listCvrPeriods(developmentId)).ok;

  return {
    showContinue: true,
    continueLabel: draft ? 'Continue to CVR' : submitted ? 'Open CVR Read Only' : 'View Locked CVR',
    showSubmit: draft,
    showApprove: submitted,
    showReject: submitted,
    showCreateNext: locked && canCreateNext,
  };
}

export function buildCvrSummaryModel(development, options = {}) {
  const developmentId = development.id;
  const periodKey = options.periodKey;
  const pos = options.pos || [];
  const period = options.period || getCvrPeriod(developmentId, periodKey);
  const model = buildCvrModel(developmentId, { pos, periodKey, period });
  const historicUnavailable = Boolean(model.historicUnavailable);
  const historic = Boolean(model.historic);

  if ((model.unavailable || period?.unavailable) && !historicUnavailable) {
    return {
      developmentId,
      developmentName: development.developmentName,
      developmentNumber: development.jobNumber,
      periodKey,
      periodLabel: periodKey,
      ready: false,
      unavailable: true,
      historic: false,
      historicUnavailable: false,
      loadState: model.loadState || period?.loadState,
      error: model.error || period?.error || null,
      status: null,
      readOnly: true,
      header: {
        developmentName: development.developmentName,
        developmentNumber: development.jobNumber || '—',
        periodKey,
        periodLabel: periodKey,
        status: null,
        createdLabel: '—',
        submittedLabel: '—',
        approvedLabel: '—',
        approvedBy: '—',
        lastUpdatedLabel: '—',
        commercialManager: '—',
      },
      workflow: {
        showContinue: false,
        continueLabel: 'Continue to CVR',
        showSubmit: false,
        showApprove: false,
        showReject: false,
        showCreateNext: false,
      },
      kpis: [],
      financialPosition: [],
      developmentSummary: [],
      topVariances: [],
      commercialExceptions: [],
      commercialCostSummary: [],
      recentActivity: [],
      commentary: {
        keyCommercialIssues: '',
        commercialOpportunities: '',
        financialRisks: '',
        actionsBeforeNextCvr: '',
      },
      rows: [],
      summary: model.summary,
      period,
      previousLockedPeriodKey: null,
    };
  }

  if (historicUnavailable) {
    const status = getCvrPeriodStatusMeta(period?.status);
    return {
      developmentId,
      developmentName: development.developmentName,
      developmentNumber: development.jobNumber,
      periodKey,
      periodLabel: periodKey,
      ready: false,
      unavailable: true,
      historic: false,
      historicUnavailable: true,
      loadState: 'loaded',
      error: null,
      status,
      readOnly: true,
      header: {
        developmentName: development.developmentName,
        developmentNumber: development.jobNumber || '—',
        periodKey,
        periodLabel: periodKey,
        status,
        createdLabel: period?.createdAt ? formatPoDate(period.createdAt) : '—',
        submittedLabel: period?.submittedAt ? formatPoDate(period.submittedAt) : '—',
        approvedLabel: period?.approvedAt ? formatPoDate(period.approvedAt) : '—',
        approvedBy: period?.approvedBy || '—',
        lastUpdatedLabel: formatPoDateTime(period?.updatedAt || period?.createdAt),
        commercialManager: period?.submittedBy || period?.createdBy || '—',
      },
      workflow: buildWorkflowActions(period, developmentId),
      kpis: [],
      financialPosition: [],
      developmentSummary: [],
      topVariances: [],
      commercialExceptions: [],
      commercialCostSummary: [],
      recentActivity: [],
      commentary: getCvrPeriodCommentary(developmentId, periodKey),
      rows: [],
      summary: model.summary,
      period,
      previousLockedPeriodKey: null,
    };
  }

  const rows = model.rows.map(formatCvrRow);
  const summary = model.summary;
  const previousLocked = getPreviousLockedPeriod(developmentId, periodKey);
  const previousModel = previousLocked
    ? buildCvrModel(developmentId, { pos, periodKey: previousLocked.periodKey })
    : null;
  const previousSummary =
    previousModel?.unavailable || previousModel?.historicUnavailable
      ? null
      : previousModel?.summary;
  const centres = historic
    ? rows
    : model.rows
        .map((row) => {
          const manual = period.costCentres?.find(
            (centre) => centre.costCodeKey === row.costCodeKey && centre.active !== false
          );
          return manual || null;
        })
        .filter(Boolean);

  const status = getCvrPeriodStatusMeta(period.status);
  const readOnly = !isCvrPeriodEditable(period);

  return {
    developmentId,
    developmentName: development.developmentName,
    developmentNumber: development.jobNumber,
    periodKey,
    periodLabel: periodKey,
    ready: true,
    unavailable: false,
    historic,
    historicUnavailable: false,
    status,
    readOnly,
    header: {
      developmentName: development.developmentName,
      developmentNumber: development.jobNumber || '—',
      periodKey,
      periodLabel: periodKey,
      status,
      createdLabel: formatPoDate(period.createdAt),
      submittedLabel: period.submittedAt ? formatPoDate(period.submittedAt) : '—',
      approvedLabel: period.approvedAt ? formatPoDate(period.approvedAt) : '—',
      approvedBy: period.approvedBy || '—',
      lastUpdatedLabel: formatPoDateTime(period.updatedAt || period.createdAt),
      commercialManager: period.submittedBy || period.createdBy || '—',
    },
    workflow: buildWorkflowActions(period, developmentId),
    kpis: buildExecutiveKpis(summary, previousSummary),
    financialPosition: buildFinancialPosition(summary, { historic }),
    developmentSummary: buildDevelopmentSummaryPanel(development, historic ? [] : pos),
    topVariances: buildTopCostVariances(rows),
    commercialExceptions: buildCommercialExceptions(rows, summary, { historic }),
    commercialCostSummary: buildCommercialCostSummary(
      rows,
      historic ? rows : period.costCentres || centres,
      model.totals
    ),
    recentActivity: buildRecentCommercialActivity(period, rows),
    commentary: getCvrPeriodCommentary(developmentId, periodKey),
    rows,
    summary,
    period,
    previousLockedPeriodKey: previousLocked?.periodKey || null,
  };
}

export { getLatestLockedCvrPeriod };
