/**
 * BL-029A — Order Matrix row ↔ API document mapping.
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

function rowToDocument(row) {
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};

  return {
    id: row.id,
    packageId: row.package_id,
    orderKey: row.order_key,
    developmentId: row.development_id,
    layout: row.layout,
    committedValue: toNumberOrNull(row.committed_value),
    stages: Array.isArray(payload.stages) ? payload.stages : [],
    plots: Array.isArray(payload.plots) ? payload.plots : [],
    jobId: payload.jobId || "",
    supplierId: payload.supplierId || "",
    projectLabel: payload.projectLabel || "",
    supplierLabel: payload.supplierLabel || "",
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

module.exports = {
  rowToDocument,
};
