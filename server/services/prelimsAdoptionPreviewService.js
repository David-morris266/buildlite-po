/**
 * BL-033D.x.4B — Read-only Prelims → CVR adoption review preview.
 * Reuses x.4A compare engine. Does not write CVR, Prelims, or metadata.
 */

const { listCvrPeriods, listCostCodeInputs } = require("./cvrPeriodRepository");
const { CVR_PERIOD_STATUSES, isCvrPeriodLocked } = require("./cvrPeriodConstants");
const { buildCvrCloseCandidate } = require("./cvrCloseEngine");
const { listClassifications } = require("./costCodeClassificationRepository");
const { costCodeRowToDocument } = require("./costCodeMasterMapper");
const { findCostCodeRowByCode } = require("./costCodeMasterRepository");
const { listPrelimsItems } = require("./prelimsItemRepository");
const {
  PRELIMS_ADOPTION_FLAG_KEYS,
  buildPrelimsAdoptionPreview,
  roundMoney,
} = require("./prelimsAdoptionCompare");
const { PRELIMS_UNRESOLVED_LABELS } = require("./prelimsConstants");

const MISSING_CVR_LINE_MESSAGE =
  "This Prelims proposal uses a cost code that is not currently included as a CVR line.";

function toYearMonth(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return null;
}

function pickOpenCvrPeriod(periods = []) {
  const open = periods.filter((period) => period && !isCvrPeriodLocked(period.status));
  if (!open.length) return null;
  const withMonth = open.filter((period) => toYearMonth(period.reportingMonth));
  const draft = withMonth.find((period) => period.status === CVR_PERIOD_STATUSES.draft);
  const submitted = withMonth.find((period) => period.status === CVR_PERIOD_STATUSES.submitted);
  return draft || submitted || withMonth[withMonth.length - 1] || open[open.length - 1];
}

function costCodeLabelFromRow(row) {
  if (!row) return null;
  return (
    row.costCodeLabel ||
    row.description ||
    row.cost_code_label ||
    null
  );
}

function unresolvedLineDetail(item) {
  const calc = item.calculation || {};
  const reason = calc.reason || null;
  return {
    id: item.id,
    name: item.name || "Prelims line",
    forecastDriver: item.forecastDriver || null,
    startBasis: item.startBasis || null,
    endBasis: item.endBasis || null,
    reason,
    reasonLabel:
      calc.reasonLabel || PRELIMS_UNRESOLVED_LABELS[reason] || reason || "Unresolved timing",
    excludedFromProposal: true,
  };
}

function enrichCandidate(candidate, { itemsById, cvrByKey, inputByKey = new Map() }) {
  const key = String(candidate.costCodeKey || "").trim();
  const cvrRow =
    cvrByKey.get(key) ||
    cvrByKey.get(key.toLowerCase()) ||
    null;
  const input =
    inputByKey.get(key) ||
    inputByKey.get(key.toLowerCase()) ||
    null;
  const unresolvedLines = (candidate.unresolvedLineIds || [])
    .map((id) => itemsById.get(String(id)))
    .filter(Boolean)
    .map(unresolvedLineDetail);

  const includedLines = (candidate.sourceLineIds || [])
    .map((id) => itemsById.get(String(id)))
    .filter(Boolean)
    .map((item) => ({
      id: item.id,
      name: item.name || "Prelims line",
      forecastDriver: item.forecastDriver || null,
      totalForecast: roundMoney(item.calculation?.totalForecast),
    }));

  return {
    ...candidate,
    costCodeDescription: costCodeLabelFromRow(cvrRow) || candidate.costCodeKey,
    inputId: input?.id || null,
    inputVersion: input?.version ?? null,
    unresolvedLines,
    includedLines,
    unresolvedExcludedMessage:
      candidate.unresolvedCount > 0
        ? `${candidate.unresolvedCount} unresolved line${
            candidate.unresolvedCount === 1 ? "" : "s"
          } excluded from proposed CVR value`
        : null,
    missingFromCvrMessage: candidate.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]
      ? MISSING_CVR_LINE_MESSAGE
      : null,
    adjustmentSemantics:
      "The proposed replacement adjustment replaces the current CVR adjustment; it is not added to it.",
  };
}

