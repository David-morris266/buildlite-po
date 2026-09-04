/**
 * BL-012B — CVR aggregation engine (does not own source data).
 */

import { enrichPoWithDevelopmentRef } from '../developments/poDevelopmentRefStore';
import {
  getPoCommittedNet,
  getPoCostCode,
  getPoOrderScopeId,
  buildSubcontractOrdersFromPos,
  isApprovedSubcontractPo,
} from '../payments/subcontractOrders';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import { listTransactions } from '../ledger/ledgerTransactionStore';
import { isLedgerServerAuthorityEnabled } from '../ledger/ledgerAuthority';
import { getLedgerReadiness } from '../ledger/ledgerServerCache';
import { isCvrServerAuthorityEnabled } from './cvrPeriodAuthority';
import {
  getCvrInputReadinessForPeriodKey,
  getCvrPeriodReadiness,
} from './cvrPeriodServerCache';
import {
  CVR_CURRENT_PERIOD,
  CVR_DEFAULT_PERIOD_KEY,
  getDevelopmentNotes,
  getPeriodData,
  listCostCentres,
  upsertAutoCostCentre,
} from './costCentreStore';
import {
  buildCvrTotals,
  getVarianceState,
  normaliseCostCodeKey,
  buildCostCodeLabel,
  costCodesMatch,
} from './cvrCalculations';
import { enrichCvrForecastRow, getAdjustmentState } from './cvrForecastEngine';
import { listCommercialEventsByDevelopment } from '../commercialEvents/commercialEventStore';
import { effectiveExpectedLiability } from '../commercialEvents/commercialEventExpectedLiability';
import {
  isCvrHistoricSnapshotPeriod,
  isCvrLegacyLockedPeriod,
} from './cvrPeriodStatus';
import {
  calculatePackageCertifiedValue,
  enrichCvrCertifiedFields,
  getApprovedCertificateValue,
} from './cvrCertifiedValue';
import {
  isApprovedCommercialCertificate,
  resolveCertificatesForPackage,
} from '../payments/paymentCertificateStore';

function isApprovedPo(po) {
  if (!po || po.archived === true) return false;
  const approval = String(po.approval?.status || '').toLowerCase();
  const status = String(po.status || '').toLowerCase();
  return approval === 'approved' || status === 'approved';
}

export function buildCommitmentsByCostCode(developmentId, pos = []) {
  const totals = new Map();
  const labels = new Map();
  const unavailable = new Set();

  for (const order of buildSubcontractOrdersFromPos(pos)) {
    if (order.developmentId !== developmentId) continue;

    const key = normaliseCostCodeKey(order.costCode);
    if (!key) continue;

    const display = buildPackageCommercialDisplayFields(order);
    if (display.commercialEventsReady === false) {
      unavailable.add(key);
      continue;
    }

    const amount = Number(display.currentPackageValue);
    totals.set(key, (totals.get(key) || 0) + (Number.isFinite(amount) ? amount : 0));
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, order.costCode));
    }
  }

  for (const po of pos) {
    if (!isApprovedPo(po) || isApprovedSubcontractPo(po)) continue;

    const enriched = enrichPoWithDevelopmentRef(po);
    const scopeId = getPoOrderScopeId(enriched);
    if (scopeId !== developmentId) continue;

    const costCode = getPoCostCode(enriched);
    const key = normaliseCostCodeKey(costCode);
    if (!key || unavailable.has(key)) continue;

    totals.set(key, (totals.get(key) || 0) + getPoCommittedNet(enriched));
    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, costCode));
    }
  }

  for (const key of unavailable) {
    totals.delete(key);
  }

  return { totals, labels, unavailable };
}

export function getCvrSourceReadiness(developmentId, periodKey = CVR_DEFAULT_PERIOD_KEY) {
  if (isCvrServerAuthorityEnabled()) {
    const periods = getCvrPeriodReadiness(developmentId);
    if (!periods.ready) {
      return { ready: false, source: 'cvr-periods', ...periods };
    }
    const inputs = getCvrInputReadinessForPeriodKey(developmentId, periodKey);
    if (!inputs.ready && !inputs.missingPeriod) {
      return { ready: false, source: 'cvr-inputs', ...inputs };
    }
  }
  const ledger = isLedgerServerAuthorityEnabled()
    ? getLedgerReadiness(developmentId)
    : { ready: true, loadState: 'local' };
  return {
    ready: true,
    ledgerReady: Boolean(ledger.ready),
    ledgerLoadState: ledger.loadState || 'local',
    ledgerError: ledger.error || null,
  };
}

