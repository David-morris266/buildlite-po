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
} = require("./revenueSettingsConstants");

function roundMoney(value) {
  if (value == null || value === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function normalizePercent(value, fallback) {
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

function normalizeGaragePremiums(input = {}, errors) {
  if (input == null || input === "") {
    return { ...DEFAULT_GARAGE_PREMIUMS };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("revenueStrategy.garagePremiums must be an object.");
    return { ...DEFAULT_GARAGE_PREMIUMS };
  }
  const none = roundMoney(input.none ?? DEFAULT_GARAGE_PREMIUMS.none);
  const single = roundMoney(input.single ?? DEFAULT_GARAGE_PREMIUMS.single);
  const double = roundMoney(input.double ?? DEFAULT_GARAGE_PREMIUMS.double);
  if (none == null || single == null || double == null) {
    errors.push("revenueStrategy.garagePremiums values must be finite amounts.");
    return { ...DEFAULT_GARAGE_PREMIUMS };
  }
  return { none, single, double };
}

function normalizeRevenueStrategy(input, errors) {
  const defaults = emptyRevenueStrategy();
  if (input == null || input === "") return defaults;
  if (typeof input !== "object" || Array.isArray(input)) {
    errors.push("revenueStrategy must be an object.");
    return defaults;
  }

  const ratePerFt2 = roundMoney(input.openMarket?.ratePerFt2 ?? defaults.openMarket.ratePerFt2);
  if (ratePerFt2 == null) {
    errors.push("revenueStrategy.openMarket.ratePerFt2 must be a finite amount.");
  }

  const affordableHousing = {};
  const source = input.affordableHousing && typeof input.affordableHousing === "object"
    ? input.affordableHousing
    : {};
  for (const key of AFFORDABLE_HOUSING_KEYS) {
    affordableHousing[key] = normalizePercent(
      source[key],
      DEFAULT_AFFORDABLE_PERCENTAGES[key]
    );
  }

  return {
    openMarket: {
      ratePerFt2: ratePerFt2 ?? defaults.openMarket.ratePerFt2,
      effectiveDate: String(input.openMarket?.effectiveDate || "").trim(),
    },
    affordableHousing,
    garagePremiums: normalizeGaragePremiums(input.garagePremiums, errors),
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

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    value: {
      recognitionPolicy,
      revenueStrategy,
      houseTypePricing,
      revenueAdjustments,
      recognitionSettings,
    },
  };
}

module.exports = {
  validatePutSettingsBody,
  parseCreateOrUpdateVersion,
  normalizeRevenueStrategy,
  normalizeHouseTypePricing,
};