function attachAddToCvrEligibility(row, { periodStatus, master } = {}) {
  const draft = String(periodStatus || "").toLowerCase() === CVR_PERIOD_STATUSES.draft;
  const found = Boolean(master);
  const active = found && master.active !== false;
  let addBlockedReason = null;
  if (!draft) {
    addBlockedReason =
      String(periodStatus || "").toLowerCase() === CVR_PERIOD_STATUSES.locked
        ? "This CVR is locked and cannot be changed."
        : "This CVR is no longer Draft, so a cost code cannot be added.";
  } else if (!found) {
    addBlockedReason = "This cost code is not in Cost Code Master for this company.";
  } else if (!active) {
    addBlockedReason = "This cost code is inactive in Cost Code Master.";
  }

  return {
    ...row,
    missingFromCvrMessage: MISSING_CVR_LINE_MESSAGE,
    canAddToCvr: Boolean(draft && found && active),
    addBlockedReason,
    masterFound: found,
    masterActive: Boolean(active),
  };
}

async function attachMissingCvrAddEligibility(clientId, periodStatus, rows = []) {
  const next = [];
  for (const row of rows) {
    const masterRow = await findCostCodeRowByCode(clientId, row.costCodeKey);
    const master = masterRow ? costCodeRowToDocument(masterRow) : null;
    next.push(attachAddToCvrEligibility(row, { periodStatus, master }));
  }
  return next;
}

function buildCommercialSummary(candidates) {
  const withPrelims = candidates.filter((row) => (row.lineCount || 0) > 0);
  const reviewable = withPrelims.filter((row) => !row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]);
  const missingFromCvr = withPrelims.filter(
    (row) => row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]
  );
  const adoptable = reviewable.filter((row) => !row.cannotAdopt);

  const sum = (rows, key) => {
    let total = 0;
    let any = false;
    for (const row of rows) {
      if (row[key] == null) continue;
      total += Number(row[key]) || 0;
      any = true;
    }
    return any ? roundMoney(total) : null;
  };

  return {
    prelimsCostCodeCount: withPrelims.length,
    reviewableCostCodeCount: reviewable.length,
    missingFromCvrCount: missingFromCvr.length,
    unresolvedCostCodeCount: withPrelims.filter(
      (row) => row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE]
    ).length,
    proposalBelowSystemCount: withPrelims.filter(
      (row) => row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM]
    ).length,
    resolvedPrelimsTotal: sum(withPrelims, "resolvedPrelimsTotal"),
    currentFinalForecastTotal: sum(adoptable, "currentFinalForecast"),
    proposedFinalForecastTotal: sum(adoptable, "proposedFinalForecast"),
    deltaFinalTotal: sum(adoptable, "deltaFinal"),
  };
}

/**
 * Build a read-only commercial review document for Development → Prelims.
 */
