/**
 * BL-033D.x.4C.1 — Server Prelims → Draft CVR adoption command.
 * Accepts intent + expectations only. Recalculates on the server. No UI.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const {
  CVR_PERIOD_AUDIT_ACTIONS,
  CVR_PERIOD_STATUSES,
  CVR_CLOSE_NOT_READY_CODE,
  isCvrPeriodMutable,
  isValidUuid,
} = require("./cvrPeriodConstants");
const { periodRowToDocument, inputRowToDocument } = require("./cvrPeriodMapper");
const {
  developmentOr404,
  findPeriodRow,
  listCostCodeInputRowsForUpdate,
  updateCostCodeInputCommercialFields,
  insertAudit,
  provisionalActor,
} = require("./cvrPeriodRepository");
const { buildCvrCloseCandidate } = require("./cvrCloseEngine");
const { listClassifications } = require("./costCodeClassificationRepository");
const { listPrelimsItems } = require("./prelimsItemRepository");
const {
  PRELIMS_ADOPTION_METADATA_KEY,
  PRELIMS_ADOPTION_DRIFT_STATES,
  PRELIMS_ADOPTION_FLAG_KEYS,
  buildPrelimsAdoptionPreview,
  buildPrelimsAdoptionMetadata,
  roundMoney,
} = require("./prelimsAdoptionCompare");
const {
  buildPrelimsAdoptionReviewPreview,
} = require("./prelimsAdoptionPreviewService");

const MONEY_TOLERANCE = 0.005;

const PRELIMS_ADOPTION_ERROR_CODES = {
  PERIOD_NOT_DRAFT: "PERIOD_NOT_DRAFT",
  REPORTING_MONTH_CHANGED: "REPORTING_MONTH_CHANGED",
  PERIOD_KEY_CHANGED: "PERIOD_KEY_CHANGED",
  PROPOSAL_STALE: "PROPOSAL_STALE",
  CVR_INPUT_CONFLICT: "CVR_INPUT_CONFLICT",
  SYSTEM_FORECAST_DRIFT: "SYSTEM_FORECAST_DRIFT",
  CURRENT_ADJUSTMENT_DRIFT: "CURRENT_ADJUSTMENT_DRIFT",
  COST_CODE_NOT_ON_CVR: "COST_CODE_NOT_ON_CVR",
  CANNOT_ADOPT: "CANNOT_ADOPT",
  UNRESOLVED_ACK_REQUIRED: "UNRESOLVED_ACK_REQUIRED",
  SUPERSEDED_ACK_REQUIRED: "SUPERSEDED_ACK_REQUIRED",
  SELECTION_REQUIRED: "SELECTION_REQUIRED",
  DUPLICATE_COST_CODE: "DUPLICATE_COST_CODE",
  CVR_CLOSE_NOT_READY: CVR_CLOSE_NOT_READY_CODE,
};

function fail(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}

function toYearMonth(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return null;
}

function moneyClose(a, b) {
  return Math.abs((roundMoney(a) ?? 0) - (roundMoney(b) ?? 0)) <= MONEY_TOLERANCE;
}

function sameCostCodeKey(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function findByCostCodeKey(rows, costCodeKey) {
  return (rows || []).find((row) => sameCostCodeKey(row.costCodeKey || row.cost_code_key, costCodeKey));
}

function buildAdoptionReason(reportingMonth) {
  return `Prelims forecast adopted — ${reportingMonth}`;
}

function parseSelections(body = {}) {
  const raw = Array.isArray(body.selections)
    ? body.selections
    : Array.isArray(body.selectedCostCodes)
      ? body.selectedCostCodes
      : null;
  if (!raw) {
    return fail(400, PRELIMS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED, "selections must be a non-empty array.");
  }
  if (!raw.length) {
    return fail(400, PRELIMS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED, "At least one cost code must be selected.");
  }

  const seen = new Set();
  const selections = [];
  for (const item of raw) {
    const costCodeKey = String(item?.costCodeKey || item?.costCode || "").trim();
    if (!costCodeKey) {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED, "Each selection requires costCodeKey.");
    }
    const keyNorm = costCodeKey.toLowerCase();
    if (seen.has(keyNorm)) {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.DUPLICATE_COST_CODE, `Duplicate selected cost code: ${costCodeKey}.`, {
        costCodeKey,
      });
    }
    seen.add(keyNorm);

    const expectedInputVersion = Number(item.expectedInputVersion ?? item.inputVersion);
    if (!Number.isInteger(expectedInputVersion) || expectedInputVersion < 1) {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT, "expectedInputVersion must be a positive integer.", {
        costCodeKey,
      });
    }

    const proposalFingerprint = String(item.proposalFingerprint || "").trim();
    if (!proposalFingerprint) {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.PROPOSAL_STALE, "proposalFingerprint is required for each selection.", {
        costCodeKey,
      });
    }

    if (item.expectedSystemForecast == null || item.expectedSystemForecast === "") {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT, "expectedSystemForecast is required for each selection.", {
        costCodeKey,
      });
    }
    if (item.expectedCurrentAdjustment == null || item.expectedCurrentAdjustment === "") {
      return fail(400, PRELIMS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT, "expectedCurrentAdjustment is required for each selection.", {
        costCodeKey,
      });
    }

    selections.push({
      costCodeKey,
      proposalFingerprint,
      expectedInputVersion,
      expectedSystemForecast: roundMoney(item.expectedSystemForecast),
      expectedCurrentAdjustment: roundMoney(item.expectedCurrentAdjustment) ?? 0,
      acknowledgeUnresolvedExcluded: Boolean(
        item.acknowledgeUnresolvedExcluded ?? item.acknowledgeUnresolved
      ),
      acknowledgeSupersededAdjustment: Boolean(
        item.acknowledgeSupersededAdjustment ?? item.acknowledgeSuperseded
      ),
      // Intentionally ignored — browser must never authorise the write amount.
      proposedAdjustmentIgnored: item.proposedAdjustment,
    });
  }

  return { ok: true, selections };
}

function appendAdjustmentHistory(displayMetadata, entry) {
  const metadata =
    displayMetadata && typeof displayMetadata === "object" ? { ...displayMetadata } : {};
  const prior = Array.isArray(metadata.adjustmentHistory) ? metadata.adjustmentHistory : [];
  metadata.adjustmentHistory = [...prior, entry];
  return metadata;
}

function buildHistoryEntry({
  actor,
  previousAdjustment,
  newAdjustment,
  previousReason,
  newReason,
  at,
}) {
  return {
    id: `adj-prelims-${crypto.randomUUID()}`,
    date: at,
    timestamp: at,
    user: actor || null,
    actor: actor || null,
    previousAdjustment,
    newAdjustment,
    previousReason: previousReason || "",
    newReason,
    reason: newReason,
    source: "prelims_adoption",
  };
}

function validateSelectionAgainstCandidate({
  selection,
  candidate,
  inputDoc,
}) {
  const costCodeKey = selection.costCodeKey;

  if (!candidate || candidate.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW] || !inputDoc) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.COST_CODE_NOT_ON_CVR,
      `Cost code ${costCodeKey} is not present on the current CVR and cannot be adopted.`,
      { costCodeKey }
    );
  }

  if (candidate.cannotAdopt || candidate.resolvedPrelimsTotal == null) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.CANNOT_ADOPT,
      `Cost code ${costCodeKey} is not adoptable.`,
      { costCodeKey }
    );
  }

  if (selection.proposalFingerprint !== candidate.proposalFingerprint) {
    return fail(
      409,
      PRELIMS_ADOPTION_ERROR_CODES.PROPOSAL_STALE,
      `Prelims proposal for ${costCodeKey} has changed since review.`,
      { costCodeKey }
    );
  }

  if (inputDoc.version !== selection.expectedInputVersion) {
    return fail(
      409,
      PRELIMS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT,
      `Cost-code input version conflict for ${costCodeKey}.`,
      { costCodeKey, input: inputDoc }
    );
  }

  if (!moneyClose(selection.expectedSystemForecast, candidate.systemForecast)) {
    return fail(
      409,
      PRELIMS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT,
      `System forecast for ${costCodeKey} has drifted since review.`,
      { costCodeKey }
    );
  }

  if (!moneyClose(selection.expectedCurrentAdjustment, candidate.currentAdjustment)) {
    return fail(
      409,
      PRELIMS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT,
      `Current CVR adjustment for ${costCodeKey} has drifted since review.`,
      { costCodeKey }
    );
  }

  const replacementAdjustment = roundMoney(candidate.proposedAdjustment);
  if (replacementAdjustment == null) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.CANNOT_ADOPT,
      `Replacement adjustment for ${costCodeKey} could not be calculated.`,
      { costCodeKey }
    );
  }

  const alreadyUpToDate = Boolean(candidate.isUpToDate);
  if (alreadyUpToDate) {
    return {
      ok: true,
      costCodeKey,
      candidate,
      inputDoc,
      replacementAdjustment,
      alreadyUpToDate: true,
    };
  }

  if (
    candidate.flags?.[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE] &&
    !selection.acknowledgeUnresolvedExcluded
  ) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.UNRESOLVED_ACK_REQUIRED,
      `Unresolved Prelims lines for ${costCodeKey} require explicit acknowledgement before adoption.`,
      { costCodeKey }
    );
  }

  if (
    candidate.driftState === PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED &&
    !selection.acknowledgeSupersededAdjustment
  ) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.SUPERSEDED_ACK_REQUIRED,
      `Manual CVR adjustment for ${costCodeKey} has superseded a prior Prelims adoption and requires acknowledgement to replace.`,
      { costCodeKey }
    );
  }

  return {
    ok: true,
    costCodeKey,
    candidate,
    inputDoc,
    replacementAdjustment,
    alreadyUpToDate: false,
  };
}

/**
 * Adopt selected Prelims cost codes into a Draft CVR period (atomic).
 */
