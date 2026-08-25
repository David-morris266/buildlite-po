/**
 * BL-034C / BL-034D — Selling Costs → CVR review compare (pure, no writes).
 * HD-002: target-final / replacement-adjustment.
 * BL-034D persists display_metadata.sellingCostsAdoption via the apply service.
 */

const { roundMoney } = require("./cvrCloseFormulas");

const SELLING_COSTS_ADOPTION_METADATA_KEY = "sellingCostsAdoption";

const SELLING_COSTS_REVIEW_STATES = {
  NOT_ADOPTED: "not_adopted",
  UP_TO_DATE: "up_to_date",
  DRIFTED: "drifted",
  SUPERSEDED: "superseded",
  BLOCKED: "blocked",
};

const SELLING_COSTS_REVIEW_FLAG_KEYS = {
  PROPOSAL_BELOW_SYSTEM: "proposalBelowSystem",
  NO_CVR_MEMBER: "noCvrMember",
  COINCIDENTAL_MATCH: "coincidentalMatch",
};

const SELLING_COSTS_REVIEW_BLOCK_CODES = {
  DESTINATION_MISSING: "destination_missing",
  DESTINATION_INACTIVE: "destination_inactive",
  DESTINATION_FORBIDDEN: "destination_forbidden",
  DESTINATION_NOT_SELLING: "destination_not_selling",
  DESTINATION_UNCONFIGURED: "destination_unconfigured",
  DESTINATION_NOT_ON_CVR: "destination_not_on_cvr",
  REVENUE_UNAVAILABLE: "revenue_unavailable",
  DETAILED_NOT_AVAILABLE: "detailed_not_available",
  NO_OPEN_CVR: "no_open_cvr",
  CVR_NOT_READY: "cvr_not_ready",
};

const MONEY_TOLERANCE = 0.005;

function moneyClose(a, b) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs((roundMoney(a) ?? 0) - (roundMoney(b) ?? 0)) <= MONEY_TOLERANCE;
}

