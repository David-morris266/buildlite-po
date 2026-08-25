/**
 * BL-034D — Server Selling Costs → Draft CVR adoption command.
 * Accepts intent + expectations only. Recalculates replacement adjustment.
 * Writes commercial adjustment + provenance. Does not write budget, system
 * forecast, accrual, membership, settings, or period lifecycle.
 */

const crypto = require("crypto");
const { pool } = require("../db");
const {
  CVR_PERIOD_AUDIT_ACTIONS,
  CVR_PERIOD_STATUSES,
  CVR_CLOSE_NOT_READY_CODE,
  isCvrPeriodMutable,
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
const { pickOpenCvrPeriod } = require("./prelimsAdoptionPreviewService");
const { DESTINATION_STATUSES, SELLING_COSTS_MODES } = require("./sellingCostsConstants");
const { composeProposal } = require("./sellingCostsRepository");
const {
  SELLING_COSTS_ADOPTION_METADATA_KEY,
  SELLING_COSTS_REVIEW_STATES,
  SELLING_COSTS_REVIEW_FLAG_KEYS,
  costCodeKeyIdentity,
  moneyClose,
  roundMoney,
  compareSellingCostsToCvr,
  extractSellingCostsAdoptionMetadata,
  buildSellingCostsAdoptionMetadata,
  normalizeReportingMonth,
} = require("./sellingCostsAdoptionCompare");
const { buildSellingCostsReviewPreview } = require("./sellingCostsReviewPreviewService");

const SELLING_COSTS_ADOPTION_ERROR_CODES = {
  PERIOD_NOT_DRAFT: "PERIOD_NOT_DRAFT",
  PERIOD_KEY_CHANGED: "PERIOD_KEY_CHANGED",
  REPORTING_MONTH_CHANGED: "REPORTING_MONTH_CHANGED",
  SELLING_COSTS_PROPOSAL_STALE: "SELLING_COSTS_PROPOSAL_STALE",
  SELLING_COSTS_SETTINGS_CHANGED: "SELLING_COSTS_SETTINGS_CHANGED",
  CVR_INPUT_CONFLICT: "CVR_INPUT_CONFLICT",
  SYSTEM_FORECAST_DRIFT: "SYSTEM_FORECAST_DRIFT",
  CURRENT_ADJUSTMENT_DRIFT: "CURRENT_ADJUSTMENT_DRIFT",
  DESTINATION_NOT_ON_CVR: "DESTINATION_NOT_ON_CVR",
  DESTINATION_INVALID: "DESTINATION_INVALID",
  SUPERSEDED_ACK_REQUIRED: "SUPERSEDED_ACK_REQUIRED",
  BELOW_SYSTEM_ACK_REQUIRED: "BELOW_SYSTEM_ACK_REQUIRED",
  SELECTION_REQUIRED: "SELECTION_REQUIRED",
  DUPLICATE_COST_CODE: "DUPLICATE_COST_CODE",
  DETAILED_NOT_AVAILABLE: "DETAILED_NOT_AVAILABLE",
  CANNOT_ADOPT: "CANNOT_ADOPT",
  CVR_CLOSE_NOT_READY: CVR_CLOSE_NOT_READY_CODE,
};

function fail(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}

function sameCostCodeKey(a, b) {
  return costCodeKeyIdentity(a) === costCodeKeyIdentity(b);
}

function findByCostCodeKey(rows, costCodeKey) {
  return (rows || []).find((row) =>
    sameCostCodeKey(row.costCodeKey || row.cost_code_key, costCodeKey)
  );
}

function buildAdoptionReason(reportingMonth) {
  return `Selling Costs forecast adopted — ${reportingMonth}`;
}

function parseExpectedSettingsVersion(body = {}) {
  if (body.expectedSettingsVersion == null && body.settingsVersion == null) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_SETTINGS_CHANGED,
      "expectedSettingsVersion is required."
    );
  }
  const version = Number(body.expectedSettingsVersion ?? body.settingsVersion);
  if (!Number.isInteger(version) || version < 0) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_SETTINGS_CHANGED,
      "expectedSettingsVersion must be a non-negative integer."
    );
  }
  return { ok: true, expectedSettingsVersion: version };
}