async function adoptPrelimsForecasts(clientId, developmentId, periodId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;
  if (!isValidUuid(periodId)) {
    return fail(400, null, "periodId must be a valid UUID.");
  }

  const expectedPeriodKey = String(body.expectedPeriodKey || body.periodKey || "").trim();
  const expectedReportingMonth = toYearMonth(body.expectedReportingMonth || body.reportingMonth);
  if (!expectedPeriodKey) {
    return fail(400, PRELIMS_ADOPTION_ERROR_CODES.PERIOD_KEY_CHANGED, "expectedPeriodKey is required.");
  }
  if (!expectedReportingMonth) {
    return fail(
      400,
      PRELIMS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED,
      "expectedReportingMonth is required (YYYY-MM)."
    );
  }

  const parsed = parseSelections(body);
  if (!parsed.ok) return parsed;

  const resolvedActor = actor || provisionalActor(body);
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const periodRow = await findPeriodRow(clientId, developmentId, periodId, dbClient, {
      forUpdate: true,
    });
    if (!periodRow) {
      await dbClient.query("ROLLBACK");
      return fail(404, null, "CVR period not found.");
    }

    const period = periodRowToDocument(periodRow);
    if (!isCvrPeriodMutable(period.status) || period.status !== CVR_PERIOD_STATUSES.draft) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        PRELIMS_ADOPTION_ERROR_CODES.PERIOD_NOT_DRAFT,
        period.status === CVR_PERIOD_STATUSES.locked
          ? "Locked CVR periods cannot be mutated."
          : "Only draft CVR periods can accept Prelims adoption.",
        { periodStatus: period.status }
      );
    }

    if (String(period.periodKey || "").toUpperCase() !== expectedPeriodKey.toUpperCase()) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        PRELIMS_ADOPTION_ERROR_CODES.PERIOD_KEY_CHANGED,
        "CVR period key no longer matches the reviewed period.",
        { expectedPeriodKey, actualPeriodKey: period.periodKey }
      );
    }

    const actualReportingMonth = toYearMonth(period.reportingMonth);
    if (actualReportingMonth !== expectedReportingMonth) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        PRELIMS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED,
        "CVR reporting month no longer matches the reviewed period.",
        { expectedReportingMonth, actualReportingMonth }
      );
    }

    const inputRows = await listCostCodeInputRowsForUpdate(clientId, periodId, dbClient);
    const inputDocs = inputRows.map(inputRowToDocument);

    const closeCandidate = await buildCvrCloseCandidate({
      clientId,
      developmentId,
      periodId,
      actor: resolvedActor,
      dbClient,
    });
    if (!closeCandidate.ready) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        PRELIMS_ADOPTION_ERROR_CODES.CVR_CLOSE_NOT_READY,
        "Current CVR worksheet is not ready for Prelims adoption.",
        { blockers: closeCandidate.blockers || [] }
      );
    }

    const collectionResult = await listPrelimsItems(clientId, developmentId, {
      reportingMonth: actualReportingMonth,
      dbClient,
      forUpdate: true,
    });
    if (!collectionResult.ok) {
      await dbClient.query("ROLLBACK");
      return collectionResult;
    }
    const collection = collectionResult.collection;

    const classificationsResult = await listClassifications(clientId, dbClient);
    const classifications = classificationsResult.ok
      ? classificationsResult.classifications || []
      : [];

    const cvrRows = closeCandidate.snapshot?.rows || [];
    const displayMetadataByCostCode = {};
    for (const row of cvrRows) {
      const key = String(row.costCodeKey || "").trim();
      if (key) displayMetadataByCostCode[key] = row.displayMetadata || {};
    }
    for (const input of inputDocs) {
      const key = String(input.costCodeKey || "").trim();
      if (key) displayMetadataByCostCode[key] = input.displayMetadata || {};
    }

    const enginePreview = buildPrelimsAdoptionPreview({
      developmentId,
      periodKey: period.periodKey,
      reportingMonth: actualReportingMonth,
      prelimsItems: collection.items || [],
      programme: collection.programme,
      cvrRows,
      classifications,
      displayMetadataByCostCode,
    });

    const plans = [];
    for (const selection of parsed.selections) {
      const candidate = findByCostCodeKey(enginePreview.candidates, selection.costCodeKey);
      const inputDoc = findByCostCodeKey(inputDocs, selection.costCodeKey);
      const validated = validateSelectionAgainstCandidate({
        selection,
        candidate,
        inputDoc,
      });
      if (!validated.ok) {
        await dbClient.query("ROLLBACK");
        return validated;
      }
      plans.push(validated);
    }

    const writes = plans.filter((plan) => !plan.alreadyUpToDate);
    const unchanged = plans
      .filter((plan) => plan.alreadyUpToDate)
      .map((plan) => ({
        costCodeKey: plan.costCodeKey,
        inputId: plan.inputDoc.id,
        result: "already_up_to_date",
        adoptionStatus: PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE,
        oldAdjustment: plan.candidate.currentAdjustment,
        newAdjustment: plan.candidate.currentAdjustment,
        oldFinal: plan.candidate.currentFinalForecast,
        newFinal: plan.candidate.currentFinalForecast,
        inputVersion: plan.inputDoc.version,
      }));

    const adoptedAt = new Date().toISOString();
    const adoptionReason = buildAdoptionReason(actualReportingMonth);
    const adopted = [];

    for (const plan of writes) {
      const { candidate, inputDoc, replacementAdjustment } = plan;
      const previousAdjustment = roundMoney(inputDoc.commercialAdjustment) ?? 0;
      const previousReason = inputDoc.adjustmentReason || "";
      const previousFinal = candidate.currentFinalForecast;
      const newFinal = candidate.proposedFinalForecast;

      let metadata = appendAdjustmentHistory(
        inputDoc.displayMetadata || {},
        buildHistoryEntry({
          actor: resolvedActor,
          previousAdjustment,
          newAdjustment: replacementAdjustment,
          previousReason,
          newReason: adoptionReason,
          at: adoptedAt,
        })
      );

      const prelimsAdoption = {
        ...buildPrelimsAdoptionMetadata({
          adoptedTargetFinal: candidate.adoptedTargetFinal,
          adoptedAdjustment: replacementAdjustment,
          systemForecastAtAdoption: candidate.systemForecast,
          previousFinalForecast: previousFinal,
          previousAdjustment,
          proposalFingerprint: candidate.proposalFingerprint,
          sourceLineIds: candidate.sourceLineIds || [],
          excludedUnresolvedLineIds: candidate.excludedUnresolvedLineIds || [],
          reportingMonth: actualReportingMonth,
          periodKey: period.periodKey,
          adoptedAt,
          adoptedBy: resolvedActor,
        }),
        developmentId,
        periodId,
        inputId: inputDoc.id,
        inputVersionAtAdoption: inputDoc.version,
      };
      metadata[PRELIMS_ADOPTION_METADATA_KEY] = prelimsAdoption;

      const updated = await updateCostCodeInputCommercialFields(dbClient, {
        clientId,
        inputId: inputDoc.id,
        expectedVersion: inputDoc.version,
        commercialAdjustment: replacementAdjustment,
        adjustmentReason: adoptionReason,
        displayMetadata: metadata,
        actor: resolvedActor,
      });

      if (!updated.ok) {
        await dbClient.query("ROLLBACK");
        return fail(
          updated.status || 409,
          PRELIMS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT,
          updated.message || `Cost-code input version conflict for ${plan.costCodeKey}.`,
          { costCodeKey: plan.costCodeKey, input: inputDoc }
        );
      }

      adopted.push({
        costCodeKey: plan.costCodeKey,
        inputId: updated.input.id,
        result: "adopted",
        adoptionStatus: PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE,
        oldAdjustment: previousAdjustment,
        newAdjustment: replacementAdjustment,
        oldFinal: previousFinal,
        newFinal,
        oldReason: previousReason,
        newReason: adoptionReason,
        inputVersion: updated.input.version,
        manualAccrual: updated.input.manualAccrual,
        prelimsAdoption,
      });
    }

    if (writes.length) {
      await insertAudit(dbClient, {
        clientId,
        periodId,
        action: CVR_PERIOD_AUDIT_ACTIONS.prelimsAdopted,
        actor: resolvedActor,
        comment: `Prelims adoption applied to ${writes.length} cost code(s)`,
        priorStatus: period.status,
        newStatus: period.status,
      });
    }

    await dbClient.query("COMMIT");

    let review = null;
    try {
      const reviewResult = await buildPrelimsAdoptionReviewPreview(clientId, developmentId, {
        reportingMonth: actualReportingMonth,
      });
      if (reviewResult.ok) {
        review = {
          summary: reviewResult.preview.summary || null,
          periodKey: reviewResult.preview.periodKey,
          reportingMonth: reviewResult.preview.reportingMonth,
          periodStatus: reviewResult.preview.periodStatus,
        };
      }
    } catch {
      review = null;
    }

    return {
      ok: true,
      adoption: {
        periodId,
        periodKey: period.periodKey,
        reportingMonth: actualReportingMonth,
        adopted,
        unchanged,
        review,
      },
    };
  } catch (err) {
    try {
      await dbClient.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    dbClient.release();
  }
}

module.exports = {
  PRELIMS_ADOPTION_ERROR_CODES,
  adoptPrelimsForecasts,
  buildAdoptionReason,
  parseSelections,
  toYearMonth,
};
