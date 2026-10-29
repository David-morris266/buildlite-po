/**
 * BL-032A — Validate development revenue settings PUT body.
 */

const {
  AFFORDABLE_HOUSING_KEYS,
  DEFAULT_AFFORDABLE_PERCENTAGES,
  DEFAULT_GARAGE_PREMIUMS,
  DEFAULT_REVENUE_RECOGNITION_POLICY,
  REVENUE_RECOGNITION_POLICIES,
  emptyRevenueStrategy,
  blankRevenueStrategy,
} = require("./revenueSettingsConstants");

function roundMoney(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizePercent(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return fallback;
  return Math.max(0, Math.min(100, Math.round(amount * 100) / 100));
}

function parseCreateOrUpdateVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeGaragePremiums(input = {}, errors, { fillMissingWithDefaults = false } = {}) {
  const defaults = fillMissingWithDefaults ? DEFAULT_GARAGE_PREMIUMS : blankRevenueStrategy().garagePremiums;
  if (input == null || input === "") {
    return { ...defaults };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("revenueStrategy.garagePremiums must be an object.");
    return { ...defaults };
  }
  const none = input.none == null || input.none === "" ? defaults.none : roundMoney(input.none);
  const single = input.single == null || input.single === "" ? defaults.single : roundMoney(input.single);
  const double = input.double == null || input.double === "" ? defaults.double : roundMoney(input.double);
  const hasInvalidValue = ["none", "single", "double"].some(
    (key) => input[key] != null && input[key] !== "" && roundMoney(input[key]) == null
  );
  if (hasInvalidValue) {
    errors.push("revenueStrategy.garagePremiums values must be finite amounts.");
    return { ...defaults };
  }
  return { none, single, double };
}

function normalizeRevenueStrategy(input, errors, { fillMissingWithDefaults = false } = {}) {
  const defaults = fillMissingWithDefaults ? emptyRevenueStrategy() : blankRevenueStrategy();
  if (input == null || input === "") return defaults;
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("revenueStrategy must be an object.");
    return defaults;
  }

  const rawRate = input.openMarket?.ratePerFt2;
  const ratePerFt2 = rawRate == null || rawRate === "" ? defaults.openMarket.ratePerFt2 : roundMoney(rawRate);
  if (rawRate != null && rawRate !== "" && ratePerFt2 == null) {
    errors.push("revenueStrategy.openMarket.ratePerFt2 must be a finite amount.");
  }

  const affordableHousing = {};
  const source = input.affordableHousing && typeof input.affordableHousing === "object"
    ? input.affordableHousing
    : {};
  for (const key of AFFORDABLE_HOUSING_KEYS) {
    affordableHousing[key] = normalizePercent(
      source[key],
      fillMissingWithDefaults ? DEFAULT_AFFORDABLE_PERCENTAGES[key] : null
    );
  }

  return {
    openMarket: {
      ratePerFt2,
      effectiveDate: String(input.openMarket?.effectiveDate || "").trim(),
    },
    affordableHousing,
    garagePremiums: normalizeGaragePremiums(input.garagePremiums, errors, { fillMissingWithDefaults }),
    updatedAt: input.updatedAt ? String(input.updatedAt) : null,
  };
}

function normalizeHouseTypePricingRecord(record = {}, errors, houseType) {
  if (typeof record !== "object" || Array.isArray(record)) {
    errors.push(`houseTypePricing.${houseType} must be an object.`);
    return null;
  }
  const manualForecastValue = roundMoney(record.manualForecastValue || 0);
  if (manualForecastValue == null) {
    errors.push(`houseTypePricing.${houseType}.manualForecastValue must be a finite amount.`);
  }
  let representativeNiaFt2 = null;
  if (record.representativeNiaFt2 != null && record.representativeNiaFt2 !== "") {
    representativeNiaFt2 = roundMoney(record.representativeNiaFt2);
    if (representativeNiaFt2 == null) {
      errors.push(`houseTypePricing.${houseType}.representativeNiaFt2 must be a finite amount.`);
    }
  }
  return {
    garage: ["None", "Single", "Double"].includes(record.garage) ? record.garage : "None",
    sellingBasis: record.sellingBasis === "Manual" ? "Manual" : "Auto",
    manualForecastValue: manualForecastValue ?? 0,
    representativeNiaFt2,
  };
}

