/**
 * BL-013 — Supplier type catalogue and PO order-type mapping.
 */

export const SUPPLIER_TYPES = [
  { value: 'subcontractor', label: 'Subcontractor', orderType: 'S' },
  { value: 'materials', label: 'Materials Supplier', orderType: 'M' },
  { value: 'plant', label: 'Plant Hire', orderType: 'P' },
  { value: 'consultant', label: 'Professional Consultant', orderType: 'S' },
  { value: 'utility', label: 'Utility', orderType: 'M' },
  { value: 'sales', label: 'Sales & Marketing', orderType: 'M' },
  { value: 'other', label: 'Other', orderType: 'M' },
];

export function getSupplierTypeMeta(value) {
  return (
    SUPPLIER_TYPES.find((item) => item.value === value) ||
    SUPPLIER_TYPES.find((item) => item.value === 'other')
  );
}

export function getSuggestedOrderTypeForSupplier(supplier) {
  const meta = getSupplierTypeMeta(supplier?.supplierType);
  return meta?.orderType || 'M';
}

export function isOrderTypeCompatible(supplierType, orderType) {
  const suggested = getSupplierTypeMeta(supplierType)?.orderType;
  if (!suggested || !orderType) return true;
  return String(suggested).toUpperCase() === String(orderType).toUpperCase();
}
