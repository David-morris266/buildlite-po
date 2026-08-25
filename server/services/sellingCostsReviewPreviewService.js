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
    settings: {
      exists: Boolean(proposal.settings?.exists),
      version: Number(proposal.settings?.version) || 0,
      destinationCostCodeKey: proposal.settings?.destinationCostCodeKey || null,
    },
  };
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

  if (String(proposal.mode || "") === SELLING_COSTS_MODES.DETAILED) {
    return blockedPreview({
      developmentId,
      proposal,
      block: {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DETAILED_NOT_AVAILABLE,
        message: "Detailed Selling Costs is not available yet.",
      },
    });
  }

  const destBlock = destinationBlock(proposal.destination);
  if (destBlock) {
    return blockedPreview({
      developmentId,
      proposal,
      block: destBlock,
    });
  }

  if (!proposal.revenue?.ready || proposal.forecastSellingCosts == null) {
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

  const destinationKey = proposal.destination?.costCodeKey;
  const inputsResult = await listCostCodeInputs(clientId, developmentId, openPeriod.id);
  if (!inputsResult.ok) return inputsResult;

  const overlay = findByCostCodeKey(
    inputsResult.inputs || [],
    destinationKey,
    (row) => row.costCodeKey
  );
  if (!overlay) {
    return blockedPreview({
      developmentId,
      proposal,
      period: openPeriod,
      block: {
        code: SELLING_COSTS_REVIEW_BLOCK_CODES.DESTINATION_NOT_ON_CVR,
        message: MISSING_MEMBER_MESSAGE,
      },
    });
  }

  const cvrRows = closeCandidate.snapshot?.rows || [];
  const cvrRow = findByCostCodeKey(cvrRows, destinationKey, (row) => row.costCodeKey);
  const existingMetadata = extractSellingCostsAdoptionMetadata(
    overlay.displayMetadata || cvrRow?.displayMetadata
  );

  const comparison = compareSellingCostsToCvr({
    developmentId,
    periodKey: openPeriod.periodKey,
    reportingMonth: openPeriod.reportingMonth,
    mode: proposal.mode,
    assumptionPercent: proposal.assumptionPercent,
    forecastRevenue: proposal.forecastRevenue,
    forecastSellingCosts: proposal.forecastSellingCosts,
    destinationCostCodeKey: destinationKey,
    cvrRow,
    overlay,
    existingMetadata,
  });

  return {
    ok: true,
    preview: {
      readOnly: true,
      reviewStatus: "ready",
      reviewState: comparison.reviewState,
      blockedReason: null,
      developmentId,
      periodKey: openPeriod.periodKey,
      periodId: openPeriod.id,
      periodStatus: openPeriod.status,
      reportingMonth: normalizeReportingMonth(openPeriod.reportingMonth),
      adjustmentSemantics: ADJUSTMENT_SEMANTICS,
      accrualNote: ACCRUAL_NOTE,
      proposal: proposalContext(proposal),
      destination: proposal.destination,
      comparison: {
        ...comparison,
        costCodeDescription:
          overlay.costCodeLabel ||
          cvrRow?.costCodeLabel ||
          proposal.destination?.label ||
          destinationKey,
      },
      headline: buildHeadline(comparison),
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