export function buildActualsByCostCode(developmentId) {
  // Ledger actual for CVR = SUM(netAmount). VAT/gross are evidence only.
  if (isLedgerServerAuthorityEnabled() && !getLedgerReadiness(developmentId).ready) {
    return { totals: new Map(), labels: new Map(), unavailable: true };
  }
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

export function buildExpectedLiabilityByCostCode(developmentId) {
  const totals = new Map();
  const labels = new Map();
  for (const event of listCommercialEventsByDevelopment(developmentId)) {
    const amount = effectiveExpectedLiability(event);
    if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) continue;
    const costCode = event.costCode || event.costCodeKey;
    const key = normaliseCostCodeKey(costCode);
    if (!key) continue;
    totals.set(key, (totals.get(key) || 0) + amount);
    if (!labels.has(key)) labels.set(key, buildCostCodeLabel(key, costCode));
  }
  return { totals, labels };
}

export function buildCertifiedByCostCode(developmentId, pos = []) {
  const totals = new Map();
  const labels = new Map();
  const hasPackage = new Set();
  const unavailable = new Set();

  for (const order of buildSubcontractOrdersFromPos(pos)) {
    if (order.developmentId !== developmentId) continue;

    const key = normaliseCostCodeKey(order.costCode);
    if (!key) continue;

    hasPackage.add(key);
    const certifiedValue = calculatePackageCertifiedValue(order.orderKey, order);
    if (certifiedValue == null) {
      unavailable.add(key);
    } else {
      totals.set(key, (totals.get(key) || 0) + certifiedValue);
    }

    if (!labels.has(key)) {
      labels.set(key, buildCostCodeLabel(key, order.costCode));
    }
  }

  return { totals, labels, hasPackage, unavailable };
}

function collectCostCodeKeys(sources) {
  const keys = new Set();
  for (const source of sources) {
    for (const key of source.totals.keys()) {
      keys.add(key);
    }
    if (source.hasPackage) {
      for (const key of source.hasPackage) {
        keys.add(key);
      }
    }
    if (source.unavailable instanceof Set) {
      for (const key of source.unavailable) {
        keys.add(key);
      }
    }
  }
  return keys;
}

