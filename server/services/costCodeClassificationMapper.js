/**
 * BL-033B — Map cost_code_classifications rows to API documents.
 */

const {
  DEFAULT_FORECAST_DRIVER,
  DEFAULT_SEMANTIC_GROUP,
} = require("./costCodeClassificationConstants");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function unmappedDocument(costCodeKey = "") {
  return {
    id: null,
    costCodeKey: costCodeKey || "",
    exists: false,
    semanticGroup: DEFAULT_SEMANTIC_GROUP,
    forecastDriver: DEFAULT_FORECAST_DRIVER,
    version: 0,
    createdAt: null,
    updatedAt: null,
    createdBy: null,
    updatedBy: null,
  };
}

function classificationRowToDocument(row, fallbackKey = "") {
  if (!row) return unmappedDocument(fallbackKey);
  return {
    id: row.id,
    costCodeKey: row.cost_code_key,
    exists: true,
    semanticGroup: row.semantic_group,
    forecastDriver: row.forecast_driver || DEFAULT_FORECAST_DRIVER,
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

module.exports = {
  unmappedDocument,
  classificationRowToDocument,
};
