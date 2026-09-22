/**
 * BL-034C/D — Selling Costs Review against CVR.
 * GET remains a compare. BL-034D Adopt is a separate POST command.
 * This preview does not write CVR, settings, membership, or adoption metadata.
 */

const { CVR_PERIOD_STATUSES } = require("./cvrPeriodConstants");
const { listCvrPeriods, listCostCodeInputs } = require("./cvrPeriodRepository");
const { getSellingCostsProposal } = require("./sellingCostsRepository");
const { DESTINATION_STATUSES, SELLING_COSTS_MODES } = require("./sellingCostsConstants");
const { pickOpenCvrPeriod } = require("./prelimsAdoptionPreviewService");
const { buildCvrCloseCandidate } = require("./cvrCloseEngine");
const {
  SELLING_COSTS_REVIEW_BLOCK_CODES,
  SELLING_COSTS_REVIEW_STATES,
  costCodeKeyIdentity,
  compareSellingCostsToCvr,
  extractSellingCostsAdoptionMetadata,
  normalizeReportingMonth,
  roundMoney,
} = require("./sellingCostsAdoptionCompare");
const {
  buildSellingCostsReconciliation,
  classifySellingCostsOwnership,
} = require("./sellingCostsAdoptionReconciliation");

const ADJUSTMENT_SEMANTICS =
  "The proposed replacement adjustment would replace the current CVR commercial adjustment; it is not added to it. This review does not write the CVR.";
const ACCRUAL_NOTE = "Accrual is shown for context only and is not changed by this review.";
const MISSING_MEMBER_MESSAGE =
  "This Selling Costs destination is not currently a member of the open CVR. Review cannot propose an adjustment until it is on the CVR. This review will not add it.";

