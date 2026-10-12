export const EMPTY_SUPPLIER_ADMIN_FORM = Object.freeze({
  name: '',
  supplierType: 'subcontractor',
  preferredTrade: '',
  preferredCommercialHead: '',
  termsDays: 30,
  creditAccount: false,
  cisStatus: '',
  insuranceExpiry: '',
  defaultVat: 'Standard',
  vatStatus: 'VAT Registered',
  active: true,
  notes: '',
});

const EDITABLE_SUPPLIER_FIELDS = Object.freeze(Object.keys(EMPTY_SUPPLIER_ADMIN_FORM));

export function supplierToAdminForm(supplier = {}) {
  return {
    name: supplier.name ?? '',
    supplierType: supplier.supplierType ?? '',
    preferredTrade: supplier.preferredTrade ?? '',
    preferredCommercialHead: supplier.preferredCommercialHead ?? '',
    termsDays: supplier.termsDays ?? '',
    creditAccount: supplier.creditAccount ?? false,
    cisStatus: supplier.cisStatus ?? '',
    insuranceExpiry: supplier.insuranceExpiry ?? '',
    defaultVat: supplier.defaultVat ?? '',
    vatStatus: supplier.vatStatus ?? '',
    active: supplier.active ?? true,
    notes: supplier.notes ?? '',
  };
}

export function buildAdminSupplierSavePayload(form, { isNew, initialForm } = {}) {
  const fields = isNew
    ? EDITABLE_SUPPLIER_FIELDS
    : EDITABLE_SUPPLIER_FIELDS.filter((field) => form[field] !== initialForm?.[field]);
  return Object.fromEntries(fields.map((field) => {
    if (field === 'termsDays') return [field, form[field] === '' ? null : Number(form[field])];
    if (['creditAccount', 'active'].includes(field)) return [field, Boolean(form[field])];
    return [field, form[field]];
  }));
}
