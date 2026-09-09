/**
 * BL-033D.x.2A.1 — Validate tenant Cost Code Master bodies.
 * Master identity is the trimmed code as entered. No CVR hyphen-stripping.
 * Code is immutable after create.
 */

const {
  DEFAULT_ORDER_TYPE,
  DEFAULT_VAT_TREATMENT,
  HIERARCHY_MODE_KEYS,
  HIERARCHY_MODES,
  MAX_COST_CODE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_HIERARCHY_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  ORDER_TYPE_KEYS,
  VAT_TREATMENT_KEYS,
} = require("./costCodeMasterConstants");

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function looksLikeDisplayLabel(value) {
  return /[—]/.test(value) || / – /.test(value) || / - /.test(value);
}

function preserveCostCodeIdentity(value) {
  return String(value || "").trim();
}

function parseCode(value, errors, { required = true } = {}) {
  const code = preserveCostCodeIdentity(value);
  if (!code) {
    if (required) errors.push("code is required.");
    return "";
  }
  if (code.length > MAX_COST_CODE_LENGTH) {
    errors.push(`code must be ${MAX_COST_CODE_LENGTH} characters or fewer.`);
  }
  if (looksLikeDisplayLabel(code)) {
    errors.push("code must be the customer cost-code identity, not a display label.");
  }
  return code;
}

function parseRequiredText(value, field, errors, maxLength) {
  const text = String(value == null ? "" : value).trim();
  if (!text) {
    errors.push(`${field} is required.`);
    return "";
  }
  if (text.length > maxLength) {
    errors.push(`${field} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function parseOptionalText(value, field, errors, maxLength) {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > maxLength) {
    errors.push(`${field} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

function parseBoolean(value, field, errors, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "yes") return true;
  if (value === "false" || value === "no") return false;
  errors.push(`${field} must be a boolean.`);
  return fallback;
}

function parseInteger(value, field, errors, fallback) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    errors.push(`${field} must be an integer.`);
    return fallback;
  }
  return parsed;
}

function parseEnum(value, field, errors, allowed, fallback) {
  if (value == null || value === "") return fallback;
  const text = String(value).trim();
  if (!allowed.includes(text)) {
    errors.push(`${field} is not valid.`);
    return fallback;
  }
  return text;
}

function resolveHierarchyMode(commercialFamily, hierarchyMode, errors) {
  if (hierarchyMode != null && hierarchyMode !== "") {
    return parseEnum(hierarchyMode, "hierarchyMode", errors, HIERARCHY_MODE_KEYS, null);
  }
  return String(commercialFamily || "").trim()
    ? HIERARCHY_MODES.THREE_LEVEL
    : HIERARCHY_MODES.TWO_LEVEL;
}

function parseImportMetadata(value, errors) {
  if (value == null || value === "") return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  errors.push("importMetadata must be an object.");
  return null;
}

