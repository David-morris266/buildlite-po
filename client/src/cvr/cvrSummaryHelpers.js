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
} from './cvrPeriodStatus';
import { CVR_HISTORIC_REVENUE_UNAVAILABLE } from './cvrHistoricConstants';
import {
  buildCvrCommercialPosition,
  formatCvrGrossMarginPercent,
  previousRevenueForMovement,
} from './cvrCommercialPosition';
import { snapshotHasFrozenRevenue } from './cvrSnapshotMapper';
import {
  buildCvrPeriodComparison,
  findPreviousLockedCvrPeriod,
  formatSignedMovement,
} from './cvrPeriodMovement';

import {
  COMMERCIAL_HEADS,
  COMMERCIAL_FAMILIES,
  normaliseCommercialFamily,
} from './commercialReportingHierarchy';
import { buildCvrCommercialHierarchyPresentation } from './cvrCommercialHierarchyPresentation';

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

export function buildCommercialCostSummary(rows, period = {}, cvrTotals = {}) {
  const presentation = buildCvrCommercialHierarchyPresentation(rows, period);
  const items = presentation.items.map((bucket) => {
    const financialRows = bucket.rows.map(({ row }) => row);
    const budget = sumNullable(financialRows.map((row) => row.currentBudget));
    const finalForecast = sumNullable(financialRows.map((row) => row.finalForecast));
    const variance = sumNullable(financialRows.map((row) => row.variance));
    return {
      head: bucket.label,
      headKey: bucket.key,
      headId: bucket.headId,
      kind: bucket.kind,
      resolutionStates: bucket.resolutionStates,
      families: bucket.families,
      reportingGroups: bucket.reportingGroups,
      budget,
      finalForecast,
      variance,
      budgetLabel: formatCvrMoney(budget),
      finalForecastLabel: formatCvrMoney(finalForecast),
      varianceLabel: formatCvrMoney(variance),
      varianceState: getVarianceState(variance),
      costCodeKeys: bucket.filter.costCodeKeys,
      filter: bucket.filter,
      hasData: true,
    };
  });

  const aggregatedBudget = sumNullable(items.map((item) => item.budget));
  const aggregatedForecast = sumNullable(items.map((item) => item.finalForecast));
  const aggregatedVariance = sumNullable(items.map((item) => item.variance));

  return {
    available: items.length > 0,
    authorityState: presentation.authorityState,
    rowCount: presentation.rowCount,
    assignedRowCount: presentation.assignedRowCount,
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

function movementBucketMap(rows, period) {
  const presentation = buildCvrCommercialHierarchyPresentation(rows, period);
  return new Map(presentation.items.map((bucket) => {
    const financialRows = bucket.rows.map(({ row }) => row);
    return [bucket.key, {
      bucket,
      forecast: sumNullable(financialRows.map((row) => row.finalForecast)) ?? 0,
      budget: sumNullable(financialRows.map((row) => row.currentBudget)) ?? 0,
      variance: sumNullable(financialRows.map((row) => row.variance)) ?? 0,
    }];
  }));
}

export function buildCommercialCostMovementSummary({
  currentRows = [], previousRows = [], currentPeriod = {}, previousPeriod = null,
  currentTotals = {}, movementReport = null,
} = {}) {
  const current = movementBucketMap(currentRows, currentPeriod);
  const previous = movementReport?.available ? movementBucketMap(previousRows, previousPeriod) : new Map();
  const keys = [...new Set([...current.keys(), ...previous.keys()])];
  const changedRows = (movementReport?.rows || []).filter((row) => row.hierarchyChanged);
  const items = keys.map((key) => {
    const now = current.get(key);
    const prior = previous.get(key);
    const bucket = now?.bucket || prior?.bucket;
    const currentForecast = now?.forecast ?? 0;
    const previousForecast = movementReport?.available ? prior?.forecast ?? 0 : null;
    const movement = previousForecast == null ? null : roundMoney(currentForecast - previousForecast);
    const costCodeKeys = [...new Set([...(now?.bucket.filter.costCodeKeys || []), ...(prior?.bucket.filter.costCodeKeys || [])])];
    const bucketHeadId = bucket.headId || null;
    const hierarchyChanged = changedRows.some((row) => {
      const currentHeadId = row.currentHierarchy?.ids?.[0] || null;
      const previousHeadId = row.previousHierarchy?.ids?.[0] || null;
      return bucketHeadId ? currentHeadId === bucketHeadId || previousHeadId === bucketHeadId : costCodeKeys.includes(row.costCodeKey);
    });
    return {
      head: bucket.label, headKey: key, headId: bucket.headId, kind: bucket.kind,
      resolutionStates: bucket.resolutionStates, families: bucket.families, reportingGroups: bucket.reportingGroups,
      budget: now?.budget ?? 0, previousForecast, currentForecast, movement,
      finalForecast: currentForecast, variance: now?.variance ?? 0,
      budgetLabel: formatCvrMoney(now?.budget ?? 0), previousForecastLabel: formatCvrMoney(previousForecast),
      currentForecastLabel: formatCvrMoney(currentForecast), movementLabel: formatSignedMovement(movement),
      finalForecastLabel: formatCvrMoney(currentForecast), varianceLabel: formatCvrMoney(now?.variance ?? 0),
      varianceState: getVarianceState(now?.variance ?? 0), movementState: movement > 0 ? 'adverse' : movement < 0 ? 'favourable' : 'neutral',
      hierarchyChanged, costCodeKeys,
      filter: { ...bucket.filter, costCodeKeys }, hasData: true,
    };
  });
  const totals = {
    budget: currentTotals.currentBudget,
    previousForecast: movementReport?.available ? roundMoney(previousRows.reduce((sum, row) => sum + (Number(row.finalForecast) || 0), 0)) : null,
    currentForecast: currentTotals.finalForecast,
    movement: movementReport?.totalMovement ?? null,
    variance: currentTotals.variance,
  };
  Object.assign(totals, {
    budgetLabel: formatCvrMoney(totals.budget), previousForecastLabel: formatCvrMoney(totals.previousForecast),
    currentForecastLabel: formatCvrMoney(totals.currentForecast), movementLabel: formatSignedMovement(totals.movement),
    varianceLabel: formatCvrMoney(totals.variance), varianceState: getVarianceState(totals.variance),
    movementState: totals.movement > 0 ? 'adverse' : totals.movement < 0 ? 'favourable' : 'neutral',
    reconciles: roundMoney(items.reduce((sum, item) => sum + item.currentForecast, 0)) === roundMoney(totals.currentForecast)
      && (totals.previousForecast == null || roundMoney(items.reduce((sum, item) => sum + (item.previousForecast || 0), 0)) === roundMoney(totals.previousForecast))
      && (totals.movement == null || roundMoney(items.reduce((sum, item) => sum + (item.movement || 0), 0)) === roundMoney(totals.movement)),
  });
  return { available: items.length > 0, emptyMessage: 'Commercial Cost Summary will populate once Cost Codes are available.', items, totals };
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

export function formatMarginPointMovement(current, previous) {
  if (current == null || previous == null) return null;
  const currentValue = Number(current);
  const previousValue = Number(previous);
  if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;
  const delta = currentValue - previousValue;
  if (Math.abs(delta) < 0.05) return null;
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toFixed(1)}pp vs previous period`;
}

function formatRevenueMovement(current, previousCommercial, key) {
  if (!previousCommercial?.revenueAvailable) return null;
  return formatPeriodMovement(current, previousRevenueForMovement(previousCommercial, key));
}

function profitModifier(value) {
  if (value == null) return 'pending';
  if (value > 0.005) return 'saving';
  if (value < -0.005) return 'overspend';
  return 'neutral';
}

function buildExecutiveKpis(summary, previousSummary, commercial, previousCommercial) {
  const forecastCost = summary.finalForecast;
  const costToComplete = summary.costToComplete;
  const forecastVariance = summary.variance;
  const revenueHint = commercial.revenueAvailable ? null : commercial.hint;
  const profitHint = commercial.grossProfitAvailable ? null : commercial.profitHint;
  const marginHint = commercial.grossMarginAvailable ? null : commercial.profitHint;

  return [
    {
      key: 'forecastRevenue',
      label: 'Forecast Revenue',
      value: formatCvrMoney(commercial.forecastRevenue),
      movement: formatRevenueMovement(
        commercial.forecastRevenue,
        previousCommercial,
        'forecastRevenue'
      ),
      modifier: commercial.revenueAvailable ? 'primary' : 'pending',
      emphasis: 'hero',
      hint: revenueHint,
    },
    {
      key: 'forecastCost',
      label: 'Forecast Cost',
      value: formatCvrMoney(forecastCost),
      movement: formatPeriodMovement(forecastCost, previousSummary?.finalForecast),
      modifier: 'primary',
      emphasis: 'hero',
    },
    {
      key: 'forecastProfit',
      label: 'Gross Profit',
      value: formatCvrMoney(commercial.grossProfit),
      movement: formatRevenueMovement(commercial.grossProfit, previousCommercial, 'grossProfit'),
      modifier: profitModifier(commercial.grossProfit),
      emphasis: 'hero',
      hint: profitHint,
    },
    {
      key: 'forecastMargin',
      label: 'Gross Margin',
      value: commercial.grossMarginAvailable
        ? formatCvrGrossMarginPercent(commercial.grossMarginPercent)
        : '—',
      movement: previousCommercial?.revenueAvailable
        ? formatMarginPointMovement(
            commercial.grossMarginPercent,
            previousCommercial.grossMarginPercent
          )
        : null,
      modifier: profitModifier(commercial.grossProfit),
      emphasis: 'hero',
      hint: marginHint,
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
    {
      key: 'securedRevenue',
      label: 'Secured Revenue',
      value: formatCvrMoney(commercial.securedRevenue),
      movement: formatRevenueMovement(
        commercial.securedRevenue,
        previousCommercial,
        'securedRevenue'
      ),
      modifier: commercial.revenueAvailable ? 'neutral' : 'pending',
      emphasis: 'supporting',
      hint: revenueHint,
    },
    {
      key: 'remainingForecast',
      label: 'Remaining Forecast',
      value: formatCvrMoney(commercial.remainingForecast),
      movement: formatRevenueMovement(
        commercial.remainingForecast,
        previousCommercial,
        'remainingForecast'
      ),
      modifier: commercial.revenueAvailable ? 'neutral' : 'pending',
      emphasis: 'supporting',
      hint: revenueHint,
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

function formatHistoricRevenuePlotRow(plot) {
  if (!plot) return null;
  const category = plot.tenure || plot.revenueCategory || '';
  return {
    plotId: plot.plotId,
    plotNumber: plot.plotNumber || '',
    houseType: plot.houseType || '',
    category,
    revenueStatus: plot.revenueStatus || '',
    forecastRevenue: plot.forecastRevenue,
    securedRevenue: plot.securedRevenue,
    remainingForecastRevenue: plot.remainingForecastRevenue,
    sellingPrice: plot.sellingPrice,
    forecastRevenueLabel: formatCvrMoney(plot.forecastRevenue),
    securedRevenueLabel: formatCvrMoney(plot.securedRevenue),
    remainingForecastRevenueLabel: formatCvrMoney(plot.remainingForecastRevenue),
    sellingPriceLabel: formatCvrMoney(plot.sellingPrice),
  };
}

function buildHistoricRevenuePlots(snapshot, historic) {
  if (!historic || !snapshotHasFrozenRevenue(snapshot)) {
    return { available: false, rows: [], emptyMessage: null };
  }
  const rows = (snapshot.plots || []).map(formatHistoricRevenuePlotRow).filter(Boolean);
  return {
    available: true,
    rows,
    emptyMessage: rows.length ? null : 'No plot revenue rows were frozen in this CVR.',
  };
}

function buildDevelopmentSummaryPanel(development, pos = [], commercial = {}) {
  const plots = getPlots(development.id);
  const plotCount = getPlotCount(development);
  const activePlots = plots.filter(
    (plot) => String(plot.status || 'Active').toLowerCase() !== 'inactive'
  ).length;
  const configurations = new Set(
    plots.map((plot) => plot.configuration || plot.houseType).filter(Boolean)
  );
  const snapshot = buildDevelopmentPackageSnapshot(development.id, pos);
  const salesReady = Boolean(commercial.revenueAvailable);
  const plotsSoldLabel = salesReady ? String(commercial.plotsSold ?? 0) : '—';
  let emptySalesHint = null;
  if (commercial.historicRevenueUnavailable) {
    emptySalesHint = CVR_HISTORIC_REVENUE_UNAVAILABLE;
  } else if (!salesReady) {
    emptySalesHint = commercial.hint || 'Revenue unavailable';
  }

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
    salesReady,
    plotsSold: salesReady ? commercial.plotsSold ?? 0 : null,
    plotsSoldLabel,
    emptySalesHint,
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
      ...row,
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
    showApprove: submitted && period?.variationExposure?.stale !== true,
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
      historicRevenuePlots: { available: false, rows: [], emptyMessage: null },
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
      historicRevenuePlots: { available: false, rows: [], emptyMessage: null },
      period,
      previousLockedPeriodKey: null,
    };
  }

  const rows = model.rows.map(formatCvrRow);
  const summary = model.summary;
  const previousLocked = findPreviousLockedCvrPeriod(developmentId, periodKey);
  const previousModel = previousLocked
    ? buildCvrModel(developmentId, { pos, periodKey: previousLocked.periodKey })
    : null;
  const previousSummary =
    previousModel?.unavailable || previousModel?.historicUnavailable
      ? null
      : previousModel?.summary;
  const commercial = buildCvrCommercialPosition({
    developmentId,
    historic,
    historicUnavailable: false,
    costSummary: summary,
    snapshot: historic ? period?.snapshot || null : null,
  });
  const previousCommercial =
    !previousModel || previousModel.unavailable || previousModel.historicUnavailable
      ? null
      : buildCvrCommercialPosition({
          developmentId,
          historic: Boolean(previousModel.historic),
          historicUnavailable: Boolean(previousModel.historicUnavailable),
          costSummary: previousModel.summary,
          snapshot: previousLocked?.snapshot || previousModel.period?.snapshot || null,
        });
  const movementReport = buildCvrPeriodComparison({
    currentModel: model,
    previousModel,
    currentPeriod: period,
    previousPeriod: previousLocked,
  });
  movementReport.executive = {
    previousForecastCost: previousSummary?.finalForecast ?? null,
    currentForecastCost: summary.finalForecast,
    netMovement: movementReport.totalMovement,
    currentBudget: summary.currentBudget,
    variance: summary.variance,
    forecastRevenue: commercial.forecastRevenue,
    grossProfit: commercial.grossProfit,
    grossMarginPercent: commercial.grossMarginPercent,
    previousForecastRevenue: previousCommercial?.revenueAvailable ? previousCommercial.forecastRevenue : null,
    previousGrossProfit: previousCommercial?.grossProfitAvailable ? previousCommercial.grossProfit : null,
    previousGrossMarginPercent: previousCommercial?.grossMarginAvailable ? previousCommercial.grossMarginPercent : null,
    revenueMovement: commercial.revenueAvailable && previousCommercial?.revenueAvailable
      ? (commercial.forecastRevenue ?? 0) - (previousCommercial.forecastRevenue ?? 0) : null,
    profitMovement: commercial.grossProfitAvailable && previousCommercial?.grossProfitAvailable
      ? (commercial.grossProfit ?? 0) - (previousCommercial.grossProfit ?? 0) : null,
    marginMovement: commercial.grossMarginAvailable && previousCommercial?.grossMarginAvailable
      ? (commercial.grossMarginPercent ?? 0) - (previousCommercial.grossMarginPercent ?? 0) : null,
  };
  movementReport.executive.labels = {
    previousForecastCost: formatCvrMoney(movementReport.executive.previousForecastCost),
    currentForecastCost: formatCvrMoney(movementReport.executive.currentForecastCost),
    netMovement: formatSignedMovement(movementReport.executive.netMovement),
    currentBudget: formatCvrMoney(movementReport.executive.currentBudget),
    variance: formatCvrMoney(movementReport.executive.variance),
    forecastRevenue: formatCvrMoney(movementReport.executive.forecastRevenue),
    grossProfit: formatCvrMoney(movementReport.executive.grossProfit),
    previousForecastRevenue: formatCvrMoney(movementReport.executive.previousForecastRevenue),
    previousGrossProfit: formatCvrMoney(movementReport.executive.previousGrossProfit),
    previousGrossMargin: movementReport.executive.previousGrossMarginPercent == null ? '—' : `${movementReport.executive.previousGrossMarginPercent.toFixed(1)}%`,
    grossMargin: movementReport.executive.grossMarginPercent == null ? '—' : `${movementReport.executive.grossMarginPercent.toFixed(1)}%`,
    revenueMovement: formatSignedMovement(movementReport.executive.revenueMovement),
    profitMovement: formatSignedMovement(movementReport.executive.profitMovement),
    marginMovement: movementReport.executive.marginMovement == null ? '—' : `${movementReport.executive.marginMovement > 0 ? '+' : '−'}${Math.abs(movementReport.executive.marginMovement).toFixed(1)}pp`,
  };
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
    kpis: buildExecutiveKpis(summary, previousSummary, commercial, previousCommercial),
    financialPosition: buildFinancialPosition(summary, { historic }),
    developmentSummary: buildDevelopmentSummaryPanel(development, historic ? [] : pos, commercial),
    topVariances: buildTopCostVariances(rows),
    movementReport,
    commercialExceptions: buildCommercialExceptions(rows, summary, { historic }),
    commercialCostSummary: buildCommercialCostMovementSummary({
      currentRows: model.rows,
      previousRows: previousModel?.rows || [],
      currentPeriod: period,
      previousPeriod: previousLocked,
      currentTotals: model.totals,
      movementReport,
    }),
    recentActivity: buildRecentCommercialActivity(period, rows),
    commentary: getCvrPeriodCommentary(developmentId, periodKey),
    rows,
    summary,
    commercial,
    historicRevenuePlots: buildHistoricRevenuePlots(period?.snapshot, historic),
    period,
    previousLockedPeriodKey: previousLocked?.periodKey || null,
  };
}

export { getLatestLockedCvrPeriod };
