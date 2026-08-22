/**
 * BL-033D.x.2A.1 — Map server Cost Code Master documents for the client cache.
 */

export function normalizeServerCostCode(document) {
  if (!document || typeof document !== 'object') return null;
  const code = String(document.code || '').trim();
  if (!code) return null;
  const description = document.description ? String(document.description).trim() : '';
  return {
    id: document.id,
    code,
    description,
    label: document.label || (description ? `${code} — ${description}` : code),
    commercialHead: document.commercialHead || '',
    commercialFamily: document.commercialFamily || '',
    reportingGroup: document.reportingGroup || document.trade || '',
    trade: document.reportingGroup || document.trade || '',
    hierarchyMode: document.hierarchyMode || null,
    reportingOrder: Number(document.reportingOrder) || 0,
    defaultVatTreatment: document.defaultVatTreatment || 'Standard',
    defaultOrderType: document.defaultOrderType || 'S',
    allowBudget: document.allowBudget !== false,
    allowPurchaseOrders: document.allowPurchaseOrders !== false,
    allowLedgerImport: document.allowLedgerImport !== false,
    allowForecastAdjustment: document.allowForecastAdjustment !== false,
    notes: document.notes || '',
    importMetadata: document.importMetadata || null,
    active: document.active !== false,
    version: Number(document.version) || 1,
    createdAt: document.createdAt || null,
    updatedAt: document.updatedAt || null,
    createdBy: document.createdBy ?? null,
    updatedBy: document.updatedBy ?? null,
  };
}

export function normalizeServerCostCodeList(payload) {
  const rows = Array.isArray(payload?.costCodes)
    ? payload.costCodes
    : Array.isArray(payload)
      ? payload
      : null;
  if (!rows) return null;
  return rows.map(normalizeServerCostCode).filter(Boolean);
}
