/**
 * BL-027B.2 — Merge server Package identity with PO-derived commercial view models.
 */

import { buildSubcontractOrdersFromPos } from './subcontractOrders';

export function buildPoOrdersForDevelopment(developmentId, pos = []) {
  return buildSubcontractOrdersFromPos(pos).filter(
    (order) => order.developmentId === developmentId
  );
}

export function findMissingServerPackageKeys(serverPackages = [], poOrders = []) {
  const serverKeys = new Set((serverPackages || []).map((pkg) => pkg.orderKey));
  const missing = [];

  for (const order of poOrders || []) {
    if (!serverKeys.has(order.orderKey)) {
      missing.push(order.orderKey);
    }
  }

  return missing;
}

function defaultCommercialFields(serverPkg) {
  return {
    scopeId: serverPkg.developmentId,
    jobId: serverPkg.developmentId,
    projectLabel: serverPkg.developmentName || serverPkg.developmentNumber || '—',
    committedValue: 0,
    certifiedToDate: 0,
    remaining: 0,
    certificateCount: 0,
    status: { label: 'Ready', modifier: 'ready' },
    hasMatrix: false,
    matrixRowCount: 0,
    pos: [],
  };
}

/**
 * Server packages drive package row existence; PO orders supply commercial fields.
 */
export function mergeServerPackagesWithPoOrders(serverPackages = [], poOrders = []) {
  const poByKey = new Map((poOrders || []).map((order) => [order.orderKey, order]));

  return (serverPackages || [])
    .map((serverPkg) => {
      const poOrder = poByKey.get(serverPkg.orderKey);
      const defaults = defaultCommercialFields(serverPkg);

      if (!poOrder) {
        const poNumbers = serverPkg.poNumbers || [];
        return {
          ...defaults,
          ...serverPkg,
          packageId: serverPkg.id,
          orderKey: serverPkg.orderKey,
          developmentId: serverPkg.developmentId,
          supplierId: serverPkg.supplierId,
          costCode: serverPkg.costCode,
          supplierLabel: serverPkg.supplierLabel || '—',
          developmentNumber: serverPkg.developmentNumber || '',
          developmentName: serverPkg.developmentName || '',
          poNumbers,
          commercialContextReady: poNumbers.length === 0,
        };
      }

      return {
        ...defaults,
        ...poOrder,
        ...serverPkg,
        packageId: serverPkg.id,
        orderKey: serverPkg.orderKey,
        developmentId: serverPkg.developmentId || poOrder.developmentId,
        supplierId: serverPkg.supplierId || poOrder.supplierId,
        costCode: serverPkg.costCode || poOrder.costCode,
        supplierLabel: poOrder.supplierLabel || serverPkg.supplierLabel || '—',
        developmentNumber:
          poOrder.developmentNumber || serverPkg.developmentNumber || '',
        developmentName: poOrder.developmentName || serverPkg.developmentName || '',
        projectLabel: poOrder.projectLabel || serverPkg.developmentName || '—',
        poNumbers: serverPkg.poNumbers?.length ? serverPkg.poNumbers : poOrder.poNumbers,
        commercialContextReady: true,
      };
    })
    .sort((a, b) =>
      String(a.projectLabel || '').localeCompare(String(b.projectLabel || ''), undefined, {
        sensitivity: 'base',
      })
    );
}
