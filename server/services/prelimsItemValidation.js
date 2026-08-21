/**
 * BL-033D.1 — Validate development Prelims item create/update bodies.
 * STANDARD_CVR is rejected: it remains the CVR evidence path.
 */

const {
  MAX_COST_CODE_KEY_LENGTH,
  MAX_NAME_LENGTH,
  PRELIMS_DRIVER_KEYS,
  PRELIMS_DRIVERS,
  PRELIMS_STATUS_KEYS,
  PRELIMS_STATUSES,
  TIME_BASIS_KEYS,
  TIME_BASES,
} = require("./prelimsConstants");
const { toIsoDate } = require("./programmeCalendar");

function parseExpectedVersion(value) {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function preserveCostCodeKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, MAX_COST_CODE_KEY_LENGTH);
}

function parseMoney(value, field, errors, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) errors.push(`${field} is required.`);
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    errors.push(`${field} must be a non-negative number.`);
    return null;
  }
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function parseBasis(value, field, errors, { required = false } = {}) {
  if (value == null || value === "") {
    if (required) errors.push(`${field} is required.`);
    return null;
  }
  const basis = String(value).trim();
  if (!TIME_BASIS_KEYS.includes(basis)) {
    errors.push(`${field} is not a valid TIME basis.`);
    return null;
  }
  return basis;
}

function parseOptionalDate(value, field, errors) {
  if (value == null || value === "") return null;
  const iso = toIsoDate(value);
  if (!iso) {
    errors.push(`${field} must be a YYYY-MM-DD date.`);
    return null;
  }
  return iso;
}

function validatePrelimsItemBody(body = {}, { requireVersion = false } = {}) {
  const errors = [];
  const expectedVersion = parseExpectedVersion(body.version);
  if (expectedVersion == null || (requireVersion && expectedVersion < 1)) {
    errors.push("version must be a non-negative integer.");
  }

  const costCodeKey = preserveCostCodeKey(body.costCodeKey);
  if (!costCodeKey) errors.push("costCodeKey is required.");

  const name = String(body.name || "").trim();
  if (!name) errors.push("name is required.");
  if (name.length > MAX_NAME_LENGTH) errors.push("name must be 120 characters or fewer.");

  const forecastDriver = String(body.forecastDriver || "").trim();
  if (forecastDriver === "STANDARD_CVR") {
    errors.push("STANDARD_CVR is the existing CVR path and cannot be a Prelims line.");
  } else if (!PRELIMS_DRIVER_KEYS.includes(forecastDriver)) {
    errors.push("forecastDriver must be TIME or LUMP_SUM.");
  }

  let status = PRELIMS_STATUSES.ACTIVE;
  if (body.status != null && body.status !== "") {
    const next = String(body.status).trim();
    if (!PRELIMS_STATUS_KEYS.includes(next)) {
      errors.push("status must be active, complete, or cancelled.");
    } else {
      status = next;
    }
  }

  let monthlyRate = null;
  let startBasis = null;
  let startFixedDate = null;
  let endBasis = null;
  let endFixedDate = null;
  let lumpSumAmount = null;

  if (forecastDriver === PRELIMS_DRIVERS.TIME) {
    monthlyRate = parseMoney(body.monthlyRate, "monthlyRate", errors, { required: true });
    startBasis = parseBasis(body.startBasis, "startBasis", errors, { required: true });
    endBasis = parseBasis(body.endBasis, "endBasis", errors, { required: true });
    startFixedDate = parseOptionalDate(body.startFixedDate, "startFixedDate", errors);
    endFixedDate = parseOptionalDate(body.endFixedDate, "endFixedDate", errors);
    if (startBasis === TIME_BASES.FIXED_DATE && !startFixedDate) {
      errors.push("startFixedDate is required when startBasis is FIXED_DATE.");
    }
    if (endBasis === TIME_BASES.FIXED_DATE && !endFixedDate) {
      errors.push("endFixedDate is required when endBasis is FIXED_DATE.");
    }
    if (startBasis !== TIME_BASES.FIXED_DATE) startFixedDate = null;
    if (endBasis !== TIME_BASES.FIXED_DATE) endFixedDate = null;
    if (
      startBasis === TIME_BASES.FIXED_DATE &&
      endBasis === TIME_BASES.FIXED_DATE &&
      startFixedDate &&
      endFixedDate &&
      endFixedDate < startFixedDate
    ) {
      errors.push("endFixedDate must be on or after startFixedDate.");
    }
  } else if (forecastDriver === PRELIMS_DRIVERS.LUMP_SUM) {
    lumpSumAmount = parseMoney(body.lumpSumAmount, "lumpSumAmount", errors, { required: true });
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    expectedVersion,
    value: {
      costCodeKey,
      name,
      forecastDriver,
      status,
      monthlyRate,
      startBasis,
      startFixedDate,
      endBasis,
      endFixedDate,
      lumpSumAmount,
    },
  };
}

module.exports = {
  parseExpectedVersion,
  preserveCostCodeKey,
  validatePrelimsItemBody,
};
