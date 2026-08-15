/**
 * BL-029B — Normalise BL-029A Order Matrix API documents to client shape.
 *
 * Client-facing helpers continue to key matrices by orderKey, not package UUID.
 */

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value) {
  if (value == null) return '';
  return String(value);
}

/**
 * @param {object|null} document - Raw BL-029A API matrix document
 * @returns {object|null}
 */
export function normalizeServerOrderMatrix(document) {
  if (!document || typeof document !== 'object') return null;

  const orderKey = String(document.orderKey || document.order_key || '').trim();
  if (!orderKey) return null;

  const layout = String(document.layout || '').trim() || 'plot-stage';
  const stages = Array.isArray(document.stages) ? document.stages : [];
  const plots = Array.isArray(document.plots) ? document.plots : [];

  return {
    orderKey,
    jobId: toStringValue(document.jobId || document.developmentId || document.development_id),
    developmentId: toStringValue(document.developmentId || document.development_id),
    supplierId: toStringValue(document.supplierId || document.supplier_id),
    projectLabel: toStringValue(document.projectLabel || document.project_label),
    supplierLabel: toStringValue(document.supplierLabel || document.supplier_label),
    committedValue: toNumberOrNull(document.committedValue ?? document.committed_value),
    layout,
    stages,
    plots,
    updatedAt: document.updatedAt || document.updated_at || null,
    createdAt: document.createdAt || document.created_at || null,
    matrixId: document.id || document.matrixId || null,
    packageUuid: document.packageId || document.packageUuid || document.package_id || null,
    version: document.version ?? null,
  };
}

export function normalizeServerOrderMatrixList(documents = []) {
  if (!Array.isArray(documents)) return [];
  return documents.map(normalizeServerOrderMatrix).filter(Boolean);
}
