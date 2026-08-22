/**
 * BL-033D.x.2 — Company Prelims template validation.
 * Company lines hold driver/bases/mapping. They must not hold development dates
 * or monetary defaults. Custom keys are co.prelims.*; bl.prelims.* is product-owned.
 */

const { randomUUID } = require("crypto");
const { looksLikeDisplayLabel } = require("./costCodeMasterValidation");
const { preserveCostCodeKey } = require("./prelimsItemValidation");
const { PRELIMS_DRIVER_KEYS, PRELIMS_DRIVERS } = require("./prelimsConstants");

const PRODUCT_TEMPLATE_KEY_PREFIX = "bl.prelims.";
const COMPANY_TEMPLATE_KEY_PREFIX = "co.prelims.";

const TEMPLATE_ORIGINS = {
  BUILDLITE_STANDARD: "buildlite_standard",
  BLANK: "blank",
};

const TEMPLATE_ORIGIN_KEYS = Object.values(TEMPLATE_ORIGINS);
const TEMPLATE_TIME_BASES = ["SITE_START", "FIRST_COMPLETION", "FINAL_COMPLETION"];
const MAX_NAME_LENGTH = 120;
const MAX_KEY_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_CATEGORY_LENGTH = 80;

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function parseName(value, errors, { required = true } = {}) {
  const name = String(value || "").trim();
  if (!name) {
    if (required) errors.push("name is required.");
    return "";
  }
  if (name.length > MAX_NAME_LENGTH) {
    errors.push("name must be 120 characters or fewer.");
  }
  return name;
}

function parseBoolean(value, field, errors) {
  if (value == null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  errors.push(`${field} must be a boolean.`);
  return null;
}

function parseOptionalBasis(value, field, errors) {
  if (value == null || value === "") return null;
  const basis = String(value).trim();
  if (basis === "FIXED_DATE") {
    errors.push(`${field} cannot be FIXED_DATE on a company template.`);
    return null;
  }
  if (!TEMPLATE_TIME_BASES.includes(basis)) {
    errors.push(`${field} is not a valid programme TIME basis.`);
    return null;
  }
  return basis;
}

function generateCompanyTemplateKey() {
  return `${COMPANY_TEMPLATE_KEY_PREFIX}${randomUUID()}`;
}

function isProductStandardTemplateKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith(PRODUCT_TEMPLATE_KEY_PREFIX);
}

function parseTemplateKey(value, errors, { required = true } = {}) {
  const key = String(value || "").trim();
  if (!key) {
    if (required) errors.push("templateKey is required.");
    return "";
  }
  if (key.length > MAX_KEY_LENGTH) {
    errors.push("templateKey must be 80 characters or fewer.");
  }
  return key;
}

function validateCreateTemplateBody(body = {}) {
  const errors = [];
  const origin = String(body.origin || "").trim();
  if (!TEMPLATE_ORIGIN_KEYS.includes(origin)) {
    errors.push("origin must be buildlite_standard or blank.");
  }
  const name = parseName(body.name, errors, { required: origin === TEMPLATE_ORIGINS.BLANK });
  const isDefault = parseBoolean(body.isDefault, "isDefault", errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      origin,
      name:
        name ||
        (origin === TEMPLATE_ORIGINS.BUILDLITE_STANDARD ? "BuildLite Standard Prelims" : ""),
      isDefault,
    },
  };
}

function validateUpdateTemplateBody(body = {}) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null || expectedVersion < 1) {
    errors.push("version must be a positive integer.");
  }
  const name = body.name === undefined ? undefined : parseName(body.name, errors);
  const isDefault =
    body.isDefault === undefined ? undefined : parseBoolean(body.isDefault, "isDefault", errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, expectedVersion, value: { name, isDefault } };
}

function validateTemplateLineBody(
  body = {},
  { requireVersion = false, allowMissingKey = false } = {}
) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null || (requireVersion && expectedVersion < 1)) {
    errors.push("version must be a non-negative integer.");
  }

  const templateKey = parseTemplateKey(body.templateKey, errors, {
    required: !allowMissingKey,
  });
  const name = parseName(body.name, errors);
  const description =
    body.description == null || body.description === ""
      ? null
      : String(body.description).trim().slice(0, MAX_DESCRIPTION_LENGTH);
  const category =
    body.category == null || body.category === ""
      ? null
      : String(body.category).trim().slice(0, MAX_CATEGORY_LENGTH);

  let costCodeKey = null;
  if (body.costCodeKey != null && body.costCodeKey !== "") {
    const incoming = preserveCostCodeKey(body.costCodeKey);
    if (looksLikeDisplayLabel(incoming)) {
      errors.push("costCodeKey must be the canonical customer code, not a display label.");
    } else {
      costCodeKey = incoming || null;
    }
  }

  const forecastDriver = String(body.forecastDriver || "").trim();
  if (forecastDriver === "STANDARD_CVR") {
    errors.push("STANDARD_CVR is the existing CVR path and cannot be a Prelims template line.");
  } else if (!PRELIMS_DRIVER_KEYS.includes(forecastDriver)) {
    errors.push("forecastDriver must be TIME or LUMP_SUM.");
  }

  let startBasis = null;
  let endBasis = null;
  if (body.monthlyRate != null && body.monthlyRate !== "") {
    errors.push("Company templates cannot store monetary defaults.");
  }
  if (body.lumpSumAmount != null && body.lumpSumAmount !== "") {
    errors.push("Company templates cannot store monetary defaults.");
  }

  if (forecastDriver === PRELIMS_DRIVERS.TIME) {
    startBasis = parseOptionalBasis(body.startBasis, "startBasis", errors);
    endBasis = parseOptionalBasis(body.endBasis, "endBasis", errors);
  } else if (forecastDriver === PRELIMS_DRIVERS.LUMP_SUM) {
    startBasis = null;
    endBasis = null;
  }

  let displayOrder = 0;
  if (body.displayOrder != null && body.displayOrder !== "") {
    const parsed = Number(body.displayOrder);
    if (!Number.isInteger(parsed)) errors.push("displayOrder must be an integer.");
    else displayOrder = parsed;
  }

  const enabled = body.enabled == null || body.enabled === "" ? true : parseBoolean(body.enabled, "enabled", errors);
  if (enabled == null && body.enabled != null && body.enabled !== "") {
    /* parseBoolean already recorded the error */
  }

  if (
    /siteStart|firstCompletion|finalCompletion|reportingMonth|startFixedDate|endFixedDate/i.test(
      JSON.stringify(body)
    )
  ) {
    if (
      body.siteStart != null ||
      body.firstCompletion != null ||
      body.finalCompletion != null ||
      body.reportingMonth != null ||
      body.startFixedDate != null ||
      body.endFixedDate != null
    ) {
      errors.push("Company templates cannot store development dates or reporting month.");
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    expectedVersion,
    value: {
      templateKey,
      name,
      description,
      category,
      costCodeKey,
      forecastDriver,
      startBasis,
      endBasis,
      monthlyRate: null,
      lumpSumAmount: null,
      displayOrder,
      enabled: enabled !== false,
    },
  };
}

module.exports = {
  COMPANY_TEMPLATE_KEY_PREFIX,
  PRODUCT_TEMPLATE_KEY_PREFIX,
  TEMPLATE_ORIGINS,
  TEMPLATE_ORIGIN_KEYS,
  TEMPLATE_TIME_BASES,
  generateCompanyTemplateKey,
  isProductStandardTemplateKey,
  parseExpectedVersion,
  validateCreateTemplateBody,
  validateUpdateTemplateBody,
  validateTemplateLineBody,
};
