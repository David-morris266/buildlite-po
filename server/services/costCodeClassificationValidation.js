/**
 * BL-033B — Validate cost-code classification PUT bodies and keys.
 * Does not infer semantic group from Commercial Head.
 */

const {
  DEFAULT_FORECAST_DRIVER,
  DEFAULT_SEMANTIC_GROUP,
  FORECAST_DRIVER_KEYS,
  FORECAST_DRIVERS,
  MAX_COST_CODE_KEY_LENGTH,
  PERSISTED_SEMANTIC_GROUPS,
  SEMANTIC_GROUPS,
} = require("./costCodeClassificationConstants");

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function normalizeCostCodeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let codePart = raw.split("—")[0].split(" – ")[0];
  const spacedHyphen = codePart.split(" - ");
  if (spacedHyphen.length > 1) codePart = spacedHyphen[0];
  return codePart.replace(/\s+/g, "").trim().slice(0, MAX_COST_CODE_KEY_LENGTH);
}

function isPersistedSemanticGroup(value) {
  return PERSISTED_SEMANTIC_GROUPS.includes(value);
}

function isForecastDriver(value) {
  return FORECAST_DRIVER_KEYS.includes(value);
}

function validatePutClassificationBody(body = {}, costCodeKeyParam) {
  const errors = [];
  const costCodeKey = normalizeCostCodeKey(costCodeKeyParam || body.costCodeKey);
  if (!costCodeKey) {
    errors.push("costCodeKey is required.");
  }

  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null) {
    errors.push("version must be a non-negative integer.");
  }

  let semanticGroup = DEFAULT_SEMANTIC_GROUP;
  if (body.semanticGroup != null && body.semanticGroup !== "") {
    const group = String(body.semanticGroup || "").trim().toUpperCase();
    if (group === SEMANTIC_GROUPS.UNCLASSIFIED) {
      semanticGroup = SEMANTIC_GROUPS.UNCLASSIFIED;
    } else if (isPersistedSemanticGroup(group)) {
      semanticGroup = group;
    } else {
      errors.push("semanticGroup is not a valid BuildLite semantic group.");
    }
  }

  let forecastDriver = DEFAULT_FORECAST_DRIVER;
  if (body.forecastDriver != null && body.forecastDriver !== "") {
    const driver = String(body.forecastDriver || "").trim().toUpperCase();
    if (isForecastDriver(driver)) {
      forecastDriver = driver;
    } else {
      errors.push("forecastDriver is not a valid forecast method.");
    }
  }

  if (semanticGroup === SEMANTIC_GROUPS.UNCLASSIFIED && forecastDriver !== FORECAST_DRIVERS.STANDARD_CVR) {
    errors.push("UNCLASSIFIED classifications must use STANDARD_CVR.");
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    value: {
      costCodeKey,
      semanticGroup,
      forecastDriver,
      clear: semanticGroup === SEMANTIC_GROUPS.UNCLASSIFIED,
    },
  };
}

module.exports = {
  parseExpectedVersion,
  normalizeCostCodeKey,
  isPersistedSemanticGroup,
  isForecastDriver,
  validatePutClassificationBody,
};