function formatPounds(value) {
  const money = roundMoney(value);
  if (money == null) return "—";
  const negative = money < 0;
  const abs = Math.abs(money).toFixed(2);
  const [whole, fraction] = abs.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}£${grouped}.${fraction}`;
}

function signedPounds(value) {
  const money = roundMoney(value);
  if (money == null) return "—";
  if (money > 0) return `+${formatPounds(money)}`;
  return formatPounds(money);
}

function destinationBlock(destination) {
  const status = String(destination?.status || "");
  switch (status) {
    case DESTINATION_STATUSES.MISSING:
      return {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_MISSING,
        message:
          destination.message ||
          "Selling Costs destination was not found on Cost Code Master.",
      };
    case DESTINATION_STATUSES.INACTIVE:
      return {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_INACTIVE,
        message: destination.message || "Selling Costs destination is inactive.",
      };
    case DESTINATION_STATUSES.FORBIDDEN:
      return {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_FORBIDDEN,
        message: destination.message || "This destination cannot be used for Simple Selling Costs.",
      };
    case DESTINATION_STATUSES.NOT_SELLING:
      return {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_NOT_SELLING,
        message:
          destination.message ||
          "Selling Costs destination must be classified as SELLING before CVR review.",
      };
    case DESTINATION_STATUSES.UNCONFIGURED:
      return {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_UNCONFIGURED,
        message: destination.message || "No Selling Costs destination is configured.",
      };
    default:
      return null;
  }
}

function findByCostCodeKey(items, key, getKey) {
  const identity = costCodeKeyIdentity(key);
  if (!identity) return null;
  return (
    (items || []).find((item) => costCodeKeyIdentity(getKey(item)) === identity) || null
  );
}

function proposalContext(proposal) {
  return {
    mode: proposal.mode,
    assumptionPercent: proposal.assumptionPercent,
    assumptionSource: proposal.assumptionSource,
    forecastRevenue: proposal.forecastRevenue,
    forecastSellingCosts: proposal.forecastSellingCosts,
    revenue: proposal.revenue,
    destination: proposal.destination,
    template: proposal.template || null,
    readyLineCount: proposal.readyLineCount ?? null,
    unreadyLineCount: proposal.unreadyLineCount ?? null,
    lines: proposal.mode === SELLING_COSTS_MODES.DETAILED ? proposal.lines || [] : undefined,
    costCodeAggregation: proposal.mode === SELLING_COSTS_MODES.DETAILED ? proposal.costCodeAggregation || [] : undefined,
    quantityEvidenceFingerprint: proposal.quantityEvidenceFingerprint || null,
    proposalEvidenceFingerprint: proposal.proposalEvidenceFingerprint || null,
    settings: {
      exists: Boolean(proposal.settings?.exists),
      version: Number(proposal.settings?.version) || 0,
      destinationCostCodeKey: proposal.settings?.destinationCostCodeKey || null,
      destinationCostCodeId: proposal.settings?.destinationCostCodeId || null,
    },
  };
}

function detailedDestinations(proposal) {
  return (proposal.costCodeAggregation || []).map((aggregate) => ({
    destination: {
      ...aggregate.costCode,
      costCodeKey: aggregate.costCode?.code,
      status: aggregate.costCode?.active === false ? DESTINATION_STATUSES.INACTIVE : DESTINATION_STATUSES.READY,
    },
    forecast: aggregate.forecast,
    aggregateFingerprint: aggregate.aggregateFingerprint,
    lines: aggregate.lines || [],
  }));
}

function buildHeadline(comparison) {
  if (!comparison || comparison.sellingCostsProposal == null) return null;
  if (comparison.isUpToDate) {
    return (
      `Selling Costs is up to date on the current CVR. ` +
      `The adopted forecast is ${formatPounds(comparison.currentFinalForecast)}.`
    );
  }
  return (
    `BuildLite currently proposes ${formatPounds(comparison.sellingCostsProposal)} of Selling Costs. ` +
    `The CVR currently forecasts ${formatPounds(comparison.currentFinalForecast)}. ` +
    `Adopting would require replacement adjustment ${signedPounds(
      comparison.proposedReplacementAdjustment
    )} and would move the Final Forecast by ${signedPounds(comparison.resultingMovement)}.`
  );
}

function isDraftPeriod(period) {
  return String(period?.status || "") === CVR_PERIOD_STATUSES.draft;
}

function blockedPreview({
  developmentId,
  proposal,
  period = null,
  block,
  comparison = null,
}) {
  return {
    ok: true,
    preview: {
      readOnly: true,
      reviewStatus: "blocked",
      reviewState: SELLING_COSTS_REVIEW_STATES.BLOCKED,
      blockedReason: block,
      developmentId,
      periodKey: period?.periodKey || null,
      periodId: period?.id || null,
      periodStatus: period?.status || null,
      periodVersion: Number(period?.version) || 0,
      reportingMonth: period ? normalizeReportingMonth(period.reportingMonth) : null,
      adjustmentSemantics: ADJUSTMENT_SEMANTICS,
      accrualNote: ACCRUAL_NOTE,
      proposal: proposalContext(proposal),
      destination: proposal.destination,
      comparison,
      headline: null,
      canAdopt: false,
    },
  };
}

async function buildSellingCostsReviewPreview(clientId, developmentId) {
  const proposalResult = await getSellingCostsProposal(clientId, developmentId);
  if (!proposalResult.ok) return proposalResult;
  const proposal = proposalResult.proposal;

  if (String(proposal.mode || "") === SELLING_COSTS_MODES.DETAILED && Number(proposal.unreadyLineCount) > 0) {
    return blockedPreview({
      developmentId,
      proposal,
      block: {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DETAILED_NOT_AVAILABLE,
        message: `Complete every enabled Detailed Selling Costs line before adoption (${proposal.unreadyLineCount} need attention).`,
      },
    });
  }

  const destinations = proposal.mode === SELLING_COSTS_MODES.DETAILED
    ? detailedDestinations(proposal)
    : [{ destination: proposal.destination, forecast: proposal.forecastSellingCosts, lines: [] }];
  const destBlock = destinations.map(item => destinationBlock(item.destination)).find(Boolean);
  if (destBlock) {
    return blockedPreview({
      developmentId,
      proposal,
      block: destBlock,
    });
  }

  if ((proposal.mode !== SELLING_COSTS_MODES.DETAILED && !proposal.revenue?.ready) || proposal.forecastSellingCosts == null || !destinations.length) {
    return blockedPreview({
      developmentId,
      proposal,
      block: {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.REVENUE_UNAVAILABLE,
        message:
          proposal.revenue?.hint ||
          "Selling Costs forecast cannot be finalised because Forecast Revenue is unavailable.",
      },
    });
  }

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

  const inputsResult = await listCostCodeInputs(clientId, developmentId, openPeriod.id);
  if (!inputsResult.ok) return inputsResult;
  const inputRows = inputsResult.inputs || [];
  const missingDestinations = destinations.filter(({ destination }) => !findByCostCodeKey(inputRows, destination.costCodeKey, row => row.costCodeKey));
  if (missingDestinations.length) {
    return blockedPreview({
      developmentId,
      proposal,
      period: openPeriod,
      block: {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_NOT_ON_CVR,
        message: `${MISSING_MEMBER_MESSAGE} Missing: ${missingDestinations.map(item => item.destination.costCodeKey).join(", ")}.`,
      },
    });
  }

  const cvrRows = closeCandidate.snapshot?.rows || [];
  const comparisons = destinations.map(({ destination, forecast, aggregateFingerprint, lines }) => {
    const destinationKey = destination.costCodeKey;
    const overlay = findByCostCodeKey(inputRows, destinationKey, row => row.costCodeKey);
    const cvrRow = findByCostCodeKey(cvrRows, destinationKey, row => row.costCodeKey);
    const existingMetadata = extractSellingCostsAdoptionMetadata(overlay.displayMetadata || cvrRow?.displayMetadata);
    const detailedEvidence = proposal.mode === SELLING_COSTS_MODES.DETAILED ? {
      evidenceVersion: 1,
      wholeProposalFingerprint: proposal.proposalEvidenceFingerprint,
      aggregateFingerprint,
      template: proposal.template,
      settingsVersion: Number(proposal.settings?.version) || 0,
      quantityEvidenceFingerprint: proposal.quantityEvidenceFingerprint,
      destinationCostCodeId: destination.id,
      destinationCostCodeKey: destinationKey,
      aggregate: forecast,
      lines,
    } : null;
    return {
      ...compareSellingCostsToCvr({developmentId,periodKey:openPeriod.periodKey,reportingMonth:openPeriod.reportingMonth,mode:proposal.mode,assumptionPercent:proposal.assumptionPercent,forecastRevenue:proposal.forecastRevenue,forecastSellingCosts:forecast,destinationCostCodeKey:destinationKey,cvrRow,overlay,existingMetadata,detailedEvidence}),
      costCodeDescription: overlay.costCodeLabel || cvrRow?.costCodeLabel || destination.label || destinationKey,
      destination,
      detailedEvidence,
      constituentLines: lines,
    };
  });
  const destinationKeys = comparisons.map(item => item.costCodeKey);
  const priorRows = buildSellingCostsReconciliation({
    inputs: inputRows,
    newDestinationKeys: destinationKeys,
  });
  const reconciliation = [
    ...priorRows.map((row) => ({
      action: row.action,
      costCodeKey: row.costCodeKey,
      costCodeDescription: row.costCodeDescription,
      inputId: row.inputId,
      inputVersion: row.inputVersion,
      currentAdjustment: row.currentAdjustment,
      proposedAdjustment:
        row.action === "released" ? row.baselineAdjustment : row.currentAdjustment,
      resultingMovement:
        row.action === "released"
          ? roundMoney(row.baselineAdjustment - row.currentAdjustment)
          : 0,
    })),
    ...comparisons.map(comparison => {
      const overlay=findByCostCodeKey(inputRows,comparison.costCodeKey,row=>row.costCodeKey);
      const ownership=classifySellingCostsOwnership(overlay);
      const action = comparison.isUpToDate
        ? "unchanged"
        : comparison.reviewState === SELLING_COSTS_REVIEW_STATES.SUPERSEDED
          ? "replace_manual"
          : ownership.owned
            ? "retained"
            : "added";
      return {action,costCodeKey:comparison.costCodeKey,costCodeDescription:comparison.costCodeDescription,inputId:overlay.id,inputVersion:overlay.version,currentAdjustment:comparison.currentAdjustment,proposedAdjustment:comparison.proposedReplacementAdjustment,resultingMovement:comparison.resultingMovement,constituentLines:comparison.constituentLines};
    }),
  ];
  const reviewState=comparisons.some(item=>item.reviewState===SELLING_COSTS_REVIEW_STATES.SUPERSEDED)?SELLING_COSTS_REVIEW_STATES.SUPERSEDED:comparisons.every(item=>item.isUpToDate)?SELLING_COSTS_REVIEW_STATES.UP_TO_DATE:comparisons.some(item=>item.reviewState===SELLING_COSTS_REVIEW_STATES.DRIFTED)?SELLING_COSTS_REVIEW_STATES.DRIFTED:SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED;
  const comparison=comparisons[0]||null;

  return {
    ok: true,
    preview: {
      readOnly: true,
      reviewStatus: "ready",
      reviewState,
      blockedReason: null,
      developmentId,
      periodKey: openPeriod.periodKey,
      periodId: openPeriod.id,
      periodStatus: openPeriod.status,
      periodVersion: Number(openPeriod.version) || 0,
      reportingMonth: normalizeReportingMonth(openPeriod.reportingMonth),
      adjustmentSemantics: ADJUSTMENT_SEMANTICS,
      accrualNote: ACCRUAL_NOTE,
      proposal: proposalContext(proposal),
      destination: proposal.destination,
      comparison,
      comparisons,
      reconciliation,
      headline: proposal.mode === SELLING_COSTS_MODES.DETAILED ? `Detailed Selling Costs proposes ${formatPounds(proposal.forecastSellingCosts)} across ${comparisons.length} CVR destination${comparisons.length===1?"":"s"}.` : buildHeadline(comparison),
      canAdopt: isDraftPeriod(openPeriod),
    },
  };
}

module.exports = {
  ADJUSTMENT_SEMANTICS,
  ACCRUAL_NOTE,
  MISSING_MEMBER_MESSAGE,
  formatPounds,
  signedPounds,
  buildSellingCostsReviewPreview,
};
