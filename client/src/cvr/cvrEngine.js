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
  listCostCentres,
  upsertAutoCostCentre,
} from './costCentreStore';
import {
  buildCvrTotals,
  normaliseCostCodeKey,
  buildCostCodeLabel,
  costCodesMatch,
} from './cvrCalculations';
import { enrichCvrForecastRow } from './cvrForecastEngine';
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
  // BL-031D TODO: commitment must become approved PO net + approved
  // value-changing Commercial Events. Live formula remains PO net only.
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
  // BL-031D TODO: manualAccrual is persisted but still unused in live calculations.
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
  }
  return keys;
}

export function buildCvrRows(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_DEFAULT_PERIOD_KEY;
  const pos = options.pos || [];

  const commitments = buildCommitmentsByCostCode(developmentId, pos);
  const certified = buildCertifiedByCostCode(developmentId, pos);
  const actuals = buildActualsByCostCode(developmentId);
  const manualCentres = listCostCentres(developmentId, periodKey);

  const allKeys = collectCostCodeKeys([commitments, certified, actuals]);
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
        committed: commitments.totals.get(key) ?? (hasManualBudget ? 0 : null),
        certified: certifiedValue,
        actualCost: actuals.unavailable
          ? null
          : actuals.totals.get(key) ?? (hasManualBudget ? 0 : null),
        commercialAdjustment: manual?.commercialAdjustment ?? 0,
        commercialReason: manual?.commercialReason || '',
        adjustmentHistory: manual?.adjustmentHistory || [],
        commercialNotes: manual?.commercialNotes || '',
        isManual: Boolean(manual),
        canDelete:
          !commitments.totals.get(key) &&
          !certified.hasPackage.has(key) &&
          !actuals.totals.get(key),
      })
    );

    if (actuals.unavailable) {
      row.actualCost = null;
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

export function buildCvrModel(developmentId, options = {}) {
  const periodKey = options.periodKey || CVR_DEFAULT_PERIOD_KEY;
  const readiness = getCvrSourceReadiness(developmentId, periodKey);
  if (!readiness.ready) {
    return {
      developmentId,
      periodKey,
      ready: false,
      unavailable: true,
      reason: readiness.reason || readiness.source,
      loadState: readiness.loadState,
      error: readiness.error || null,
      rows: [],
      totals: buildCvrTotals([]),
      developmentNotes: '',
      summary: {
        originalBudget: null,
        currentBudget: null,
        committed: null,
        certified: null,
        actualCost: null,
        outstandingCertified: null,
        systemForecast: null,
        commercialAdjustment: null,
        finalForecast: null,
        forecastFinalCost: null,
        variance: null,
        costToComplete: null,
        grossMargin: null,
      },
    };
  }

  const rows = buildCvrRows(developmentId, options);
  const totals = buildCvrTotals(rows);
  const ledgerReady = readiness.ledgerReady !== false;
  if (!ledgerReady) {
    totals.actualCost = null;
    totals.costToComplete = null;
    totals.outstandingCertified = null;
  }

  return {
    developmentId,
    periodKey,
    ready: true,
    unavailable: false,
    ledgerReady,
    rows,
    totals,
    developmentNotes: getDevelopmentNotes(developmentId, periodKey),
    summary: {
      originalBudget: totals.originalBudget,
      currentBudget: totals.currentBudget,
      committed: totals.committed,
      certified: totals.certified,
      actualCost: ledgerReady ? totals.actualCost : null,
      outstandingCertified: ledgerReady ? totals.outstandingCertified : null,
      systemForecast: totals.systemForecast,
      commercialAdjustment: totals.commercialAdjustment,
      finalForecast: totals.finalForecast,
      forecastFinalCost: totals.finalForecast,
      variance: totals.variance,
      costToComplete: ledgerReady ? totals.costToComplete : null,
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
    certifiedValue: calculatePackageCertifiedValue(order.orderKey, order),
    poNumbers: order.poNumbers,
    certificateCount: order.certificateCount,
  }));
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