function parseSelections(body = {}) {
  let raw = Array.isArray(body.selections) ? body.selections : null;
  if (!raw) {
    if (body.destinationCostCodeKey || body.costCodeKey) {
      raw = [body];
    } else {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED,
        "selections must be a non-empty array, or destinationCostCodeKey must be provided."
      );
    }
  }
  if (!raw.length) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED,
      "At least one destination cost code must be selected."
    );
  }

  const seen = new Set();
  const selections = [];
  for (const item of raw) {
    const destinationCostCodeKey = String(
      item?.destinationCostCodeKey || item?.costCodeKey || ""
    ).trim();
    if (!destinationCostCodeKey) {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED,
        "Each selection requires destinationCostCodeKey."
      );
    }
    const keyNorm = costCodeKeyIdentity(destinationCostCodeKey);
    if (seen.has(keyNorm)) {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.DUPLICATE_COST_CODE,
        `Duplicate selected cost code: ${destinationCostCodeKey}.`,
        { costCodeKey: destinationCostCodeKey }
      );
    }
    seen.add(keyNorm);

    const expectedInputVersion = Number(item.expectedInputVersion ?? item.inputVersion);
    if (!Number.isInteger(expectedInputVersion) || expectedInputVersion < 1) {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT,
        "expectedInputVersion must be a positive integer.",
        { costCodeKey: destinationCostCodeKey }
      );
    }

    const proposalFingerprint = String(item.proposalFingerprint || "").trim();
    if (!proposalFingerprint) {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_PROPOSAL_STALE,
        "proposalFingerprint is required for each selection.",
        { costCodeKey: destinationCostCodeKey }
      );
    }

    if (item.expectedSystemForecast == null || item.expectedSystemForecast === "") {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT,
        "expectedSystemForecast is required for each selection.",
        { costCodeKey: destinationCostCodeKey }
      );
    }
    if (item.expectedCurrentAdjustment == null || item.expectedCurrentAdjustment === "") {
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT,
        "expectedCurrentAdjustment is required for each selection.",
        { costCodeKey: destinationCostCodeKey }
      );
    }

    selections.push({
      destinationCostCodeKey,
      proposalFingerprint,
      expectedInputVersion,
      expectedSystemForecast: roundMoney(item.expectedSystemForecast),
      expectedCurrentAdjustment: roundMoney(item.expectedCurrentAdjustment) ?? 0,
      acknowledgeSupersededAdjustment: Boolean(
        item.acknowledgeSupersededAdjustment ?? item.acknowledgeSuperseded
      ),
      acknowledgeProposalBelowSystem: Boolean(
        item.acknowledgeProposalBelowSystem ?? item.acknowledgeBelowSystem
      ),
      // Intentionally ignored — browser must never authorise the write amount.
      proposedAdjustmentIgnored: item.proposedAdjustment,
      proposedFinalIgnored: item.proposedFinal,
      forecastRevenueIgnored: item.forecastRevenue,
      assumptionPercentIgnored: item.assumptionPercent,
      forecastSellingCostsIgnored: item.forecastSellingCosts,
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
    id: `adj-selling-costs-${crypto.randomUUID()}`,
    date: at,
    timestamp: at,
    user: actor || null,
    actor: actor || null,
    previousAdjustment,
    newAdjustment,
    previousReason: previousReason || "",
    newReason,
    reason: newReason,
    source: "selling_costs_adoption",
  };
}

function destinationIsReady(destination) {
  return String(destination?.status || "") === DESTINATION_STATUSES.READY;
}