export function buildCvrRows(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_DEFAULT_PERIOD_KEY;
  const pos = options.pos || [];

  const commitments = buildCommitmentsByCostCode(developmentId, pos);
  const certified = buildCertifiedByCostCode(developmentId, pos);
  const actuals = buildActualsByCostCode(developmentId);
  const expectedLiabilities = buildExpectedLiabilityByCostCode(developmentId);
  const exposureDocument = options.period?.variationExposure?.document || options.period?.snapshot?.variationExposure?.document;
  const variationExposureByCostCode = new Map();
  for (const item of exposureDocument?.items || []) {
    const key = normaliseCostCodeKey(item.costCode);
    if (!key || item.vaExposureUplift == null) continue;
    const entry = variationExposureByCostCode.get(key) || { pence: 0, items: [] };
    entry.pence += Math.round(Number(item.vaExposureUplift) * 100);
    entry.items.push(item);
    variationExposureByCostCode.set(key, entry);
  }
  const manualCentres = listCostCentres(developmentId, periodKey);

  const allKeys = collectCostCodeKeys([
    commitments,
    certified,
    actuals,
    expectedLiabilities,
  ]);
  for (const key of variationExposureByCostCode.keys()) allKeys.add(key);
  const manualByKey = new Map();

  for (const centre of manualCentres) {
    const key = normaliseCostCodeKey(centre.costCodeKey);
    if (!key) continue;
    allKeys.add(key);
    if (!manualByKey.has(key)) {
      manualByKey.set(key, { ...centre, costCodeKey: key });
    }
  }

  const rows = [...allKeys].map((key) => {
    const manual = manualByKey.get(key);
    const label =
      manual?.costCodeLabel ||
      commitments.labels.get(key) ||
      certified.labels.get(key) ||
      actuals.labels.get(key) ||
      expectedLiabilities.labels.get(key) ||
      buildCostCodeLabel(key);

    const hasManualBudget =
      manual &&
      (manual.originalBudget != null || manual.currentBudget != null);

    const certifiedValue = certified.hasPackage.has(key)
      ? certified.unavailable?.has(key)
        ? null
        : certified.totals.get(key) ?? 0
      : hasManualBudget
        ? 0
        : null;

    const row = enrichCvrCertifiedFields(
      enrichCvrForecastRow({
        id: manual?.id || `auto-${key}`,
        costCodeKey: key,
        costCodeLabel: label,
        description: manual?.description || '',
        originalBudget: manual?.originalBudget ?? null,
        currentBudget: manual?.currentBudget ?? null,
        committed: commitments.unavailable?.has(key)
          ? null
          : commitments.totals.get(key) ?? (hasManualBudget ? 0 : null),
        certified: certifiedValue,
        actualCost: actuals.unavailable
          ? null
          : actuals.totals.get(key) ?? (hasManualBudget ? 0 : null),
        expectedLiability: expectedLiabilities.totals.get(key) ?? 0,
        vaExposureUplift: (variationExposureByCostCode.get(key)?.pence || 0) / 100,
        variationExposureItems: variationExposureByCostCode.get(key)?.items || [],
        commercialAdjustment: manual?.commercialAdjustment ?? 0,
        commercialReason: manual?.commercialReason || '',
        adjustmentHistory: manual?.adjustmentHistory || [],
        commercialNotes: manual?.commercialNotes || '',
        manualAccrual: manual?.manualAccrual ?? 0,
        isManual: Boolean(manual),
        canDelete:
          !commitments.totals.get(key) &&
          !certified.hasPackage.has(key) &&
          !actuals.totals.get(key),
      })
    );

    if (actuals.unavailable) {
      row.actualCost = null;
      row.currentCost = null;
      row.costToComplete = null;
      row.outstandingCertified = null;
      row.outstandingCertifiedState = 'neutral';
    }

    return row;
  });

  rows.sort((a, b) => a.costCodeLabel.localeCompare(b.costCodeLabel, undefined, {
    sensitivity: 'base',
  }));

  return rows;
}

function emptyCvrSummary() {
  return {
    originalBudget: null,
    currentBudget: null,
    committed: null,
    certified: null,
    actualCost: null,
    outstandingCertified: null,
    systemForecast: null,
    expectedLiability: null,
    vaExposureUplift: null,
    commercialAdjustment: null,
    manualAccrual: null,
    currentCost: null,
    finalForecast: null,
    forecastFinalCost: null,
    variance: null,
    costToComplete: null,
    grossMargin: null,
  };
}

function summaryFromTotals(totals, ledgerReady = true) {
  return {
    originalBudget: totals.originalBudget,
    currentBudget: totals.currentBudget,
    committed: totals.committed,
    certified: totals.certified,
    actualCost: ledgerReady ? totals.actualCost : null,
    outstandingCertified: ledgerReady ? totals.outstandingCertified : null,
    systemForecast: totals.systemForecast,
    expectedLiability: totals.expectedLiability,
    vaExposureUplift: totals.vaExposureUplift,
    commercialAdjustment: totals.commercialAdjustment,
    manualAccrual: totals.manualAccrual,
    currentCost: ledgerReady ? totals.currentCost : null,
    finalForecast: totals.finalForecast,
    forecastFinalCost: totals.finalForecast,
    variance: totals.variance,
    costToComplete: ledgerReady ? totals.costToComplete : null,
    grossMargin: null,
  };
}

