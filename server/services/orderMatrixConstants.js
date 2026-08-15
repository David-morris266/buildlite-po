/**
 * BL-029A — Order Matrix server constants (plot-stage only).
 */

const ORDER_MATRIX_LAYOUT = "plot-stage";

const PACKAGE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PAYLOAD_BYTES = 512 * 1024;
const MAX_STAGES = 200;
const MAX_PLOTS = 500;
const MAX_LABEL_LENGTH = 500;
const MAX_MONEY_ABS = 1e12;

function isValidPackageUuid(value) {
  return PACKAGE_UUID_PATTERN.test(String(value || "").trim());
}

module.exports = {
  ORDER_MATRIX_LAYOUT,
  PACKAGE_UUID_PATTERN,
  MAX_PAYLOAD_BYTES,
  MAX_STAGES,
  MAX_PLOTS,
  MAX_LABEL_LENGTH,
  MAX_MONEY_ABS,
  isValidPackageUuid,
};