function validateSelectionAgainstComparison({
  selection,
  comparison,
  inputDoc,
  resolvedDestinationKey,
  destination,
}) {
  const costCodeKey = selection.destinationCostCodeKey;

  if (!destinationIsReady(destination)) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_INVALID,
      `Selling Costs destination ${costCodeKey} is not a valid active destination.`,
      { costCodeKey }
    );
  }

  if (!sameCostCodeKey(costCodeKey, resolvedDestinationKey)) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_INVALID,
      `Destination ${costCodeKey} does not match the current Selling Costs destination.`,
      { costCodeKey, actualDestination: resolvedDestinationKey }
    );
  }

  if (!inputDoc || comparison?.flags?.[SELLING_COSTS_REVIEW_FLAG_KEYS.NO_CVR_MEMBER]) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_NOT_ON_CVR,
      `Cost code ${costCodeKey} is not present on the current CVR and cannot be adopted. Add it to the CVR first.`,
      { costCodeKey }
    );
  }

  if (selection.proposalFingerprint !== comparison.proposalFingerprint) {
    return fail(
      409,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_PROPOSAL_STALE,
      "Selling Costs proposal has changed since review. Forecast Revenue or the assumption may have changed.",
      { costCodeKey }
    );
  }

  if (inputDoc.version !== selection.expectedInputVersion) {
    return fail(
      409,
      SELLING_COSTS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT,
      `Cost-code input version conflict for ${costCodeKey}.`,
      { costCodeKey, input: inputDoc }
    );
  }

  if (!moneyClose(selection.expectedSystemForecast, comparison.systemForecast)) {
    return fail(
      409,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SYSTEM_FORECAST_DRIFT,
      `System forecast for ${costCodeKey} has drifted since review.`,
      { costCodeKey }
    );
  }

  if (!moneyClose(selection.expectedCurrentAdjustment, comparison.currentAdjustment)) {
    return fail(
      409,
      SELLING_COSTS_ADOPTION_ERROR_CODES.CURRENT_ADJUSTMENT_DRIFT,
      `Current CVR adjustment for ${costCodeKey} has drifted since review.`,
      { costCodeKey }
    );
  }

  const replacementAdjustment = roundMoney(comparison.proposedReplacementAdjustment);
  if (replacementAdjustment == null) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.CANNOT_ADOPT,
      `Replacement adjustment for ${costCodeKey} could not be calculated.`,
      { costCodeKey }
    );
  }

  if (comparison.isUpToDate) {
    return {
      ok: true,
      costCodeKey,
      comparison,
      inputDoc,
      replacementAdjustment,
      alreadyUpToDate: true,
    };
  }

  if (
    comparison.flags?.[SELLING_COSTS_REVIEW_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM] &&
    !selection.acknowledgeProposalBelowSystem
  ) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.BELOW_SYSTEM_ACK_REQUIRED,
      `Selling Costs proposal for ${costCodeKey} is below the current system forecast and requires acknowledgement before adoption.`,
      { costCodeKey }
    );
  }

  if (
    comparison.reviewState === SELLING_COSTS_REVIEW_STATES.SUPERSEDED &&
    !selection.acknowledgeSupersededAdjustment
  ) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.SUPERSEDED_ACK_REQUIRED,
      `Manual CVR adjustment for ${costCodeKey} has superseded a prior Selling Costs adoption and requires acknowledgement to replace.`,
      { costCodeKey }
    );
  }

  return {
    ok: true,
    costCodeKey,
    comparison,
    inputDoc,
    replacementAdjustment,
    alreadyUpToDate: false,
  };
}

async function lockSettingsRow(clientId, developmentId, dbClient) {
  const { rows } = await dbClient.query(
    `
      SELECT *
      FROM development_selling_costs_settings
      WHERE client_id = $1 AND development_id = $2
      FOR UPDATE
    `,
    [clientId, developmentId]
  );
  return rows[0] || null;
}

async function listPeriodRowsForDevelopment(clientId, developmentId, dbClient) {
  const { rows } = await dbClient.query(
    `
      SELECT *
      FROM cvr_periods
      WHERE client_id = $1 AND development_id = $2
      ORDER BY period_key ASC
    `,
    [clientId, developmentId]
  );
  return rows;
}

/**
 * Adopt selected Selling Costs destination(s) into the current Draft CVR (atomic).
 * Simple mode currently sends one destination. The selections array is the
 * future Detailed-mode contract; Detailed mode itself is not implemented.
 */
