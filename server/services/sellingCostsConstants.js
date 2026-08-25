/**
 * BL-034B — Simple Selling Costs product defaults and semantic destination hints.
 *
 * DEFAULT_ASSUMPTION_PERCENT is a product default, not a hard commercial rate.
 * RECOMMENDED_SIMPLE_DESTINATION_CODE is the BuildLite standard / template
 * destination hint. The engine resolves destination from Cost Code Master +
 * SELLING classification and must not treat 5400 as the only possible key.
 *
 * FORBIDDEN_SIMPLE_DESTINATION_CODES — Sales Incentives stay outside Simple
 * Selling Costs (true proceeds-reducing incentive treatment is deferred).
 */

const SELLING_COSTS_MODES = {
  SIMPLE: "simple",
  DETAILED: "detailed",
};

const SELLING_COSTS_MODE_KEYS = Object.values(SELLING_COSTS_MODES);

/** Product default when no development settings row exists. */
const DEFAULT_ASSUMPTION_PERCENT = 2;

/**
 * Recommended BuildLite standard Simple destination (Cost Code Master identity).
 * Configurable / resolvable — not an exclusive engine constant.
 */
const RECOMMENDED_SIMPLE_DESTINATION_CODE = "5400";

/** Must never be accepted as the Simple Selling Costs destination. */
const FORBIDDEN_SIMPLE_DESTINATION_CODES = Object.freeze(["5405"]);

const ASSUMPTION_SOURCES = {
  DEFAULT: "default",
  USER: "user",
};

const DESTINATION_STATUSES = {
  READY: "ready",
  MISSING: "missing",
  INACTIVE: "inactive",
  FORBIDDEN: "forbidden",
  NOT_SELLING: "not_selling",
  UNCONFIGURED: "unconfigured",
};

/** Technical overflow guard only (schema CHECK); not a commercial ceiling. */
const MAX_ASSUMPTION_PERCENT = 1000;

const MAX_DESTINATION_KEY_LENGTH = 64;

module.exports = {
  SELLING_COSTS_MODES,
  SELLING_COSTS_MODE_KEYS,
  DEFAULT_ASSUMPTION_PERCENT,
  RECOMMENDED_SIMPLE_DESTINATION_CODE,
  FORBIDDEN_SIMPLE_DESTINATION_CODES,
  ASSUMPTION_SOURCES,
  DESTINATION_STATUSES,
  MAX_ASSUMPTION_PERCENT,
  MAX_DESTINATION_KEY_LENGTH,
};
