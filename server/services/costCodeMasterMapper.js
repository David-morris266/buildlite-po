/**
 * BL-033D.x.2A.1 — Map cost_codes rows to API documents.
 * `code` is canonical identity. `label` is display-only and is not stored.
 */

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildDisplayLabel(code, description) {
  const identity = String(code || "").trim();
  const text = String(description || "").trim();
  if (identity && text) return `${identity} — ${text}`;
  return identity || text || "";
}

function costCodeRowToDocument(row) {
  if (!row) return null;
  const code = row.code;
  const description = row.description || null;
  const reportingGroup = row.reporting_group || row.trade || null;
  return {
    id: row.id,
    clientId: row.client_id,
    code,
    description,
    label: buildDisplayLabel(code, description),
    commercialHead: row.commercial_head || null,
    commercialFamily: row.commercial_family || null,
    reportingGroup,
    trade: reportingGroup,
    hierarchyMode: row.hierarchy_mode || null,
    reportingOrder: Number(row.reporting_order) || 0,
    defaultVatTreatment: row.default_vat_treatment || "Standard",
    defaultOrderType: row.default_order_type || "S",
    allowBudget: row.allow_budget !== false,
    allowPurchaseOrders: row.allow_purchase_orders !== false,
    allowLedgerImport: row.allow_ledger_import !== false,
    allowForecastAdjustment: row.allow_forecast_adjustment !== false,
    notes: row.notes || "",
    importMetadata: row.import_metadata || null,
    active: row.is_active !== false,
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    legacy: {
      subHeading: row.sub_heading || null,
      trade: row.trade || null,
      element: row.element || null,
    },
  };
}

module.exports = {
  buildDisplayLabel,
  costCodeRowToDocument,
};
