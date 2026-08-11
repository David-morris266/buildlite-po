/**
 * BL-027B.1 — Row ↔ Package document mapping.
 */

const PROMOTED_DOCUMENT_KEYS = new Set([
  "id",
  "orderKey",
  "developmentId",
  "supplierId",
  "costCode",
  "supplierLabel",
  "developmentNumber",
  "developmentName",
  "version",
  "createdAt",
  "updatedAt",
  "materialisedAt",
  "createdBy",
  "updatedBy",
  "poNumbers",
]);

function extractPayloadFromDocument(document = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(document)) {
    if (PROMOTED_DOCUMENT_KEYS.has(key)) continue;
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

function rowToDocument(row, poNumbers = []) {
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};

  return {
    id: row.id,
    orderKey: row.order_key,
    developmentId: row.development_id,
    supplierId: row.supplier_id,
    costCode: row.cost_code,
    supplierLabel: row.supplier_label ?? "",
    developmentNumber: row.development_number ?? "",
    developmentName: row.development_name ?? "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    materialisedAt: row.materialised_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    poNumbers: [...poNumbers],
    ...payload,
  };
}

module.exports = {
  PROMOTED_DOCUMENT_KEYS,
  extractPayloadFromDocument,
  rowToDocument,
};
