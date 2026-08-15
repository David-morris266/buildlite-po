/**
 * BL-011B.01 — Subcontract Order derivation from approved POs (Doc 29 / Doc 30).
 * BL-009A.03A — Development-scoped package keys and approval integration.
 */

import { enrichPoWithDevelopmentRef, enrichPosWithDevelopmentRefs } from '../developments/poDevelopmentRefStore';
import {
  getPoDevelopmentId,
  getPoDevelopmentListLabel,
  mapJobToDevelopment,
  resolvePoDevelopment,
} from '../developments/developmentPoHelpers';
import { loadOrderMatrix, resolveOrderMatrixForPackage } from './orderMatrixStore';
import {
  buildSubcontractOrderKey,
  parseSubcontractOrderKey,
  runPackageKeyMigration,
} from './packageKeyMigration';
import { ensurePackageRecord } from './subcontractPackageStore';
import { getCertificateCount } from './paymentCertificateStore';

let migrationDone = false;

function ensureMigration() {
  if (migrationDone) return;
  migrationDone = true;
  runPackageKeyMigration();
}

export function getSubcontractOrderKey(developmentId, supplierId, costCode) {
  return buildSubcontractOrderKey(developmentId, supplierId, costCode);
}

export { parseSubcontractOrderKey };

export function isApprovedSubcontractPo(po) {
  if (!po || po.archived === true) return false;
  const type = String(po.type || '').toUpperCase();
  if (type !== 'S') return false;

  const approval = String(po.approval?.status || '').toLowerCase();
  const status = String(po.status || '').toLowerCase();
  return approval === 'approved' || status === 'approved';
}

export function getPoCostCode(po) {
  const code = po?.costRef?.costCode || po?.items?.[0]?.costCode;
  const value = String(code || 'general').trim();
  return value || 'general';
}

export function getPoOrderScopeId(po) {
  const enriched = enrichPoWithDevelopmentRef(po);
  const developmentId = getPoDevelopmentId(enriched);
  if (developmentId) return developmentId;

  const mapped = mapJobToDevelopment(enriched?.job);
  return mapped?.id || null;
}

export function getPoDevelopmentFields(po) {
  const resolved = resolvePoDevelopment(enrichPoWithDevelopmentRef(po));
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
  return getPoDevelopmentListLabel(enrichPoWithDevelopmentRef(po));
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
  const enriched = enrichPoWithDevelopmentRef(po);
  const developmentId = getPoOrderScopeId(enriched);
  const supplierId = enriched?.supplierId;
  if (!developmentId || !supplierId) return null;
  return getSubcontractOrderKey(
    developmentId,
    supplierId,
    getPoCostCode(enriched)
  );
}

export function buildSubcontractOrderRecordFromPo(po) {
  const enriched = enrichPoWithDevelopmentRef(po);
  const developmentId = getPoOrderScopeId(enriched);
  const supplierId = enriched?.supplierId;
  if (!developmentId || !supplierId) return null;

  const orderKey = getSubcontractOrderKey(
    developmentId,
    supplierId,
    getPoCostCode(enriched)
  );
  const developmentFields = getPoDevelopmentFields(enriched);

  return {
    orderKey,
    scopeId: String(developmentId),
    jobId: String(developmentId),
    supplierId: String(supplierId),
    costCode: getPoCostCode(enriched),
    projectLabel: getProjectLabel(enriched),
    supplierLabel: getSupplierLabel(enriched),
    ...developmentFields,
    committedValue: getPoCommittedNet(enriched),
    certifiedToDate: 0,
    certificateCount: 0,
    poNumbers: enriched.poNumber ? [enriched.poNumber] : [],
    pos: [enriched],
  };
}

export function syncPackageFromApprovedPo(po) {
  if (!isApprovedSubcontractPo(po)) return null;
  const order = buildSubcontractOrderRecordFromPo(po);
  if (!order) return null;
  return ensurePackageRecord(order.orderKey, order);
}

export function buildSubcontractOrdersFromPos(pos) {
  ensureMigration();

  const items = enrichPosWithDevelopmentRefs(Array.isArray(pos) ? pos : pos?.items || []);
  const groups = new Map();

  for (const po of items) {
    if (!isApprovedSubcontractPo(po)) continue;

    const developmentId = getPoOrderScopeId(po);
    const supplierId = po.supplierId;
    if (!developmentId || !supplierId) continue;

    const orderKey = getSubcontractOrderKey(
      developmentId,
      supplierId,
      getPoCostCode(po)
    );
    const developmentFields = getPoDevelopmentFields(po);
    const existing = groups.get(orderKey) || {
      orderKey,
      scopeId: String(developmentId),
      jobId: String(developmentId),
      supplierId: String(supplierId),
      costCode: getPoCostCode(po),
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

  const orders = Array.from(groups.values()).map((order) => {
    const matrixResolution = resolveOrderMatrixForPackage(order);
    return {
      ...order,
      remaining: Math.max(0, order.committedValue - order.certifiedToDate),
      certificateCount: getCertificateCount(order.orderKey),
      status: getSubcontractOrderStatus(order),
      hasMatrix: matrixResolution.present,
      matrixReady: matrixResolution.ready,
      matrixLoadState: matrixResolution.loadState,
      matrixRowCount: matrixResolution.matrix?.rows?.length ?? 0,
    };
  });

  return orders.sort((a, b) =>
    a.projectLabel.localeCompare(b.projectLabel, undefined, {
      sensitivity: 'base',
    })
  );
}

export function getSubcontractOrderStatus(order) {
  const matrixResolution = resolveOrderMatrixForPackage(order);
  if (!matrixResolution.ready) {
    return {
      label:
        matrixResolution.loadState === 'error'
          ? 'Unable to load matrix'
          : 'Loading matrix data…',
      modifier: 'matrix-loading',
    };
  }

  const hasMatrix = matrixResolution.present;
  const committed =
    Number(order.currentContractValue ?? order.committedValue) || 0;
  const certified =
    Number(order.certifiedGrossToDate ?? order.certifiedToDate) || 0;
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
    scopeId: order.scopeId || order.jobId,
    jobId: order.scopeId || order.jobId,
    supplierId: order.supplierId,
    costCode: order.costCode,
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
  const matrixResolution = resolveOrderMatrixForPackage(orderKey);
  if (!matrixResolution.ready) {
    return {
      hasMatrix: false,
      matrixReady: false,
      matrixLoadState: matrixResolution.loadState,
      rowCount: null,
      committed: committedValue,
      certified: null,
      remaining: null,
    };
  }

  const matrix = matrixResolution.matrix;
  if (!matrix) {
    return {
      hasMatrix: false,
      matrixReady: true,
      matrixLoadState: 'loaded',
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
    matrixReady: true,
    matrixLoadState: 'loaded',
    rowCount: matrix.rows?.length ?? 0,
    committed,
    certified,
    remaining: Math.max(0, committed - certified),
  };
}
