/**
 * BL-021B.2 — Recovery package picker options for linked contra charge creation.
 */

import { buildPackageCommercialDisplayFields } from './commercialEventPackageValue';
import { buildSubcontractOrdersFromPos } from '../payments/subcontractOrders';

export function buildRecoveryPackageOptions(developmentId, originPackageId, pos = []) {
  if (!developmentId) return [];

  return buildSubcontractOrdersFromPos(pos)
    .filter((order) => order.developmentId === developmentId)
    .filter((order) => order.orderKey && order.orderKey !== originPackageId)
    .map((order) => {
      const display = buildPackageCommercialDisplayFields(order);
      return {
        orderKey: order.orderKey,
        developmentId: order.developmentId,
        supplierId: order.supplierId,
        supplierLabel: order.supplierLabel || '—',
        costCode: order.costCode || '—',
        poNumbers: order.poNumbers || [],
        committedValue: Number(order.committedValue) || 0,
        currentPackageValue: display.currentPackageValue,
      };
    })
    .sort((a, b) => {
      const supplierCompare = String(a.supplierLabel).localeCompare(
        String(b.supplierLabel)
      );
      if (supplierCompare !== 0) return supplierCompare;
      return String(a.costCode).localeCompare(String(b.costCode));
    });
}

export function formatRecoveryPackageOptionLabel(option) {
  const poLabel =
    option.poNumbers?.length > 0 ? option.poNumbers.join(', ') : 'No PO';
  return `${option.supplierLabel} · ${option.costCode} · ${poLabel}`;
}
