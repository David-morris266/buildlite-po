/**
 * BL-011B.01 — Subcontract Order derivation from approved POs (Doc 29 / Doc 30).
 */

import { hasOrderMatrix, loadOrderMatrix } from './orderMatrixStore';
import {
  getPoDevelopmentId,
  getPoDevelopmentListLabel,
  resolvePoDevelopment,
} from '../developments/developmentPoHelpers';

export function getSubcontractOrderKey(jobId, supplierId) {
  return `${String(jobId)}::${String(supplierId)}`;
}

export function parseSubcontractOrderKey(orderKey) {
  const idx = String(orderKey).indexOf('::');
  if (idx < 0) return { jobId: '', supplierId: '' };
  return {
    jobId: orderKey.slice(0, idx),
    supplierId: orderKey.slice(idx + 2),
  };
}

export function isApprovedSubcontractPo(po) {
  if (!po || po.archived === true) return false;
  const type = String(po.type || '').toUpperCase();
  if (type !== 'S') return false;

  const approval = String(po.approval?.status || '').toLowerCase();
  const status = String(po.status || '').toLowerCase();
  return approval === 'approved' || status === 'approved';
}

export function getPoJobId(po) {
  return po?.job?.id ?? po?.costRef?.jobId ?? null;
}

export function getPoOrderScopeId(po) {
  return getPoDevelopmentId(po) || getPoJobId(po);
}

export function getPoDevelopmentFields(po) {
  const resolved = resolvePoDevelopment(po);
  const ref = resolved.ref || {};

  return {
    developmentId: ref.id || getPoDevelopmentId(po) || '',
    developmentNumber: ref.developmentNumber || resolved.number || '',
    developmentName: ref.developmentName || resolved.label || '',
  };
}

export function getPoCommittedNet(po) {
  const n = Number(po?.subtotal ?? po?.totals?.net ?? po?.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function getLineNet(item) {
  const qty = Number(item?.qty ?? item?.quantity ?? 0);
  const rate = Number(item?.rate ?? item?.unitRate ?? 0);
  const amount = item?.amount ?? item?.total;
  if (amount != null && Number.isFinite(Number(amount))) {
    return Number(amount);
  }
  return qty * rate;
}

export function getProjectLabel(po) {
  return getPoDevelopmentListLabel(po);
}

export function getSupplierLabel(po) {
  return (
    po?.supplierSnapshot?.name ||
    po?.supplierName ||
    po?.supplier ||
    '—'
  );
}

export function getSubcontractOrderKeyFromPo(po) {
  const scopeId = getPoOrderScopeId(po);
  const supplierId = po?.supplierId;
  if (!scopeId || !supplierId) return null;
  return getSubcontractOrderKey(scopeId, supplierId);
}

export function buildSubcontractOrdersFromPos(pos) {
  const items = Array.isArray(pos) ? pos : pos?.items || [];
  const groups = new Map();

  for (const po of items) {
    if (!isApprovedSubcontractPo(po)) continue;

    const scopeId = getPoOrderScopeId(po);
    const supplierId = po.supplierId;
    if (!scopeId || !supplierId) continue;

    const orderKey = getSubcontractOrderKey(scopeId, supplierId);
    const developmentFields = getPoDevelopmentFields(po);
    const existing = groups.get(orderKey) || {
      orderKey,
      jobId: String(scopeId),
      supplierId: String(supplierId),
      projectLabel: getProjectLabel(po),
      supplierLabel: getSupplierLabel(po),
      ...developmentFields,
      committedValue: 0,
      certifiedToDate: 0,
      certificateCount: 0,
      poNumbers: [],
      pos: [],
    };

    existing.committedValue += getPoCommittedNet(po);
    if (po.poNumber && !existing.poNumbers.includes(po.poNumber)) {
      existing.poNumbers.push(po.poNumber);
    }
    existing.pos.push(po);
    groups.set(orderKey, existing);
  }

  return Array.from(groups.values())
    .map((order) => ({
      ...order,
      remaining: Math.max(0, order.committedValue - order.certifiedToDate),
      status: getSubcontractOrderStatus(order),
      hasMatrix: hasOrderMatrix(order.orderKey),
      matrixRowCount: loadOrderMatrix(order.orderKey)?.rows?.length ?? 0,
    }))
    .sort((a, b) =>
      a.projectLabel.localeCompare(b.projectLabel, undefined, {
        sensitivity: 'base',
      })
    );
}

export function getSubcontractOrderStatus(order) {
  const hasMatrix = hasOrderMatrix(order.orderKey);
  const committed = Number(order.committedValue) || 0;
  const certified = Number(order.certifiedToDate) || 0;
  const remaining = Math.max(0, committed - certified);

  if (!hasMatrix) {
    return { label: 'Matrix Required', modifier: 'matrix-required' };
  }
  if (committed > 0 && remaining <= 0 && certified > 0) {
    return { label: 'Completed', modifier: 'completed' };
  }
  if (certified > 0) {
    return { label: 'Live', modifier: 'live' };
  }
  return { label: 'Ready', modifier: 'ready' };
}

export function seedMatrixRowsFromPos(pos) {
  const rows = [];
  for (const po of pos) {
    const items = Array.isArray(po.items) ? po.items : [];
    items.forEach((item, index) => {
      rows.push({
        id: `${po.poNumber || 'po'}-${index}-${rows.length}`,
        description: item.description || '',
        orderValue: getLineNet(item),
        notes: '',
      });
    });
  }
  return rows;
}

export function createMatrixDraft(order) {
  const existing = loadOrderMatrix(order.orderKey);
  if (existing) return existing;

  return {
    orderKey: order.orderKey,
    jobId: order.jobId,
    supplierId: order.supplierId,
    projectLabel: order.projectLabel,
    supplierLabel: order.supplierLabel,
    committedValue: order.committedValue,
    rows: seedMatrixRowsFromPos(order.pos || []),
  };
}

export function sumMatrixAllocated(rows) {
  return (rows || []).reduce((sum, row) => {
    const n = Number(row.orderValue);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

export function getMatrixAllocationSummary(rows, committedValue) {
  const allocated = sumMatrixAllocated(rows);
  const committed = Number(committedValue) || 0;
  const remaining = committed - allocated;
  return {
    allocated,
    committed,
    remaining,
    isBalanced: Math.abs(remaining) < 0.005,
  };
}

export function getOrderMatrixSummary(orderKey, committedValue) {
  const matrix = loadOrderMatrix(orderKey);
  if (!matrix) {
    return {
      hasMatrix: false,
      rowCount: 0,
      committed: committedValue,
      certified: 0,
      remaining: committedValue,
    };
  }

  const committed = Number(committedValue) || 0;
  const certified = 0;
  return {
    hasMatrix: true,
    rowCount: matrix.rows?.length ?? 0,
    committed,
    certified,
    remaining: Math.max(0, committed - certified),
  };
}