function snapshotRowToCvrRow(row) {
  const outstanding = Number(row.outstandingCertified);
  return {
    id: row.id || `snapshot-${row.costCodeKey}`,
    costCodeKey: row.costCodeKey,
    costCodeLabel: row.costCodeLabel || row.costCodeKey,
    description: row.description || '',
    commercialHead: row.commercialHead || '',
    commercialFamily: row.commercialFamily || '',
    trade: row.trade || '',
    active: row.active !== false,
    originalBudget: row.originalBudget,
    currentBudget: row.currentBudget,
    commercialAdjustment: row.commercialAdjustment ?? 0,
    commercialReason: row.commercialReason || row.adjustmentReason || '',
    adjustmentReason: row.adjustmentReason || row.commercialReason || '',
    manualAccrual: row.manualAccrual ?? 0,
    notes: row.notes || row.commercialNotes || '',
    commercialNotes: row.commercialNotes || row.notes || '',
    committed: row.committed,
    certified: row.certified,
    actualCost: row.actualCost,
    currentCost: row.currentCost,
    systemForecast: row.systemForecast,
    expectedLiability:
      row.expectedLiabilityCaptured === false ? null : row.expectedLiability,
    expectedLiabilityCaptured: row.expectedLiabilityCaptured !== false,
    vaExposureUplift: row.vaExposureUplift ?? 0,
    variationExposureItems: row.variationExposureItems || [],
    expectedLiabilityProvenance: row.expectedLiabilityProvenance ?? null,
    finalForecast: row.finalForecast,
    forecastFinalCost: row.finalForecast,
    costToComplete: row.costToComplete,
    outstandingCertified: row.outstandingCertified,
    outstandingCertifiedState:
      Number.isFinite(outstanding) && outstanding > 0.005 ? 'warning' : 'neutral',
    variance: row.variance,
    displayMetadata: row.displayMetadata || {},
    adjustmentHistory: Array.isArray(row.adjustmentHistory) ? row.adjustmentHistory : [],
    isManual: true,
    canDelete: false,
    historic: true,
    varianceState: getVarianceState(row.variance),
    adjustmentState: getAdjustmentState(row.commercialAdjustment),
  };
}

function historicTotalsFromSnapshot(snapshot, rows) {
  const fromRows = buildCvrTotals(rows);
  const header = snapshot?.totals || {};
  return {
    ...fromRows,
    currentBudget: header.currentBudget ?? fromRows.currentBudget,
    committed: header.committed ?? fromRows.committed,
    certified: header.certified ?? fromRows.certified,
    actualCost: header.actualCost ?? fromRows.actualCost,
    manualAccrual: header.manualAccrual ?? fromRows.manualAccrual,
    currentCost: header.currentCost ?? fromRows.currentCost,
    systemForecast: header.systemForecast ?? fromRows.systemForecast,
    expectedLiability:
      header.expectedLiabilityCaptured === false
        ? null
        : header.expectedLiability ?? fromRows.expectedLiability,
    vaExposureUplift: header.vaExposureUplift ?? fromRows.vaExposureUplift,
    commercialAdjustment: header.commercialAdjustment ?? fromRows.commercialAdjustment,
    finalForecast: header.finalForecast ?? fromRows.finalForecast,
    forecastFinalCost: header.finalForecast ?? fromRows.forecastFinalCost,
    costToComplete: header.costToComplete ?? fromRows.costToComplete,
    outstandingCertified: header.outstandingCertified ?? fromRows.outstandingCertified,
    variance: header.variance ?? fromRows.variance,
    originalBudget: fromRows.originalBudget ?? header.originalBudget ?? null,
  };
}

function buildHistoricCvrModel(developmentId, periodKey, period) {
  if (isCvrLegacyLockedPeriod(period)) {
    return {
      developmentId,
      periodKey,
      ready: false,
      unavailable: true,
      historic: false,
      historicUnavailable: true,
      reason: 'legacy-no-snapshot',
      loadState: 'loaded',
      error: null,
      rows: [],
      totals: buildCvrTotals([]),
      developmentNotes: '',
      summary: emptyCvrSummary(),
      snapshot: null,
    };
  }

  const snapshot = period.snapshot;
  const rows = (snapshot.rows || []).map(snapshotRowToCvrRow);
  rows.sort((a, b) =>
    String(a.costCodeLabel).localeCompare(String(b.costCodeLabel), undefined, {
      sensitivity: 'base',
    })
  );
  const totals = historicTotalsFromSnapshot(snapshot, rows);

  return {
    developmentId,
    periodKey,
    ready: true,
    unavailable: false,
    historic: true,
    historicUnavailable: false,
    ledgerReady: true,
    rows,
    totals,
    developmentNotes: period.developmentNotes || getDevelopmentNotes(developmentId, periodKey),
    summary: summaryFromTotals(totals, true),
    snapshot,
    sourceReadiness: snapshot.sourceReadiness || {},
  };
}

