const COMMERCIAL_HEADS = Object.freeze([
  "Land",
  "Professional Fees",
  "Preliminaries",
  "House Build",
  "Plot Works",
  "External Works / Infrastructure",
  "Sales & Marketing",
  "Finance & Legal",
  "Customer Costs",
]);

const MAX_HIERARCHY_NAME_LENGTH = 120;

function optionalText(value, field, errors) {
  if (value == null) return null;
  const result = String(value).trim();
  if (!result) return null;
  if (result.length > MAX_HIERARCHY_NAME_LENGTH) {
    errors.push(`${field} must be ${MAX_HIERARCHY_NAME_LENGTH} characters or fewer.`);
  }
  return result;
}

function validateHierarchyUpdates(body = {}) {
  const errors = [];
  const input = Array.isArray(body.updates) ? body.updates : [];
  if (!input.length) errors.push("updates must contain at least one hierarchy change.");
  if (input.length > 500) errors.push("updates cannot contain more than 500 cost codes.");
  const seen = new Set();
  const updates = input.map((entry, index) => {
    const id = String(entry?.id || "").trim();
    const version = Number(entry?.version);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) errors.push(`updates[${index}].id is invalid.`);
    if (!Number.isInteger(version) || version < 1) errors.push(`updates[${index}].version is invalid.`);
    if (seen.has(id)) errors.push(`updates[${index}].id is duplicated.`);
    seen.add(id);
    const commercialHead = optionalText(entry?.commercialHead, `updates[${index}].commercialHead`, errors);
    const commercialFamily = optionalText(entry?.commercialFamily, `updates[${index}].commercialFamily`, errors);
    const reportingGroup = optionalText(entry?.reportingGroup, `updates[${index}].reportingGroup`, errors);
    if (commercialHead && !COMMERCIAL_HEADS.includes(commercialHead)) {
      errors.push(`updates[${index}].commercialHead is not valid.`);
    }
    if (!commercialHead && (commercialFamily || reportingGroup)) {
      errors.push(`updates[${index}] cannot set Family or Reporting Group while Commercial Head is Unallocated.`);
    }
    if (commercialHead && !reportingGroup) {
      errors.push(`updates[${index}].reportingGroup is required when Commercial Head is assigned.`);
    }
    return { id, version, commercialHead, commercialFamily, reportingGroup };
  });
  return { ok: errors.length === 0, errors, updates };
}

module.exports = { COMMERCIAL_HEADS, validateHierarchyUpdates };
