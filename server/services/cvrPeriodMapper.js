/**
 * BL-031A — CVR period / cost-code input API documents.
 */

const { SNAPSHOT_DEFERRED_NOTE, SNAPSHOT_CREATED_NOTE, emptyCommentary } = require("./cvrPeriodConstants");

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

function toNumber(value, fallback = 0) {
  const n = toNumberOrNull(value);
  return n == null ? fallback : n;
}

function commentaryOf(row) {
  const raw = row?.commentary && typeof row.commentary === "object" ? row.commentary : {};
  const base = emptyCommentary();
  return {
    keyCommercialIssues: String(raw.keyCommercialIssues || base.keyCommercialIssues),
    commercialOpportunities: String(raw.commercialOpportunities || base.commercialOpportunities),
    financialRisks: String(raw.financialRisks || base.financialRisks),
    actionsBeforeNextCvr: String(raw.actionsBeforeNextCvr || base.actionsBeforeNextCvr),
  };
}

function auditRowToEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    action: row.action,
    actor: row.actor ?? null,
    at: toIso(row.created_at),
    comment: row.comment || "",
    priorStatus: row.prior_status ?? null,
    newStatus: row.new_status ?? null,
  };
}

function periodRowToDocument(row, auditRows = [], snapshot = null) {
  if (!row) return null;
  const status = row.status;
  const hasSnapshot = Boolean(snapshot);
  return {
    id: row.id,
    developmentId: row.development_id,
    periodKey: row.period_key,
    periodLabel: row.period_label,
    reportingMonth: toDateOnly(row.reporting_month),
    status,
    commentary: commentaryOf(row),
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
    submittedAt: toIso(row.submitted_at),
    submittedBy: row.submitted_by ?? null,
    approvedAt: toIso(row.approved_at),
    approvedBy: row.approved_by ?? null,
    snapshot: snapshot || null,
    snapshotDeferred: !hasSnapshot,
    snapshotNote: hasSnapshot ? SNAPSHOT_CREATED_NOTE : SNAPSHOT_DEFERRED_NOTE,
    auditHistory: (auditRows || []).map(auditRowToEntry).filter(Boolean),
  };
}

function inputRowToDocument(row) {
  if (!row) return null;
  const metadata =
    row.display_metadata && typeof row.display_metadata === "object"
      ? row.display_metadata
      : {};
  return {
    id: row.id,
    periodId: row.period_id,
    costCodeKey: row.cost_code_key,
    costCodeLabel: row.cost_code_label,
    description: row.description || "",
    commercialHead: row.commercial_head || "",
    commercialFamily: row.commercial_family || "",
    trade: row.trade || "",
    originalBudget: toNumberOrNull(row.original_budget),
    currentBudget: toNumberOrNull(row.current_budget),
    commercialAdjustment: toNumber(row.commercial_adjustment, 0),
    adjustmentReason: row.adjustment_reason || "",
    manualAccrual: toNumber(row.manual_accrual, 0),
    notes: row.notes || "",
    active: row.active !== false,
    displayMetadata: metadata,
    adjustmentHistory: Array.isArray(metadata.adjustmentHistory)
      ? metadata.adjustmentHistory
      : [],
    version: row.version,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    createdBy: row.created_by ?? null,
    updatedBy: row.updated_by ?? null,
  };
}

module.exports = {
  toIso,
  toDateOnly,
  toNumberOrNull,
  periodRowToDocument,
  inputRowToDocument,
  auditRowToEntry,
};
