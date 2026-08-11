/**
 * BL-027A.1 — Row ↔ Development document mapping.
 * Preserves unknown payload fields and supports partial PUT merges.
 */

const PROMOTED_DOCUMENT_KEYS = new Set([
  "id",
  "jobNumber",
  "developmentName",
  "status",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
]);

function extractPayloadFromDocument(document = {}) {
  const payload = {};
  for (const [key, value] of Object.entries(document)) {
    if (PROMOTED_DOCUMENT_KEYS.has(key)) continue;
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}

function rowToDocument(row) {
  if (!row) return null;
  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};

  return {
    id: row.id,
    jobNumber: row.job_number,
    developmentName: row.development_name,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    ...payload,
  };
}

function documentToInsertRow(document, { clientId, actor = null } = {}) {
  const payload = extractPayloadFromDocument(document);

  return {
    id: document.id,
    client_id: clientId,
    job_number: String(document.jobNumber || "").trim(),
    development_name: String(document.developmentName || "").trim(),
    status: document.status,
    payload,
    version: 1,
    created_by: document.createdBy ?? actor ?? null,
    updated_by: document.updatedBy ?? actor ?? null,
  };
}

function mergeDevelopmentPatch(existingDocument, patch = {}) {
  const next = { ...existingDocument };

  for (const [key, value] of Object.entries(patch)) {
    if (
      key === "id" ||
      key === "version" ||
      key === "createdAt" ||
      key === "createdBy"
    ) {
      continue;
    }
    if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
}

function documentToUpdateRow(mergedDocument, { actor = null } = {}) {
  const payload = extractPayloadFromDocument(mergedDocument);

  return {
    job_number: String(mergedDocument.jobNumber || "").trim(),
    development_name: String(mergedDocument.developmentName || "").trim(),
    status: mergedDocument.status,
    payload,
    updated_by: mergedDocument.updatedBy ?? actor ?? null,
  };
}

module.exports = {
  PROMOTED_DOCUMENT_KEYS,
  extractPayloadFromDocument,
  rowToDocument,
  documentToInsertRow,
  mergeDevelopmentPatch,
  documentToUpdateRow,
};
