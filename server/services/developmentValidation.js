/**
 * BL-027A.1 — Development create/update validation (server-side).
 */

const {
  DEFAULT_DEVELOPMENT_STATUS,
  isValidDevelopmentId,
  isValidDevelopmentStatus,
} = require("./developmentConstants");

function asTrimmedString(value) {
  if (value == null) return "";
  return String(value).trim();
}

function validateDateOrder(startDate, targetCompletion) {
  const start = asTrimmedString(startDate);
  const target = asTrimmedString(targetCompletion);
  if (!start || !target) return null;
  if (target < start) {
    return "Target completion must be on or after the start date.";
  }
  return null;
}

function validateDevelopmentDocument(document, { requireId = false } = {}) {
  const errors = [];

  const id = asTrimmedString(document?.id);
  if (requireId) {
    if (!id) errors.push("id is required.");
    else if (!isValidDevelopmentId(id)) errors.push("id must be a valid dev-* identifier.");
  } else if (id && !isValidDevelopmentId(id)) {
    errors.push("id must be a valid dev-* identifier.");
  }

  const jobNumber = asTrimmedString(document?.jobNumber);
  if (!jobNumber) errors.push("jobNumber is required.");

  const developmentName = asTrimmedString(document?.developmentName);
  if (!developmentName) errors.push("developmentName is required.");

  const status = asTrimmedString(document?.status || DEFAULT_DEVELOPMENT_STATUS);
  if (!isValidDevelopmentStatus(status)) {
    errors.push(`status must be one of: planning, pre-construction, live, complete.`);
  }

  const dateError = validateDateOrder(document?.startDate, document?.targetCompletion);
  if (dateError) errors.push(dateError);

  const normalized = {
    ...document,
    jobNumber,
    developmentName,
    status,
  };
  if (id) normalized.id = id;

  return {
    ok: errors.length === 0,
    errors,
    normalized,
  };
}

function validateCreateBody(body = {}) {
  return validateDevelopmentDocument(body, { requireId: false });
}

function validateUpdateBody(body = {}, existingDocument) {
  const merged = {
    ...existingDocument,
    ...body,
    id: existingDocument.id,
    jobNumber: body.jobNumber !== undefined ? body.jobNumber : existingDocument.jobNumber,
    developmentName:
      body.developmentName !== undefined
        ? body.developmentName
        : existingDocument.developmentName,
    status: body.status !== undefined ? body.status : existingDocument.status,
    startDate: body.startDate !== undefined ? body.startDate : existingDocument.startDate,
    targetCompletion:
      body.targetCompletion !== undefined
        ? body.targetCompletion
        : existingDocument.targetCompletion,
  };

  const result = validateDevelopmentDocument(merged, { requireId: true });
  return { ...result, merged };
}

module.exports = {
  validateCreateBody,
  validateUpdateBody,
  validateDateOrder,
  validateDevelopmentDocument,
};
