/**
 * BL-033D.x.1 — Map company Prelims template rows to API documents.
 */

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function templateRowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    origin: row.origin,
    sourceStandardVersion: row.source_standard_version == null ? null : Number(row.source_standard_version),
    isDefault: Boolean(row.is_default),
    version: Number(row.version) || 1,
    lineCount: row.line_count == null ? undefined : Number(row.line_count),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

function templateLineRowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    templateId: row.template_id,
    templateKey: row.template_key,
    name: row.name,
    description: row.description || null,
    category: row.category || null,
    costCodeKey: row.cost_code_key || null,
    forecastDriver: row.forecast_driver,
    startBasis: row.start_basis || null,
    endBasis: row.end_basis || null,
    monthlyRate: toNumberOrNull(row.monthly_rate),
    lumpSumAmount: toNumberOrNull(row.lump_sum_amount),
    displayOrder: Number(row.display_order) || 0,
    enabled: Boolean(row.enabled),
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

module.exports = {
  templateRowToDocument,
  templateLineRowToDocument,
};
