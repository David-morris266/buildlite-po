/**
 * BL-027B.1 — Package orderKey helpers (must match client packageKeyMigration.js).
 *
 * Key format: {developmentId}::{supplierId}::{normalisedCostCode}
 */

function normaliseCostCode(costCode) {
  const value = String(costCode || "general").trim().toLowerCase();
  return value || "general";
}

function buildSubcontractOrderKey(developmentId, supplierId, costCode) {
  return `${String(developmentId)}::${String(supplierId)}::${normaliseCostCode(costCode)}`;
}

function parseSubcontractOrderKey(orderKey) {
  const parts = String(orderKey || "").split("::");
  if (parts.length >= 3) {
    return {
      developmentId: parts[0],
      supplierId: parts[1],
      costCode: parts.slice(2).join("::"),
      legacy: false,
    };
  }
  if (parts.length === 2) {
    return {
      developmentId: parts[0],
      supplierId: parts[1],
      costCode: null,
      legacy: true,
    };
  }
  return null;
}

module.exports = {
  normaliseCostCode,
  buildSubcontractOrderKey,
  parseSubcontractOrderKey,
};
