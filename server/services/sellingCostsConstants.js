/**
 * Simple Selling Costs product defaults.
 *
 * DEFAULT_ASSUMPTION_PERCENT is a transparent starting assumption, not a hard
 * commercial rate. BuildLite deliberately owns no customer Cost Code default;
 * destination authority comes only from company or Development mapping.
 */

const SELLING_COSTS_MODES = {
  SIMPLE: "simple",
  DETAILED: "detailed",
};

const SELLING_COSTS_MODE_KEYS = Object.values(SELLING_COSTS_MODES);

/** Product default when no development settings row exists. */
const DEFAULT_ASSUMPTION_PERCENT = 2;

const ASSUMPTION_SOURCES = {
  BUILDLITE: "buildlite",
  COMPANY: "company",
  DEVELOPMENT: "development",
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
  ASSUMPTION_SOURCES,
  DESTINATION_STATUSES,
  MAX_ASSUMPTION_PERCENT,
  MAX_DESTINATION_KEY_LENGTH,
};