export function buildCvrModel(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_DEFAULT_PERIOD_KEY;
  const period = options.period || getPeriodData(developmentId, periodKey);

  if (
    !period?.unavailable &&
    !period?.missing &&
    (isCvrHistoricSnapshotPeriod(period) || isCvrLegacyLockedPeriod(period))
  ) {
    return buildHistoricCvrModel(developmentId, periodKey, period);
  }

  const readiness = getCvrSourceReadiness(developmentId, periodKey);
  if (!readiness.ready) {
    return {
      developmentId,
      periodKey,
      ready: false,
      unavailable: true,
      historic: false,
      historicUnavailable: false,
      reason: readiness.reason || readiness.source,
      loadState: readiness.loadState,
      error: readiness.error || null,
      rows: [],
      totals: buildCvrTotals([]),
      developmentNotes: '',
      summary: emptyCvrSummary(),
    };
  }

  const rows = buildCvrRows(developmentId, options);
  const totals = buildCvrTotals(rows);
  const ledgerReady = readiness.ledgerReady !== false;
  if (!ledgerReady) {
    totals.actualCost = null;
    totals.currentCost = null;
    totals.costToComplete = null;
    totals.outstandingCertified = null;
  }

  return {
    developmentId,
    periodKey,
    ready: true,
    unavailable: false,
    historic: false,
    historicUnavailable: false,
    ledgerReady,
    rows,
    totals,
    developmentNotes: getDevelopmentNotes(developmentId, periodKey),
    summary: summaryFromTotals(totals, ledgerReady),
  };
}

export function buildPackagesForCostCentre(developmentId, costCodeKey, pos = []) {
  const orders = buildSubcontractOrdersFromPos(pos).filter(
    (order) =>
      order.developmentId === developmentId &&
      costCodesMatch(order.costCode, costCodeKey)
  );

  return orders.map((order) => {
    const display = buildPackageCommercialDisplayFields(order);
    return {
      id: order.orderKey,
      label: order.supplierLabel,
      costCode: order.costCode,
      committedValue:
        display.commercialEventsReady === false ? null : display.currentPackageValue,
      certifiedValue: calculatePackageCertifiedValue(order.orderKey, order),
      poNumbers: order.poNumbers,
      certificateCount: order.certificateCount,
    };
  });
}

export function buildCertificatesForCostCentre(developmentId, costCodeKey, pos = []) {
  const orders = buildSubcontractOrdersFromPos(pos).filter(
    (order) =>
      order.developmentId === developmentId &&
      costCodesMatch(order.costCode, costCodeKey)
  );

  const certificates = [];

  for (const order of orders) {
    const resolved = resolveCertificatesForPackage(order.orderKey, order);
    if (!resolved.ready) continue;

    for (const certificate of resolved.certificates) {
      certificates.push({
        id: certificate.id,
        orderKey: order.orderKey,
        packageLabel: order.supplierLabel,
        certificateNumber: certificate.certificateNumber,
        status: certificate.status,
        certificateDate: certificate.certificateDate,
        grossValue: certificate.grossValue,
        netValue: certificate.netValue,
        isApproved: isApprovedCommercialCertificate(certificate),
        certifiedValue: getApprovedCertificateValue(certificate),
      });
    }
  }

  return certificates
    .filter((item) => item.isApproved)
    .sort((a, b) => a.certificateNumber - b.certificateNumber);
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

export function ensureDiscoveredCostCentres(developmentId, pos = [], periodKey = CVR_DEFAULT_PERIOD_KEY) {
  if (isCvrServerAuthorityEnabled()) return;
  const commitments = buildCommitmentsByCostCode(developmentId, pos);
  const certified = buildCertifiedByCostCode(developmentId, pos);
  const actuals = buildActualsByCostCode(developmentId);
  const keys = collectCostCodeKeys([commitments, certified, actuals]);

  for (const key of keys) {
    const label =
      commitments.labels.get(key) ||
      certified.labels.get(key) ||
      actuals.labels.get(key) ||
      buildCostCodeLabel(key);
    upsertAutoCostCentre(developmentId, { costCodeKey: key, costCodeLabel: label }, periodKey);
  }
}
