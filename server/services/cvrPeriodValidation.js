/**
 * BL-031A — CVR period / cost-code input validation.
 */

const {
  MAX_COST_CODE_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  emptyCommentary,
  isValidPeriodKey,
} = require("./cvrPeriodConstants");

function roundMoney(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function requiredMoney(value, field, errors, { allowZero = true } = {}) {
  const money = roundMoney(value);
  if (money == null) {
    errors.push(`${field} must be a finite amount.`);
    return 0;
  }
  if (!allowZero && money === 0) {
    errors.push(`${field} must not be zero.`);
  }
  return money;
}

function optionalMoney(value, field, errors) {
  if (value == null || value === "") return null;
  const money = roundMoney(value);
  if (money == null) {
    errors.push(`${field} must be a finite amount.`);
    return null;
  }
  return money;
}

function trimText(value, max = MAX_LABEL_LENGTH) {
  return String(value || "").trim().slice(0, max);
}

function normaliseCostCodeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let codePart = raw.split("—")[0].split(" - ")[0].split(" – ")[0].trim();
  if (codePart.includes("-") && !/\s/.test(codePart)) {
    const hyphenParts = codePart.split("-");
    if (hyphenParts.length === 2 && hyphenParts[0].length <= 12) {
      codePart = hyphenParts[0].trim();
    }
  }
  return codePart.replace(/\s+/g, "").toLowerCase().slice(0, MAX_COST_CODE_KEY_LENGTH);
}

function parseReportingMonth(value, errors) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const monthMatch = raw.match(/^(\d{4})-(\d{2})$/);
  const dateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (monthMatch) {
    return `${monthMatch[1]}-${monthMatch[2]}-01`;
  }
  if (dateMatch) {
    return `${dateMatch[1]}-${dateMatch[2]}-01`;
  }
  errors.push("reportingMonth must be YYYY-MM or YYYY-MM-DD.");
  return null;
}

function normaliseCommentary(value, errors) {
  if (value == null || value === "") return emptyCommentary();
  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push("commentary must be an object.");
    return emptyCommentary();
  }
  return {
    keyCommercialIssues: trimText(value.keyCommercialIssues, 4000),
    commercialOpportunities: trimText(value.commercialOpportunities, 4000),
    financialRisks: trimText(value.financialRisks, 4000),
    actionsBeforeNextCvr: trimText(value.actionsBeforeNextCvr, 4000),
  };
}

function parseExpectedVersion(expectedVersion) {
  const parsed = Number(expectedVersion);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function validateCreatePeriodBody(body = {}) {
  const errors = [];
  const periodKey = body.periodKey == null || body.periodKey === ""
    ? null
    : String(body.periodKey).trim().toUpperCase();
  if (periodKey && !isValidPeriodKey(periodKey)) {
    errors.push("periodKey must be 1–32 characters.");
  }
  const periodLabel = trimText(body.periodLabel || periodKey || "");
  const reportingMonth = parseReportingMonth(body.reportingMonth, errors);
  const commentary = normaliseCommentary(body.commentary, errors);

  return {
    ok: errors.length === 0,
    errors,
    value: {
      periodKey,
      periodLabel,
      reportingMonth,
      commentary,
    },
  };
}

function validatePatchPeriodBody(body = {}) {
  const errors = [];
  const value = {};

  if (body.periodLabel !== undefined) {
    value.periodLabel = trimText(body.periodLabel);
    if (!value.periodLabel) errors.push("periodLabel must not be blank.");
  }
  if (body.reportingMonth !== undefined) {
    value.reportingMonth = parseReportingMonth(body.reportingMonth, errors);
  }
  if (body.commentary !== undefined) {
    value.commentary = normaliseCommentary(body.commentary, errors);
  }

  const version = parseExpectedVersion(body.version);
  if (version == null) {
    errors.push("version is required and must be a positive integer.");
  }

  return {
    ok: errors.length === 0,
    errors,
    version,
    value,
  };
}

function validateCostCodeInputBody(body = {}, { requireVersion = false } = {}) {
  const errors = [];
  const costCodeKey = normaliseCostCodeKey(body.costCodeKey || body.costCode);
  if (!costCodeKey) {
    errors.push("costCodeKey is required.");
  }

  const costCodeLabel = trimText(body.costCodeLabel || body.costCode || costCodeKey);
  if (!costCodeLabel) {
    errors.push("costCodeLabel is required.");
  }

  const originalBudget = optionalMoney(body.originalBudget, "originalBudget", errors);
  const currentBudget = optionalMoney(body.currentBudget, "currentBudget", errors);
  const commercialAdjustment =
    body.commercialAdjustment == null || body.commercialAdjustment === ""
      ? 0
      : requiredMoney(body.commercialAdjustment, "commercialAdjustment", errors);
  const manualAccrual =
    body.manualAccrual == null || body.manualAccrual === ""
      ? 0
      : requiredMoney(body.manualAccrual, "manualAccrual", errors);
  const adjustmentReason = trimText(body.adjustmentReason || body.commercialReason, 500);

  if (Math.abs(commercialAdjustment) > 0.005 && !adjustmentReason) {
    errors.push("adjustmentReason is required when commercialAdjustment is not zero.");
  }

  let version = null;
  if (requireVersion || body.version != null) {
    version = parseExpectedVersion(body.version);
    if (requireVersion && version == null) {
      errors.push("version is required and must be a positive integer.");
    }
  }

  const displayMetadata =
    body.displayMetadata && typeof body.displayMetadata === "object" && !Array.isArray(body.displayMetadata)
      ? body.displayMetadata
      : {};
  if (Array.isArray(body.adjustmentHistory)) {
    displayMetadata.adjustmentHistory = body.adjustmentHistory;
  }

  return {
    ok: errors.length === 0,
    errors,
    version,
    value: {
      costCodeKey,
      costCodeLabel,
      description: trimText(body.description, 500),
      commercialHead: trimText(body.commercialHead),
      commercialFamily: trimText(body.commercialFamily),
      trade: trimText(body.trade),
      originalBudget,
      currentBudget: currentBudget ?? originalBudget,
      commercialAdjustment,
      adjustmentReason,
      manualAccrual,
      notes: trimText(body.notes, 4000),
      active: body.active == null ? true : Boolean(body.active),
      displayMetadata,
    },
  };
}

module.exports = {
  roundMoney,
  optionalMoney,
  trimText,
  normaliseCostCodeKey,
  parseExpectedVersion,
  validateCreatePeriodBody,
  validatePatchPeriodBody,
  validateCostCodeInputBody,
};
