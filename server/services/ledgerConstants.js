/**
 * BL-031A — Purchase ledger constants.
 * CVR actual cost = SUM(net_amount). VAT is stored but excluded from CVR actual.
 */

const { UUID_PATTERN } = require("./cvrPeriodConstants");

function isValidUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

module.exports = {
  isValidUuid,
};
