/**
 * BL-031A — CVR period constants (server persistence foundation).
 *
 * Approve/lock records workflow state. Immutable CVR snapshots are persisted
 * atomically on Approve & Lock (BL-031E.3B). Legacy locked periods may have
 * no snapshot until historic-read (E.4).
 */

const CVR_PERIOD_STATUSES = {
  draft: "draft",
  submitted: "submitted",
  locked: "locked",
};

const CVR_PERIOD_AUDIT_ACTIONS = {
  created: "created",
  patched: "patched",
  submitted: "submitted",
  rejected: "rejected",
  approved: "approved",
  locked: "locked",
  inputsUpserted: "inputs_upserted",
  prelimsAdopted: "prelims_adopted",
  sellingCostsAdopted: "selling_costs_adopted",
  costCodeAdded: "cost_code_added",
  budgetImported: "budget_imported",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PERIOD_KEY_PATTERN = /^P\d{2,}$/i;
const MAX_PERIOD_KEY_LENGTH = 32;
const MAX_COST_CODE_KEY_LENGTH = 64;
const MAX_LABEL_LENGTH = 200;

const SNAPSHOT_DEFERRED_NOTE =
  "BL-031A: approve/lock records workflow only. Immutable CVR snapshots are BL-031E.";

const SNAPSHOT_CREATED_NOTE = "Immutable CVR snapshot created.";

const CVR_CLOSE_NOT_READY_CODE = "CVR_CLOSE_NOT_READY";

function isValidUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim());
}

function isValidPeriodKey(value) {
  const key = String(value || "").trim();
  return key.length >= 1 && key.length <= MAX_PERIOD_KEY_LENGTH;
}

function formatPeriodKey(number) {
  return `P${String(number).padStart(2, "0")}`;
}

function parsePeriodNumber(periodKey) {
  const match = String(periodKey || "").match(/P(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function nextPeriodKey(existingKeys = []) {
  const numbers = existingKeys.map(parsePeriodNumber).filter((n) => n > 0);
  const next = numbers.length ? Math.max(...numbers) + 1 : 1;
  return formatPeriodKey(next);
}

function emptyCommentary() {
  return {
    keyCommercialIssues: "",
    commercialOpportunities: "",
    financialRisks: "",
    actionsBeforeNextCvr: "",
  };
}

function isCvrPeriodDraft(status) {
  return status === CVR_PERIOD_STATUSES.draft;
}

function isCvrPeriodSubmitted(status) {
  return status === CVR_PERIOD_STATUSES.submitted;
}

function isCvrPeriodLocked(status) {
  return status === CVR_PERIOD_STATUSES.locked;
}

function isCvrPeriodMutable(status) {
  return isCvrPeriodDraft(status);
}

module.exports = {
  CVR_PERIOD_STATUSES,
  CVR_PERIOD_AUDIT_ACTIONS,
  UUID_PATTERN,
  PERIOD_KEY_PATTERN,
  MAX_PERIOD_KEY_LENGTH,
  MAX_COST_CODE_KEY_LENGTH,
  MAX_LABEL_LENGTH,
  SNAPSHOT_DEFERRED_NOTE,
  SNAPSHOT_CREATED_NOTE,
  CVR_CLOSE_NOT_READY_CODE,
  isValidUuid,
  isValidPeriodKey,
  formatPeriodKey,
  parsePeriodNumber,
  nextPeriodKey,
  emptyCommentary,
  isCvrPeriodDraft,
  isCvrPeriodSubmitted,
  isCvrPeriodLocked,
  isCvrPeriodMutable,
};
