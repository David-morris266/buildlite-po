/**
 * BL-012B — CVR aggregation engine (does not own source data).
 */

import { enrichPoWithDevelopmentRef } from '../developments/poDevelopmentRefStore';
import { getPoDevelopmentId } from '../developments/developmentPoHelpers';
import {
  getPoCommittedNet,
  getPoCostCode,
  getPoOrderScopeId,
  buildSubcontractOrdersFromPos,
} from '../payments/subcontractOrders';
import { listTransactions } from '../ledger/ledgerTransactionStore';
import {
  CVR_CURRENT_PERIOD,
  getDevelopmentNotes,
  listCostCentres,
  upsertAutoCostCentre,
} from './costCentreStore';
import {
  buildCvrTotals,
  enrichCvrRow,
  normaliseCostCodeKey,
  buildCostCodeLabel,
  costCodesMatch,
} from './cvrCalculations';

function isApprovedPo(po) {
  if (!po || po.archived === true) return false;
  const approval = String(po.approval?.status || '').toLowerCase();
  const status = String(po.status || '').toLowerCase();
  return approval === 'approved' || status === 'approved';
}

export function buildCommitmentsByCostCode(developmentId, pos = []) {
  const totals = new Map();
  const labels = new Map();

  for (const po of pos) {
    if (!isApprovedPo(po)) continue;

    const enriched = enrichPoWithDevelopmentRef(po);
    const scopeId = getPoOrderScopeId(enriched);
    if (scopeId !== developmentId) continue;

    const costCode = getPoCostCode(enriched);
    const key = normaliseCostCodeKey(costCode);
    if (!key) continue;

    totals.set(key, (totals.get(key) || 0) + getPoCommittedNet(enriched));
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, costCode));
    }
  }

  return { totals, labels };
}

export function buildActualsByCostCode(developmentId) {
  const totals = new Map();
  const labels = new Map();

  for (const txn of listTransactions(developmentId)) {
    const key = normaliseCostCodeKey(txn.costCode);
    if (!key) continue;

    const amount = Number(txn.netAmount) || 0;
    totals.set(key, (totals.get(key) || 0) + amount);
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, txn.costCode));
    }
  }

  return { totals, labels };
}

function collectCostCodeKeys(sources) {
  const keys = new Set();
  for (const source of sources) {
    for (const key of source.totals.keys()) {
      keys.add(key);
    }
  }
  return keys;
}

export function buildCvrRows(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_CURRENT_PERIOD;
  const pos = options.pos || [];

  const commitments = buildCommitmentsByCostCode(developmentId, pos);
  const actuals = buildActualsByCostCode(developmentId);
  const manualCentres = listCostCentres(developmentId, periodKey);

  const allKeys = collectCostCodeKeys([commitments, actuals]);
  for (const centre of manualCentres) {
    if (centre.costCodeKey) allKeys.add(centre.costCodeKey);
  }

  const manualByKey = new Map(
    manualCentres.map((centre) => [centre.costCodeKey, centre])
  );

  const rows = [...allKeys].map((key) => {
    const manual = manualByKey.get(key);
    const label =
      manual?.costCodeLabel ||
      commitments.labels.get(key) ||
      actuals.labels.get(key) ||
      buildCostCodeLabel(key);

    return enrichCvrRow({
      id: manual?.id || `auto-${key}`,
      costCodeKey: key,
      costCodeLabel: label,
      description: manual?.description || '',
      originalBudget: manual?.originalBudget ?? null,
      currentBudget: manual?.currentBudget ?? null,
      committed: commitments.totals.get(key) ?? null,
      actualCost: actuals.totals.get(key) ?? null,
      forecastFinalCost: manual?.forecastFinalCost ?? null,
      commercialNotes: manual?.commercialNotes || '',
      forecastNotes: manual?.forecastNotes || '',
      isManual: Boolean(manual),
      canDelete: !commitments.totals.get(key) && !actuals.totals.get(key),
    });
  });

  rows.sort((a, b) => a.costCodeLabel.localeCompare(b.costCodeLabel, undefined, {
    sensitivity: 'base',
  }));

  return rows;
}

export function buildCvrModel(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_CURRENT_PERIOD;
  const rows = buildCvrRows(developmentId, options);
  const totals = buildCvrTotals(rows);

  return {
    developmentId,
    periodKey,
    rows,
    totals,
    developmentNotes: getDevelopmentNotes(developmentId, periodKey),
    summary: {
      originalBudget: totals.originalBudget,
      currentBudget: totals.currentBudget,
      committed: totals.committed,
      actualCost: totals.actualCost,
      forecastFinalCost: totals.forecastFinalCost,
      variance: totals.variance,
      costToComplete: totals.costToComplete,
      grossMargin: null,
    },
  };
}

export function buildPackagesForCostCentre(developmentId, costCodeKey, pos = []) {
  const orders = buildSubcontractOrdersFromPos(pos).filter(
    (order) =>
      order.developmentId === developmentId &&
      costCodesMatch(order.costCode, costCodeKey)
  );

  return orders.map((order) => ({
    id: order.orderKey,
    label: order.supplierLabel,
    costCode: order.costCode,
    committedValue: order.committedValue,
    poNumbers: order.poNumbers,
    certificateCount: order.certificateCount,
  }));
}

export function buildLedgerRowsForCostCentre(developmentId, costCodeKey) {
  return listTransactions(developmentId)
    .filter((txn) => costCodesMatch(txn.costCode, costCodeKey))
    .map((txn) => ({
      id: txn.id,
      date: txn.transactionDate,
      supplier: txn.supplier,
      description: txn.description,
      invoiceNumber: txn.invoiceNumber,
      netAmount: txn.netAmount,
      source: txn.source,
    }));
}

export function ensureDiscoveredCostCentres(developmentId, pos = [], periodKey = CVR_CURRENT_PERIOD) {
  const commitments = buildCommitmentsByCostCode(developmentId, pos);
  const actuals = buildActualsByCostCode(developmentId);
  const keys = collectCostCodeKeys([commitments, actuals]);

  for (const key of keys) {
    const label = commitments.labels.get(key) || actuals.labels.get(key) || buildCostCodeLabel(key);
    upsertAutoCostCentre(developmentId, { costCodeKey: key, costCodeLabel: label }, periodKey);
  }
}