async function buildPrelimsAdoptionReviewPreview(clientId, developmentId, { reportingMonth } = {}) {
  const periodsResult = await listCvrPeriods(clientId, developmentId);
  if (!periodsResult.ok) return periodsResult;

  const openPeriod = pickOpenCvrPeriod(periodsResult.periods || []);
  if (!openPeriod) {
    return {
      ok: false,
      status: 404,
      message: "No open CVR worksheet is available to review against.",
    };
  }

  const collectionResult = await listPrelimsItems(clientId, developmentId, {
    reportingMonth: reportingMonth || toYearMonth(openPeriod.reportingMonth),
  });
  if (!collectionResult.ok) return collectionResult;

  const collection = collectionResult.collection;
  const closeCandidate = await buildCvrCloseCandidate({
    clientId,
    developmentId,
    periodId: openPeriod.id,
  });

  if (!closeCandidate.ready) {
    return {
      ok: false,
      status: 409,
      message: "Current CVR worksheet is not ready to review against.",
      blockers: closeCandidate.blockers || [],
    };
  }

  const classificationsResult = await listClassifications(clientId);
  const classifications = classificationsResult.ok
    ? classificationsResult.classifications || []
    : [];

  const cvrRows = closeCandidate.snapshot?.rows || [];
  const displayMetadataByCostCode = {};
  for (const row of cvrRows) {
    const key = String(row.costCodeKey || "").trim();
    if (!key) continue;
    displayMetadataByCostCode[key] = row.displayMetadata || {};
    displayMetadataByCostCode[key.toLowerCase()] = row.displayMetadata || {};
  }

  const inputsResult = await listCostCodeInputs(clientId, developmentId, openPeriod.id);
  const inputByKey = new Map();
  if (inputsResult.ok) {
    for (const input of inputsResult.inputs || []) {
      const key = String(input.costCodeKey || "").trim();
      if (!key) continue;
      inputByKey.set(key, input);
      inputByKey.set(key.toLowerCase(), input);
    }
  }

  const enginePreview = buildPrelimsAdoptionPreview({
    developmentId,
    periodKey: openPeriod.periodKey,
    reportingMonth: collection.reportingMonth || toYearMonth(openPeriod.reportingMonth),
    prelimsItems: collection.items || [],
    programme: collection.programme,
    cvrRows,
    classifications,
    displayMetadataByCostCode,
  });

  const itemsById = new Map(
    (collection.items || []).map((item) => [String(item.id), item])
  );
  const cvrByKey = new Map();
  for (const row of cvrRows) {
    const key = String(row.costCodeKey || "").trim();
    if (!key) continue;
    cvrByKey.set(key, row);
    cvrByKey.set(key.toLowerCase(), row);
  }

  const candidates = (enginePreview.candidates || [])
    .filter((row) => (row.lineCount || 0) > 0)
    .map((row) => enrichCandidate(row, { itemsById, cvrByKey, inputByKey }));

  const reviewable = candidates.filter(
    (row) => !row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]
  );
  const missingFromCvr = candidates.filter(
    (row) => row.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]
  );

  return {
    ok: true,
    preview: {
      readOnly: true,
      developmentId,
      periodKey: openPeriod.periodKey,
      periodId: openPeriod.id,
      periodStatus: openPeriod.status,
      reportingMonth: enginePreview.reportingMonth,
      reportingMonthSource: collection.reportingMonthSource || "open-cvr",
      programme: collection.programme || null,
      adjustmentSemantics:
        "The proposed replacement adjustment replaces the current CVR adjustment; it is not added to it.",
      accrualNote: "Accrual is shown for context only and is not changed by this review.",
      cvr: {
        periodKey: openPeriod.periodKey,
        periodId: openPeriod.id,
        status: openPeriod.status,
        reportingMonth: toYearMonth(openPeriod.reportingMonth),
        ready: true,
      },
      summary: {
        ...enginePreview.summary,
        ...buildCommercialSummary(candidates),
      },
      candidates: reviewable,
      missingFromCvr: await attachMissingCvrAddEligibility(
        clientId,
        openPeriod.status,
        missingFromCvr
      ),
      engine: {
        costCodeCount: enginePreview.summary?.costCodeCount ?? null,
        adoptableCostCodeCount: enginePreview.summary?.adoptableCostCodeCount ?? null,
      },
    },
  };
}

module.exports = {
  MISSING_CVR_LINE_MESSAGE,
  buildPrelimsAdoptionReviewPreview,
  pickOpenCvrPeriod,
  enrichCandidate,
  attachAddToCvrEligibility,
  buildCommercialSummary,
};