function costCodeKeyIdentity(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeReportingMonth(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return raw;
}

function fnv1aHex(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildProposalFingerprint({
  developmentId = "",
  periodKey = "",
  reportingMonth = null,
  mode = "simple",
  assumptionPercent = null,
  forecastRevenue = null,
  forecastSellingCosts = null,
  destinationCostCodeKey = "",
} = {}) {
  const payload = {
    developmentId: String(developmentId || ""),
    periodKey: String(periodKey || ""),
    reportingMonth: normalizeReportingMonth(reportingMonth),
    mode: String(mode || "simple"),
    assumptionPercent: roundMoney(assumptionPercent),
    forecastRevenue: roundMoney(forecastRevenue),
    forecastSellingCosts: roundMoney(forecastSellingCosts),
    destinationCostCodeKey: String(destinationCostCodeKey || "").trim(),
  };
  return `bl034c-${fnv1aHex(JSON.stringify(payload))}`;
}

function normalizeSellingCostsAdoptionMetadata(raw) {
  if (!raw || typeof raw !== "object") return null;
  const adoptedTargetFinal = roundMoney(raw.adoptedTargetFinal);
  if (adoptedTargetFinal == null) return null;

  const forecastRevenueAtAdoption = roundMoney(
    raw.forecastRevenueAtAdoption ?? raw.forecastRevenueUsed
  );
  const inputVersionAtAdoption = Number.isInteger(Number(raw.inputVersionAtAdoption))
    ? Number(raw.inputVersionAtAdoption)
    : Number.isInteger(Number(raw.inputVersion))
      ? Number(raw.inputVersion)
      : null;

  return {
    mode: String(raw.mode || "simple"),
    adoptedTargetFinal,
    adoptedAdjustment: roundMoney(raw.adoptedAdjustment) ?? 0,
    systemForecastAtAdoption: roundMoney(raw.systemForecastAtAdoption),
    previousFinalForecast: roundMoney(raw.previousFinalForecast),
    previousAdjustment: roundMoney(raw.previousAdjustment) ?? 0,
    proposalFingerprint: String(raw.proposalFingerprint || ""),
    assumptionPercent: roundMoney(raw.assumptionPercent),
    forecastRevenueAtAdoption,
    forecastRevenueUsed: forecastRevenueAtAdoption,
    destinationCostCodeKey: String(raw.destinationCostCodeKey || "").trim(),
    settingsVersion: Number.isInteger(Number(raw.settingsVersion))
      ? Number(raw.settingsVersion)
      : null,
    reportingMonth: normalizeReportingMonth(raw.reportingMonth),
    periodKey: String(raw.periodKey || ""),
    adoptedAt: raw.adoptedAt || null,
    adoptedBy: raw.adoptedBy || null,
    superseded: Boolean(raw.superseded),
    inputId: raw.inputId ? String(raw.inputId) : null,
    inputVersionAtAdoption,
    inputVersion: inputVersionAtAdoption,
  };
}

function buildSellingCostsAdoptionMetadata({
  mode = "simple",
  adoptedTargetFinal,
  adoptedAdjustment,
  systemForecastAtAdoption,
  previousFinalForecast,
  previousAdjustment,
  proposalFingerprint,
  assumptionPercent,
  forecastRevenueAtAdoption,
  forecastRevenueUsed,
  destinationCostCodeKey,
  settingsVersion,
  reportingMonth,
  periodKey,
  adoptedAt,
  adoptedBy,
  inputId,
  inputVersionAtAdoption,
  inputVersion,
} = {}) {
  const revenue = roundMoney(forecastRevenueAtAdoption ?? forecastRevenueUsed);
  const versionAtAdoption = Number.isInteger(Number(inputVersionAtAdoption))
    ? Number(inputVersionAtAdoption)
    : Number.isInteger(Number(inputVersion))
      ? Number(inputVersion)
      : null;
  return {
    mode: String(mode || "simple"),
    assumptionPercent: roundMoney(assumptionPercent),
    forecastRevenueAtAdoption: revenue,
    adoptedTargetFinal: roundMoney(adoptedTargetFinal),
    adoptedAdjustment: roundMoney(adoptedAdjustment) ?? 0,
    systemForecastAtAdoption: roundMoney(systemForecastAtAdoption),
    previousAdjustment: roundMoney(previousAdjustment) ?? 0,
    previousFinalForecast: roundMoney(previousFinalForecast),
    proposalFingerprint: String(proposalFingerprint || ""),
    destinationCostCodeKey: String(destinationCostCodeKey || "").trim(),
    settingsVersion: Number.isInteger(Number(settingsVersion)) ? Number(settingsVersion) : null,
    reportingMonth: normalizeReportingMonth(reportingMonth),
    periodKey: String(periodKey || ""),
    adoptedAt: adoptedAt || null,
    adoptedBy: adoptedBy || null,
    inputId: inputId ? String(inputId) : null,
    inputVersionAtAdoption: versionAtAdoption,
    superseded: false,
  };
}

function extractSellingCostsAdoptionMetadata(displayMetadata) {
  if (!displayMetadata || typeof displayMetadata !== "object") return null;
  return normalizeSellingCostsAdoptionMetadata(
    displayMetadata[SELLING_COSTS_ADOPTION_METADATA_KEY]
  );
}

function calculateReplacementAdjustment(proposalAmount, systemForecast) {
  const proposal = roundMoney(proposalAmount);
  const system = roundMoney(systemForecast);
  if (proposal == null || system == null) return null;
  return roundMoney(proposal - system);
}

function calculateProposedFinalForecast(systemForecast, proposedReplacementAdjustment) {
  const system = roundMoney(systemForecast);
  const adjustment = roundMoney(proposedReplacementAdjustment);
  if (system == null || adjustment == null) return null;
  return roundMoney(system + adjustment);
}

function calculateResultingMovement(proposedFinalForecast, currentFinalForecast) {
  const proposed = roundMoney(proposedFinalForecast);
  const current = roundMoney(currentFinalForecast);
  if (proposed == null || current == null) return null;
  return roundMoney(proposed - current);
}

function resolveSellingCostsReviewState({
  metadata = null,
  currentFingerprint = "",
  currentFinalForecast = null,
  currentAdjustment = null,
  currentProposal = null,
} = {}) {
  const normalized = normalizeSellingCostsAdoptionMetadata(metadata);
  if (!normalized) {
    return {
      primary: SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED,
      isUpToDate: false,
      coincidentalMatch: moneyClose(currentFinalForecast, currentProposal),
    };
  }

  const adjustmentMatches = moneyClose(currentAdjustment, normalized.adoptedAdjustment);
  if (normalized.superseded || !adjustmentMatches) {
    return {
      primary: SELLING_COSTS_REVIEW_STATES.SUPERSEDED,
      isUpToDate: false,
      coincidentalMatch: false,
    };
  }

  const fingerprintMatches =
    Boolean(normalized.proposalFingerprint) &&
    Boolean(currentFingerprint) &&
    normalized.proposalFingerprint === currentFingerprint;
  const finalMatchesProposal = moneyClose(currentFinalForecast, currentProposal);
  const finalMatchesAdopted = moneyClose(currentFinalForecast, normalized.adoptedTargetFinal);

  if (fingerprintMatches && finalMatchesProposal && finalMatchesAdopted) {
    return {
      primary: SELLING_COSTS_REVIEW_STATES.UP_TO_DATE,
      isUpToDate: true,
      coincidentalMatch: false,
    };
  }

  return {
    primary: SELLING_COSTS_REVIEW_STATES.DRIFTED,
    isUpToDate: false,
    coincidentalMatch: false,
  };
}

function compareSellingCostsToCvr({
  developmentId = "",
  periodKey = "",
  reportingMonth = null,
  mode = "simple",
  assumptionPercent = null,
  forecastRevenue = null,
  forecastSellingCosts = null,
  destinationCostCodeKey = "",
  cvrRow = null,
  overlay = null,
  existingMetadata = null,
} = {}) {
  const proposalAmount = roundMoney(forecastSellingCosts);
  const systemForecast = cvrRow
    ? roundMoney(cvrRow.systemForecast) ?? 0
    : overlay
      ? 0
      : null;
  const currentAdjustment = cvrRow
    ? roundMoney(cvrRow.commercialAdjustment) ?? 0
    : overlay
      ? roundMoney(overlay.commercialAdjustment) ?? 0
      : null;
  const currentFinalForecast =
    cvrRow != null
      ? roundMoney(cvrRow.finalForecast ?? cvrRow.forecastFinalCost)
      : overlay != null && systemForecast != null && currentAdjustment != null
        ? roundMoney((systemForecast || 0) + (currentAdjustment || 0))
        : null;
  const currentAccrual = cvrRow
    ? roundMoney(cvrRow.manualAccrual) ?? 0
    : overlay
      ? roundMoney(overlay.manualAccrual) ?? 0
      : null;

  const proposedReplacementAdjustment = calculateReplacementAdjustment(
    proposalAmount,
    systemForecast
  );
  const proposedFinalForecast = calculateProposedFinalForecast(
    systemForecast,
    proposedReplacementAdjustment
  );
  const resultingMovement = calculateResultingMovement(
    proposedFinalForecast,
    currentFinalForecast
  );

  const fingerprint = buildProposalFingerprint({
    developmentId,
    periodKey,
    reportingMonth,
    mode,
    assumptionPercent,
    forecastRevenue,
    forecastSellingCosts: proposalAmount,
    destinationCostCodeKey,
  });

  const metadata =
    existingMetadata != null
      ? normalizeSellingCostsAdoptionMetadata(existingMetadata)
      : overlay
        ? extractSellingCostsAdoptionMetadata(overlay.displayMetadata || overlay.display_metadata)
        : cvrRow
          ? extractSellingCostsAdoptionMetadata(cvrRow.displayMetadata || cvrRow.display_metadata)
          : null;

  const drift = resolveSellingCostsReviewState({
    metadata,
    currentFingerprint: fingerprint,
    currentFinalForecast,
    currentAdjustment,
    currentProposal: proposalAmount,
  });

  const proposalBelowSystem =
    proposalAmount != null &&
    systemForecast != null &&
    proposalAmount + MONEY_TOLERANCE < systemForecast;

  return {
    costCodeKey: String(destinationCostCodeKey || "").trim(),
    sellingCostsProposal: proposalAmount,
    systemForecast,
    currentAdjustment,
    currentFinalForecast,
    proposedReplacementAdjustment,
    proposedFinalForecast,
    resultingMovement,
    currentAccrual,
    proposalFingerprint: fingerprint,
    reviewState: drift.primary,
    isUpToDate: drift.isUpToDate,
    coincidentalMatch: Boolean(drift.coincidentalMatch),
    flags: {
      [SELLING_COSTS_REVIEW_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM]: proposalBelowSystem,
      [SELLING_COSTS_REVIEW_FLAG_KEYS.NO_CVR_MEMBER]: !overlay,
      [SELLING_COSTS_REVIEW_FLAG_KEYS.COINCIDENTAL_MATCH]: Boolean(drift.coincidentalMatch),
    },
    adoptionMetadata: metadata,
    inputId: overlay?.id || null,
    inputVersion: overlay?.version ?? null,
  };
}

module.exports = {
  SELLING_COSTS_ADOPTION_METADATA_KEY,
  SELLING_COSTS_REVIEW_STATES,
  SELLING_COSTS_REVIEW_FLAG_KEYS,
  SELLING_COSTS_REVIEW_BLOCK_CODES,
  roundMoney,
  moneyClose,
  costCodeKeyIdentity,
  normalizeReportingMonth,
  buildProposalFingerprint,
  normalizeSellingCostsAdoptionMetadata,
  buildSellingCostsAdoptionMetadata,
  extractSellingCostsAdoptionMetadata,
  calculateReplacementAdjustment,
  calculateProposedFinalForecast,
  calculateResultingMovement,
  resolveSellingCostsReviewState,
  compareSellingCostsToCvr,
};
