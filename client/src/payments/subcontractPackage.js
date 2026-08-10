/**
 * BL-011C.01 / BL-025.1 — Subcontract Package view model (Doc 29–32, Doc 64 / Doc 65).
 */

import { hasOrderMatrix, loadOrderMatrix } from './orderMatrixStore';
import {
  ensurePackageRecord,
  getPackageRecord,
} from './subcontractPackageStore';
import { getSubcontractOrderStatus } from './subcontractOrders';
import { getCertificateCount } from './paymentCertificateStore';
import { buildPackageCommercialDisplayFields } from '../commercialEvents/commercialEventPackageValue';
import { buildPackageRecoverySummaryFromOrder } from '../commercialEvents/commercialEventPackageRecoveryKpis';
import {
  calculateCommercialProgressPct,
  calculatePackageCertifiedGross,
  calculatePackageCertifiedNet,
  calculateRemainingContractValue,
} from './packageCertifiedTotals';

export function buildPackageViewModel(order) {
  if (!order) return null;

  ensurePackageRecord(order.orderKey, order);
  const packageRecord = getPackageRecord(order.orderKey);
  const matrix = loadOrderMatrix(order.orderKey);
  const matrixExists = hasOrderMatrix(order.orderKey);

  const committedValue = Number(order.committedValue) || 0;
  const commercialDisplay = buildPackageCommercialDisplayFields(order);
  const recoverySummary = buildPackageRecoverySummaryFromOrder(order);
  const certificateCount = getCertificateCount(order.orderKey);

  const originalOrderValue = commercialDisplay.originalPoCommitment;
  const approvedCommercialMovement = commercialDisplay.approvedCommercialEventMovement;
  const pendingCommercialMovement = commercialDisplay.pendingCommercialEventValue;
  const currentContractValue = commercialDisplay.currentPackageValue;

  const certifiedGrossToDate = calculatePackageCertifiedGross(order.orderKey, order);
  const certifiedNetPaymentToDate = calculatePackageCertifiedNet(order.orderKey, order);
  const remainingContractValue = calculateRemainingContractValue(
    currentContractValue,
    certifiedGrossToDate
  );
  const commercialProgressPct = calculateCommercialProgressPct(
    certifiedGrossToDate,
    currentContractValue
  );

  /** @deprecated BL-025.1 — use approvedCommercialMovement */
  const approvedVariations = approvedCommercialMovement;
  /** @deprecated BL-025.1 — use currentContractValue */
  const adjustedContract = currentContractValue;
  /** @deprecated BL-025.1 — use certifiedGrossToDate */
  const certifiedToDate = certifiedGrossToDate;
  /** @deprecated BL-025.1 — use remainingContractValue (may be negative when over-certified) */
  const remaining = remainingContractValue;
  /** @deprecated BL-025.1 — use commercialProgressPct */
  const overallProgress = commercialProgressPct;

  const status = getSubcontractOrderStatus({
    ...order,
    orderKey: order.orderKey,
    currentContractValue,
    certifiedGrossToDate,
  });

  return {
    ...order,
    committedValue,
    originalOrderValue,
    approvedCommercialMovement,
    pendingCommercialMovement,
    currentContractValue,
    certifiedGrossToDate,
    certifiedNetPaymentToDate,
    remainingContractValue,
    commercialProgressPct,
    isOverCertified: remainingContractValue < -0.005,
    approvedVariations,
    adjustedContract,
    originalPoCommitment: originalOrderValue,
    approvedCommercialEventMovement: approvedCommercialMovement,
    currentPackageValue: currentContractValue,
    pendingCommercialEventValue: pendingCommercialMovement,
    recoverySummary,
    certifiedToDate,
    remaining,
    overallProgress,
    certificateCount,
    status,
    matrixExists,
    matrixRowCount: matrix?.rows?.length ?? 0,
    createdAt: packageRecord?.createdAt || null,
    updatedAt: matrix?.updatedAt || packageRecord?.updatedAt || null,
    activity: buildPackageActivity(order, packageRecord, matrix),
    nextStep: matrixExists ? 'certificates' : 'matrix',
    matrixStatusLabel: matrixExists ? 'Imported' : 'Awaiting import',
    matrixPlotCount:
      matrix?.layout === 'plot-stage' ? matrix.plots?.length ?? 0 : null,
  };
}

function parseWhen(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function buildPackageActivity(order, packageRecord, matrix) {
  const entries = [];

  for (const po of order.pos || []) {
    const poNumber = po.poNumber || po.number;
    const decidedAt =
      po.approval?.decidedAt ||
      po.updatedAt ||
      po.createdAt;
    const isApproved =
      String(po.approval?.status || po.status || '').toLowerCase() ===
      'approved';

    if (isApproved && poNumber) {
      entries.push({
        id: `po-approved-${poNumber}`,
        label: `Purchase Order ${poNumber} approved`,
        when: parseWhen(decidedAt),
        modifier: 'approved',
      });
    }
  }

  if (matrix?.updatedAt) {
    const hasMatrixActivity = (packageRecord?.activity || []).some(
      (item) => item.modifier === 'matrix'
    );
    if (!hasMatrixActivity) {
      entries.push({
        id: `matrix-legacy-${matrix.updatedAt}`,
        label: 'Order Matrix updated',
        when: matrix.updatedAt,
        modifier: 'matrix',
      });
    }
  }

  for (const item of packageRecord?.activity || []) {
    entries.push({
      id: item.id,
      label: item.label,
      when: item.when,
      modifier: item.modifier || 'default',
    });
  }

  const seen = new Set();
  return entries
    .filter((entry) => {
      const key = `${entry.label}-${entry.when}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(entry.when);
    })
    .sort((a, b) => new Date(b.when) - new Date(a.when));
}
