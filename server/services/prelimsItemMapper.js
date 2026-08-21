/**
 * BL-033D.1 — Map development_prelims_items rows to API documents with live calculation.
 */

const { calculatePrelimsLine } = require("./prelimsForecastEngine");
const { PRELIMS_UNRESOLVED_LABELS } = require("./prelimsConstants");

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function prelimsRowToPersisted(row) {
  if (!row) return null;
  return {
    id: row.id,
    developmentId: row.development_id,
    costCodeKey: row.cost_code_key,
    name: row.name,
    forecastDriver: row.forecast_driver,
    status: row.status,
    monthlyRate: toNumberOrNull(row.monthly_rate),
    startBasis: row.start_basis || null,
    startFixedDate: toDateOnly(row.start_fixed_date),
    endBasis: row.end_basis || null,
    endFixedDate: toDateOnly(row.end_fixed_date),
    lumpSumAmount: toNumberOrNull(row.lump_sum_amount),
    version: Number(row.version) || 1,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

function attachPrelimsCalculation(item, context = {}) {
  if (!item) return null;
  const calculation = calculatePrelimsLine(item, context);
  return {
    ...item,
    calculation: {
      ...calculation,
      reasonLabel: calculation.reason ? PRELIMS_UNRESOLVED_LABELS[calculation.reason] || calculation.reason : null,
    },
  };
}

module.exports = {
  toDateOnly,
  prelimsRowToPersisted,
  attachPrelimsCalculation,
};