function sharedFields(body = {}, errors, { requireCommercialMetadata = true, existing = null } = {}) {
  const description = parseRequiredText(
    body.description,
    "description",
    errors,
    MAX_DESCRIPTION_LENGTH
  );
  const hasCommercialHead = Object.prototype.hasOwnProperty.call(body, "commercialHead");
  const hasCommercialFamily = Object.prototype.hasOwnProperty.call(body, "commercialFamily");
  const hasReportingGroup = Object.prototype.hasOwnProperty.call(body, "reportingGroup")
    || Object.prototype.hasOwnProperty.call(body, "trade");
  const commercialMetadataChanged = hasCommercialHead || hasCommercialFamily || hasReportingGroup;
  const validateCommercialMetadata = requireCommercialMetadata || commercialMetadataChanged;
  const commercialHeadValue = hasCommercialHead ? body.commercialHead : existing?.commercial_head;
  const commercialHead = validateCommercialMetadata
    ? parseRequiredText(commercialHeadValue, "commercialHead", errors, MAX_HIERARCHY_NAME_LENGTH)
    : existing?.commercial_head ?? null;
  const commercialFamily = hasCommercialFamily
    ? parseOptionalText(body.commercialFamily, "commercialFamily", errors, MAX_HIERARCHY_NAME_LENGTH)
    : existing?.commercial_family ?? "";
  const reportingGroupValue = hasReportingGroup
    ? body.reportingGroup || body.trade
    : existing?.reporting_group;
  const reportingGroup = validateCommercialMetadata
    ? parseRequiredText(reportingGroupValue, "reportingGroup", errors, MAX_HIERARCHY_NAME_LENGTH)
    : existing?.reporting_group ?? null;
  const trade = hasReportingGroup ? reportingGroup : existing?.trade ?? reportingGroup;
  const hierarchyMode = Object.prototype.hasOwnProperty.call(body, "hierarchyMode") || commercialMetadataChanged
    ? resolveHierarchyMode(commercialFamily, body.hierarchyMode, errors)
    : existing?.hierarchy_mode ?? null;
  const reportingOrder = parseInteger(body.reportingOrder, "reportingOrder", errors, existing?.reporting_order ?? 0);
  const defaultVatTreatment = parseEnum(
    body.defaultVatTreatment,
    "defaultVatTreatment",
    errors,
    VAT_TREATMENT_KEYS,
    existing?.default_vat_treatment ?? DEFAULT_VAT_TREATMENT
  );
  const defaultOrderType = parseEnum(
    body.defaultOrderType,
    "defaultOrderType",
    errors,
    ORDER_TYPE_KEYS,
    existing?.default_order_type ?? DEFAULT_ORDER_TYPE
  );
  const allowBudget = parseBoolean(body.allowBudget, "allowBudget", errors, existing?.allow_budget ?? true);
  const allowPurchaseOrders = parseBoolean(
    body.allowPurchaseOrders,
    "allowPurchaseOrders",
    errors,
    existing?.allow_purchase_orders ?? true
  );
  const allowLedgerImport = parseBoolean(
    body.allowLedgerImport,
    "allowLedgerImport",
    errors,
    existing?.allow_ledger_import ?? true
  );
  const allowForecastAdjustment = parseBoolean(
    body.allowForecastAdjustment,
    "allowForecastAdjustment",
    errors,
    existing?.allow_forecast_adjustment ?? true
  );
  const notes = Object.prototype.hasOwnProperty.call(body, "notes")
    ? parseOptionalText(body.notes, "notes", errors, MAX_NOTES_LENGTH)
    : existing?.notes ?? "";
  const importMetadata = Object.prototype.hasOwnProperty.call(body, "importMetadata")
    ? parseImportMetadata(body.importMetadata, errors)
    : existing?.import_metadata ?? null;
  const active = parseBoolean(body.active ?? body.isActive, "active", errors, existing?.is_active ?? true);

  return {
    description,
    commercialHead,
    commercialFamily,
    reportingGroup,
    trade,
    hierarchyMode,
    reportingOrder,
    defaultVatTreatment,
    defaultOrderType,
    allowBudget,
    allowPurchaseOrders,
    allowLedgerImport,
    allowForecastAdjustment,
    notes,
    importMetadata,
    active,
  };
}

function validateCreateCostCodeBody(body = {}) {
  const errors = [];
  const code = parseCode(body.code, errors, { required: true });
  const fields = sharedFields(body, errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { code, ...fields } };
}

function validateUpdateCostCodeBody(body = {}, existing) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null || expectedVersion < 1) {
    errors.push("version must be a positive integer.");
  }
  if (body.code != null && body.code !== "") {
    const incoming = parseCode(body.code, errors, { required: false });
    if (incoming && incoming !== existing.code) {
      errors.push("code cannot be changed after creation.");
    }
  }
  const descriptionBody = Object.prototype.hasOwnProperty.call(body, "description")
    ? body
    : { ...body, description: existing.description };
  const fields = sharedFields(descriptionBody, errors, {
    requireCommercialMetadata: false,
    existing,
  });
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    expectedVersion,
    value: { code: existing.code, ...fields },
  };
}

function validateActiveCostCodeBody(body = {}) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null || expectedVersion < 1) {
    errors.push("version must be a positive integer.");
  }
  const active = parseBoolean(body.active ?? body.isActive, "active", errors, null);
  if (active == null) errors.push("active is required.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, expectedVersion, value: { active } };
}

module.exports = {
  looksLikeDisplayLabel,
  parseExpectedVersion,
  preserveCostCodeIdentity,
  validateActiveCostCodeBody,
  validateCreateCostCodeBody,
  validateUpdateCostCodeBody,
};