async function adoptSellingCostsForecasts(clientId, developmentId, body = {}, { actor } = {}) {
  const scoped = await developmentOr404(clientId, developmentId);
  if (!scoped.ok) return scoped;

  const expectedPeriodKey = String(body.expectedPeriodKey || body.periodKey || "").trim();
  const expectedReportingMonth = normalizeReportingMonth(
    body.expectedReportingMonth || body.reportingMonth
  );
  if (!expectedPeriodKey) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.PERIOD_KEY_CHANGED,
      "expectedPeriodKey is required."
    );
  }
  if (!expectedReportingMonth) {
    return fail(
      400,
      SELLING_COSTS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED,
      "expectedReportingMonth is required (YYYY-MM)."
    );
  }

  const settingsParsed = parseExpectedSettingsVersion(body);
  if (!settingsParsed.ok) return settingsParsed;

  const parsed = parseSelections(body);
  if (!parsed.ok) return parsed;

  const resolvedActor = actor || provisionalActor(body);
  const dbClient = await pool.connect();

  try {
    await dbClient.query("BEGIN");

    const periodRows = await listPeriodRowsForDevelopment(clientId, developmentId, dbClient);
    const openPeriod = pickOpenCvrPeriod(
      periodRows.map((row) => periodRowToDocument(row))
    );
    if (!openPeriod) {
      await dbClient.query("ROLLBACK");
      return fail(404, null, "No open CVR worksheet is available for Selling Costs adoption.");
    }

    const periodRow = await findPeriodRow(clientId, developmentId, openPeriod.id, dbClient, {
      forUpdate: true,
    });
    if (!periodRow) {
      await dbClient.query("ROLLBACK");
      return fail(404, null, "CVR period not found.");
    }

    const period = periodRowToDocument(periodRow);
    const periodId = period.id;

    if (!isCvrPeriodMutable(period.status) || period.status !== CVR_PERIOD_STATUSES.draft) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        SELLING_COSTS_ADOPTION_ERROR_CODES.PERIOD_NOT_DRAFT,
        period.status === CVR_PERIOD_STATUSES.locked
          ? "Locked CVR periods cannot be mutated."
          : "Only draft CVR periods can accept Selling Costs adoption.",
        { periodStatus: period.status }
      );
    }

    if (String(period.periodKey || "").toUpperCase() !== expectedPeriodKey.toUpperCase()) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        SELLING_COSTS_ADOPTION_ERROR_CODES.PERIOD_KEY_CHANGED,
        "CVR period key no longer matches the reviewed period.",
        { expectedPeriodKey, actualPeriodKey: period.periodKey }
      );
    }

    const actualReportingMonth = normalizeReportingMonth(period.reportingMonth);
    if (actualReportingMonth !== expectedReportingMonth) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        SELLING_COSTS_ADOPTION_ERROR_CODES.REPORTING_MONTH_CHANGED,
        "CVR reporting month no longer matches the reviewed period.",
        { expectedReportingMonth, actualReportingMonth }
      );
    }

    const settingsRow = await lockSettingsRow(clientId, developmentId, dbClient);
    const actualSettingsVersion = settingsRow ? Number(settingsRow.version) || 0 : 0;
    if (actualSettingsVersion !== settingsParsed.expectedSettingsVersion) {
      await dbClient.query("ROLLBACK");
      return fail(
        409,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SELLING_COSTS_SETTINGS_CHANGED,
        "Selling Costs settings have changed since review.",
        {
          expectedSettingsVersion: settingsParsed.expectedSettingsVersion,
          actualSettingsVersion,
        }
      );
    }

    const proposal = await composeProposal(clientId, developmentId, settingsRow, dbClient);
    if (String(proposal.mode || "") === SELLING_COSTS_MODES.DETAILED) {
      await dbClient.query("ROLLBACK");
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.DETAILED_NOT_AVAILABLE,
        "Detailed Selling Costs is not available yet."
      );
    }

    if (parsed.selections.length !== 1) {
      await dbClient.query("ROLLBACK");
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.SELECTION_REQUIRED,
        "Simple Selling Costs currently adopts one destination cost code."
      );
    }

    if (!destinationIsReady(proposal.destination) || proposal.forecastSellingCosts == null) {
      await dbClient.query("ROLLBACK");
      return fail(
        400,
        SELLING_COSTS_ADOPTION_ERROR_CODES.DESTINATION_INVALID,
        proposal.destination?.message ||
          "Selling Costs destination is not valid for adoption.",
        { destination: proposal.destination }
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
        SELLING_COSTS_ADOPTION_ERROR_CODES.CVR_CLOSE_NOT_READY,
        "Current CVR worksheet is not ready for Selling Costs adoption.",
        { blockers: closeCandidate.blockers || [] }
      );
    }

    const destinationKey = proposal.destination.costCodeKey;
    const cvrRows = closeCandidate.snapshot?.rows || [];
    const plans = [];

    for (const selection of parsed.selections) {
      const inputDoc = findByCostCodeKey(inputDocs, selection.destinationCostCodeKey);
      const overlay = inputDoc;
      const cvrRow = findByCostCodeKey(cvrRows, selection.destinationCostCodeKey);
      const existingMetadata = extractSellingCostsAdoptionMetadata(
        overlay?.displayMetadata || cvrRow?.displayMetadata
      );
      const comparison = compareSellingCostsToCvr({
        developmentId,
        periodKey: period.periodKey,
        reportingMonth: actualReportingMonth,
        mode: proposal.mode,
        assumptionPercent: proposal.assumptionPercent,
        forecastRevenue: proposal.forecastRevenue,
        forecastSellingCosts: proposal.forecastSellingCosts,
        destinationCostCodeKey: destinationKey,
        cvrRow,
        overlay,
        existingMetadata,
      });

      const validated = validateSelectionAgainstComparison({
        selection,
        comparison,
        inputDoc,
        resolvedDestinationKey: destinationKey,
        destination: proposal.destination,
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
        reviewState: SELLING_COSTS_REVIEW_STATES.UP_TO_DATE,
        oldAdjustment: plan.comparison.currentAdjustment,
        newAdjustment: plan.comparison.currentAdjustment,
        oldFinal: plan.comparison.currentFinalForecast,
        newFinal: plan.comparison.currentFinalForecast,
        inputVersion: plan.inputDoc.version,
        manualAccrual: plan.inputDoc.manualAccrual,
      }));

    const adoptedAt = new Date().toISOString();
    const adoptionReason = buildAdoptionReason(actualReportingMonth);
    const adopted = [];

    for (const plan of writes) {
      const { comparison, inputDoc, replacementAdjustment } = plan;
      const previousAdjustment = roundMoney(inputDoc.commercialAdjustment) ?? 0;
      const previousReason = inputDoc.adjustmentReason || "";
      const previousFinal = comparison.currentFinalForecast;
      const newFinal = comparison.proposedFinalForecast;

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

      const sellingCostsAdoption = buildSellingCostsAdoptionMetadata({
        mode: proposal.mode,
        adoptedTargetFinal: comparison.sellingCostsProposal,
        adoptedAdjustment: replacementAdjustment,
        systemForecastAtAdoption: comparison.systemForecast,
        previousFinalForecast: previousFinal,
        previousAdjustment,
        proposalFingerprint: comparison.proposalFingerprint,
        assumptionPercent: proposal.assumptionPercent,
        forecastRevenueAtAdoption: proposal.forecastRevenue,
        destinationCostCodeKey: comparison.costCodeKey,
        settingsVersion: actualSettingsVersion,
        reportingMonth: actualReportingMonth,
        periodKey: period.periodKey,
        adoptedAt,
        adoptedBy: resolvedActor,
        inputId: inputDoc.id,
        inputVersionAtAdoption: inputDoc.version,
      });
      metadata[SELLING_COSTS_ADOPTION_METADATA_KEY] = sellingCostsAdoption;

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
          SELLING_COSTS_ADOPTION_ERROR_CODES.CVR_INPUT_CONFLICT,
          updated.message || `Cost-code input version conflict for ${plan.costCodeKey}.`,
          { costCodeKey: plan.costCodeKey, input: inputDoc }
        );
      }

      adopted.push({
        costCodeKey: plan.costCodeKey,
        inputId: updated.input.id,
        result: "adopted",
        reviewState: SELLING_COSTS_REVIEW_STATES.UP_TO_DATE,
        oldAdjustment: previousAdjustment,
        newAdjustment: replacementAdjustment,
        oldFinal: previousFinal,
        newFinal,
        oldReason: previousReason,
        newReason: adoptionReason,
        inputVersion: updated.input.version,
        manualAccrual: updated.input.manualAccrual,
        sellingCostsAdoption,
      });
    }

    if (writes.length) {
      await insertAudit(dbClient, {
        clientId,
        periodId,
        action: CVR_PERIOD_AUDIT_ACTIONS.sellingCostsAdopted,
        actor: resolvedActor,
        comment: `Selling Costs adoption applied to ${writes.length} cost code(s)`,
        priorStatus: period.status,
        newStatus: period.status,
      });
    }

    await dbClient.query("COMMIT");

    let review = null;
    try {
      const reviewResult = await buildSellingCostsReviewPreview(clientId, developmentId);
      if (reviewResult.ok) review = reviewResult.preview;
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
  SELLING_COSTS_ADOPTION_ERROR_CODES,
  adoptSellingCostsForecasts,
  buildAdoptionReason,
  parseSelections,
};
