/**
 * BL-011C.01 — Subcontract Package view model (Doc 29–32).
 */

import { hasOrderMatrix, loadOrderMatrix } from './orderMatrixStore';
import {
  ensurePackageRecord,
  getPackageRecord,
} from './subcontractPackageStore';
import { getSubcontractOrderStatus } from './subcontractOrders';
import { getCertificateCount } from './paymentCertificateStore';

export function buildPackageViewModel(order) {
  if (!order) return null;

  ensurePackageRecord(order.orderKey, order);
  const packageRecord = getPackageRecord(order.orderKey);
  const matrix = loadOrderMatrix(order.orderKey);
  const matrixExists = hasOrderMatrix(order.orderKey);

  const committedValue = Number(order.committedValue) || 0;
  const approvedVariations = 0;
  const adjustedContract = committedValue + approvedVariations;
  const certificateCount = getCertificateCount(order.orderKey);
  const certifiedToDate = Number(order.certifiedToDate) || 0;
  const remaining = Math.max(0, adjustedContract - certifiedToDate);
  const overallProgress =
    adjustedContract > 0
      ? Math.min(100, Math.round((certifiedToDate / adjustedContract) * 100))
      : 0;

  const status = getSubcontractOrderStatus({
    ...order,
    orderKey: order.orderKey,
  });

  return {
    ...order,
    committedValue,
    approvedVariations,
    adjustedContract,
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