function normalizeHouseTypePricing(input, errors) {
  if (input == null || input === "") return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("houseTypePricing must be an object.");
    return {};
  }
  const next = {};
  for (const [houseType, record] of Object.entries(input)) {
    const key = String(houseType || "").trim();
    if (!key) continue;
    const normalized = normalizeHouseTypePricingRecord(record, errors, key);
    if (normalized) next[key] = normalized;
  }
  return next;
}

function normalizeJsonArray(input, field, errors) {
  if (input == null || input === "") return [];
  if (!Array.isArray(input)) {
    errors.push(`${field} must be an array.`);
    return [];
  }
  return input;
}

function normalizeJsonObject(input, field, errors) {
  if (input == null || input === "") return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push(`${field} must be an object.`);
    return {};
  }
  return input;
}

function validatePutSettingsBody(body = {}) {
  const errors = [];
  const expectedVersion = parseCreateOrUpdateVersion(body.version);
  if (expectedVersion == null) {
    errors.push("version must be a non-negative integer.");
  }

  let recognitionPolicy = DEFAULT_REVENUE_RECOGNITION_POLICY;
  if (body.recognitionPolicy != null && body.recognitionPolicy !== "") {
    const policy = String(body.recognitionPolicy || "").trim().toLowerCase();
    if (
      policy !== REVENUE_RECOGNITION_POLICIES.completion &&
      policy !== REVENUE_RECOGNITION_POLICIES.exchange
    ) {
      errors.push("recognitionPolicy must be completion or exchange.");
    } else {
      recognitionPolicy = policy;
    }
  }

  const revenueStrategy = normalizeRevenueStrategy(
    body.revenueStrategy ?? body.strategy,
    errors
  );
  const houseTypePricing = normalizeHouseTypePricing(body.houseTypePricing, errors);
  const revenueAdjustments = normalizeJsonArray(
    body.revenueAdjustments,
    "revenueAdjustments",
    errors
  );
  const recognitionSettings = normalizeJsonObject(
    body.recognitionSettings,
    "recognitionSettings",
    errors
  );
  const revenueMode = body.revenueMode === "summary" ? "summary" : body.revenueMode == null || body.revenueMode === "sales_register" ? "sales_register" : null;
  if (!revenueMode) errors.push("revenueMode must be sales_register or summary.");
  const rawLines = body.summaryRevenueLines == null ? [] : body.summaryRevenueLines;
  const summaryRevenueLines = [];
  const lineIds = new Set();
  if (!Array.isArray(rawLines)) errors.push("summaryRevenueLines must be an array.");
  else for (const [index, line] of rawLines.entries()) {
    const id = String(line?.id || "").trim();
    const description = String(line?.description || "").trim();
    const amount = Number(line?.forecastRevenue);
    if (!id || lineIds.has(id)) errors.push(`summaryRevenueLines[${index}].id must be unique and non-empty.`);
    if (!description) errors.push(`Summary Revenue line ${index + 1} needs a description (for example, Private Sales).`);
    if (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) !== amount * 100) errors.push(`summaryRevenueLines[${index}].forecastRevenue must be a non-negative exact-pence amount.`);
    lineIds.add(id);
    summaryRevenueLines.push({ id, description, forecastRevenue: amount });
  }
  if (revenueMode === "summary" && summaryRevenueLines.length === 0) errors.push("Summary Revenue requires at least one revenue line.");

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    establishPricingAssumptions: body.establishPricingAssumptions === true,
    value: {
      recognitionPolicy,
      revenueStrategy,
      houseTypePricing,
      revenueAdjustments,
      recognitionSettings,
      revenueMode,
      summaryRevenueLines,
    },
  };
}

module.exports = {
  validatePutSettingsBody,
  parseCreateOrUpdateVersion,
  normalizeRevenueStrategy,
  normalizeHouseTypePricing,
};
