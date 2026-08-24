/**
 * BL-033D.x.4A — Prelims → CVR adoption compare engine (pure, no CVR writes).
 */

const { calculatePrelimsLine, roundMoney: roundMoneyEngine } = require("./prelimsForecastEngine");
const {
  PRELIMS_CALC_STATES,
  PRELIMS_STATUSES,
} = require("./prelimsConstants");

const PRELIMS_ADOPTION_METADATA_KEY = "prelimsAdoption";

const PRELIMS_ADOPTION_DRIFT_STATES = {
  NOT_ADOPTED: "not_adopted",
  UP_TO_DATE: "up_to_date",
  PROPOSAL_CHANGED: "proposal_changed",
  CVR_DRIFT: "cvr_drift",
  ADOPTION_SUPERSEDED: "adoption_superseded",
};

const PRELIMS_ADOPTION_FLAG_KEYS = {
  UNRESOLVED_EXPOSURE: "unresolvedExposure",
  PROPOSAL_BELOW_SYSTEM: "proposalBelowSystem",
  NO_CVR_ROW: "noCvrRow",
  NON_PRELIMS_CLASSIFICATION: "nonPrelimsClassification",
  CANNOT_ADOPT: "cannotAdopt",
};

const DEFAULT_SEMANTIC_GROUP = "UNCLASSIFIED";
const PRELIMS_SEMANTIC_GROUP = "PRELIMS";
const MONEY_TOLERANCE = 0.005;

function roundMoney(value) {
  return roundMoneyEngine(value);
}

function moneyClose(a, b) {
  return Math.abs((roundMoney(a) ?? 0) - (roundMoney(b) ?? 0)) <= MONEY_TOLERANCE;
}

function isActive(status) {
  return String(status || PRELIMS_STATUSES.ACTIVE) === PRELIMS_STATUSES.ACTIVE;
}

function isUnresolvedCalculation(calc = {}) {
  return (
    calc.state === PRELIMS_CALC_STATES.UNRESOLVED ||
    calc.state === PRELIMS_CALC_STATES.INVALID
  );
}

function normalizeReportingMonth(value) {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return raw;
}

function fingerprintLineEntry(line = {}) {
  const calc = line.calculation || {};
  return {
    lineId: String(line.id || ""),
    version: Number(line.version) || 0,
    status: String(line.status || PRELIMS_STATUSES.ACTIVE),
    forecastDriver: String(line.forecastDriver || ""),
    monthlyRate: roundMoney(line.monthlyRate),
    lumpSumAmount: roundMoney(line.lumpSumAmount),
    startBasis: line.startBasis || null,
    endBasis: line.endBasis || null,
    startFixedDate: line.startFixedDate || null,
    endFixedDate: line.endFixedDate || null,
    startOffsetMonths: Number.isInteger(Number(line.startOffsetMonths))
      ? Number(line.startOffsetMonths)
      : 0,
    endOffsetMonths: Number.isInteger(Number(line.endOffsetMonths))
      ? Number(line.endOffsetMonths)
      : 0,
    totalForecast: roundMoney(calc.totalForecast),
    includedInActiveProposal: Boolean(calc.includedInActiveProposal),
    calcState: calc.state || null,
  };
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
  lines = [],
} = {}) {
  const payload = {
    developmentId: String(developmentId || ""),
    periodKey: String(periodKey || ""),
    reportingMonth: normalizeReportingMonth(reportingMonth),
    lines: [...lines]
      .map(fingerprintLineEntry)
      .sort((a, b) => a.lineId.localeCompare(b.lineId)),
  };
  const canonical = JSON.stringify(payload);
  return `bl033dx4a-${fnv1aHex(canonical)}`;
}

function normalizePrelimsAdoptionMetadata(raw) {
  if (!raw || typeof raw !== "object") return null;
  const adoptedTargetFinal = roundMoney(raw.adoptedTargetFinal);
  if (adoptedTargetFinal == null) return null;

  return {
    adoptedTargetFinal,
    adoptedAdjustment: roundMoney(raw.adoptedAdjustment) ?? 0,
    systemForecastAtAdoption: roundMoney(raw.systemForecastAtAdoption),
    previousFinalForecast: roundMoney(raw.previousFinalForecast),
    previousAdjustment: roundMoney(raw.previousAdjustment) ?? 0,
    proposalFingerprint: String(raw.proposalFingerprint || ""),
    sourceLineIds: Array.isArray(raw.sourceLineIds)
      ? raw.sourceLineIds.map((id) => String(id))
      : [],
    excludedUnresolvedLineIds: Array.isArray(raw.excludedUnresolvedLineIds)
      ? raw.excludedUnresolvedLineIds.map((id) => String(id))
      : [],
    reportingMonth: normalizeReportingMonth(raw.reportingMonth),
    periodKey: String(raw.periodKey || ""),
    adoptedAt: raw.adoptedAt || null,
    adoptedBy: raw.adoptedBy || null,
    superseded: Boolean(raw.superseded),
  };
}

function buildPrelimsAdoptionMetadata({
  adoptedTargetFinal,
  adoptedAdjustment,
  systemForecastAtAdoption,
  previousFinalForecast,
  previousAdjustment,
  proposalFingerprint,
  sourceLineIds = [],
  excludedUnresolvedLineIds = [],
  reportingMonth,
  periodKey,
  adoptedAt,
  adoptedBy,
} = {}) {
  return {
    adoptedTargetFinal: roundMoney(adoptedTargetFinal),
    adoptedAdjustment: roundMoney(adoptedAdjustment) ?? 0,
    systemForecastAtAdoption: roundMoney(systemForecastAtAdoption),
    previousFinalForecast: roundMoney(previousFinalForecast),
    previousAdjustment: roundMoney(previousAdjustment) ?? 0,
    proposalFingerprint: String(proposalFingerprint || ""),
    sourceLineIds: [...sourceLineIds].map((id) => String(id)),
    excludedUnresolvedLineIds: [...excludedUnresolvedLineIds].map((id) => String(id)),
    reportingMonth: normalizeReportingMonth(reportingMonth),
    periodKey: String(periodKey || ""),
    adoptedAt: adoptedAt || null,
    adoptedBy: adoptedBy || null,
    superseded: false,
  };
}

function extractPrelimsAdoptionMetadata(displayMetadata) {
  if (!displayMetadata || typeof displayMetadata !== "object") return null;
  return normalizePrelimsAdoptionMetadata(displayMetadata[PRELIMS_ADOPTION_METADATA_KEY]);
}

function enrichPrelimsItemsForAdoption(items = [], context = {}) {
  return items.map((item) => ({
    ...item,
    calculation: calculatePrelimsLine(item, context),
  }));
}

function aggregateAdoptionCandidatesByCostCode(enrichedLines = []) {
  const buckets = new Map();

  for (const line of enrichedLines) {
    const key = String(line.costCodeKey || "").trim() || "(blank)";
    if (!buckets.has(key)) {
      buckets.set(key, {
        costCodeKey: key,
        lineCount: 0,
        resolvedPrelimsTotal: null,
        hasResolvedAmount: false,
        unresolvedCount: 0,
        unresolvedLineIds: [],
        sourceLineIds: [],
        excludedUnresolvedLineIds: [],
      });
    }

    const bucket = buckets.get(key);
    bucket.lineCount += 1;
    const calc = line.calculation || {};

    if (isUnresolvedCalculation(calc) && isActive(line.status)) {
      bucket.unresolvedCount += 1;
      if (line.id) {
        bucket.unresolvedLineIds.push(String(line.id));
        bucket.excludedUnresolvedLineIds.push(String(line.id));
      }
    }

    if (calc.includedInActiveProposal) {
      bucket.hasResolvedAmount = true;
      bucket.resolvedPrelimsTotal = roundMoney(
        (bucket.resolvedPrelimsTotal || 0) + (calc.totalForecast || 0)
      );
      if (line.id) bucket.sourceLineIds.push(String(line.id));
    }
  }

  return [...buckets.values()].map((bucket) => {
    if (!bucket.hasResolvedAmount) {
      bucket.resolvedPrelimsTotal = bucket.unresolvedCount > 0 ? null : 0;
    }
    return bucket;
  });
}

function resolveAdoptionDriftState({
  metadata = null,
  currentFingerprint = "",
  currentFinalForecast = null,
  currentAdjustment = null,
  systemForecast = null,
} = {}) {
  const normalized = normalizePrelimsAdoptionMetadata(metadata);
  if (!normalized) {
    return {
      primary: PRELIMS_ADOPTION_DRIFT_STATES.NOT_ADOPTED,
      flags: [],
      isUpToDate: false,
    };
  }

  const flags = [];

  if (normalized.superseded || !moneyClose(currentAdjustment, normalized.adoptedAdjustment)) {
    flags.push(PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED);
  }

  if (
    normalized.proposalFingerprint &&
    currentFingerprint &&
    normalized.proposalFingerprint !== currentFingerprint
  ) {
    flags.push(PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED);
  }

  const finalMatchesAdopted = moneyClose(currentFinalForecast, normalized.adoptedTargetFinal);
  const adjustmentMatchesAdopted = moneyClose(currentAdjustment, normalized.adoptedAdjustment);
  const fingerprintMatches = normalized.proposalFingerprint === currentFingerprint;

  if (
    adjustmentMatchesAdopted &&
    !finalMatchesAdopted &&
    fingerprintMatches &&
    !flags.includes(PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED)
  ) {
    flags.push(PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT);
  }

  const isUpToDate =
    fingerprintMatches &&
    finalMatchesAdopted &&
    adjustmentMatchesAdopted &&
    flags.length === 0;

  if (isUpToDate) {
    return {
      primary: PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE,
      flags: [],
      isUpToDate: true,
    };
  }

  let primary = PRELIMS_ADOPTION_DRIFT_STATES.NOT_ADOPTED;
  if (flags.includes(PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED)) {
    primary = PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED;
  } else if (flags.includes(PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED)) {
    primary = PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED;
  } else if (flags.includes(PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT)) {
    primary = PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT;
  } else if (!finalMatchesAdopted || !fingerprintMatches) {
    primary = PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED;
  }

  return {
    primary,
    flags,
    isUpToDate: false,
    systemForecastMoved: !moneyClose(systemForecast, normalized.systemForecastAtAdoption),
  };
}

function readCvrNumbers(cvrRow = null) {
  if (!cvrRow) {
    return {
      systemForecast: null,
      currentAdjustment: null,
      currentFinalForecast: null,
      manualAccrual: null,
    };
  }

  return {
    systemForecast: roundMoney(cvrRow.systemForecast),
    currentAdjustment: roundMoney(cvrRow.commercialAdjustment) ?? 0,
    currentFinalForecast: roundMoney(cvrRow.finalForecast ?? cvrRow.forecastFinalCost),
    manualAccrual: roundMoney(cvrRow.manualAccrual) ?? 0,
  };
}

function comparePrelimsAdoptionCandidate({
  costCodeKey,
  prelimsBucket = null,
  cvrRow = null,
  classification = null,
  periodKey = "",
  reportingMonth = null,
  developmentId = "",
  enrichedLines = [],
  existingMetadata = null,
} = {}) {
  const key = String(costCodeKey || prelimsBucket?.costCodeKey || "").trim();
  const linesForCode = enrichedLines.filter(
    (line) => String(line.costCodeKey || "").trim() === key
  );
  const fingerprint = buildProposalFingerprint({
    developmentId,
    periodKey,
    reportingMonth,
    lines: linesForCode,
  });

  const {
    systemForecast,
    currentAdjustment,
    currentFinalForecast,
    manualAccrual,
  } = readCvrNumbers(cvrRow);

  const resolvedPrelimsTotal =
    prelimsBucket?.resolvedPrelimsTotal != null
      ? roundMoney(prelimsBucket.resolvedPrelimsTotal)
      : null;
  const adoptedTargetFinal = resolvedPrelimsTotal;

  const proposedAdjustment =
    adoptedTargetFinal != null && systemForecast != null
      ? roundMoney(adoptedTargetFinal - systemForecast)
      : null;
  const proposedFinalForecast = adoptedTargetFinal;
  const deltaFinal =
    proposedFinalForecast != null && currentFinalForecast != null
      ? roundMoney(proposedFinalForecast - currentFinalForecast)
      : null;

  const semanticGroup = String(classification?.semanticGroup || DEFAULT_SEMANTIC_GROUP)
    .trim()
    .toUpperCase();
  const nonPrelimsClassification =
    semanticGroup !== PRELIMS_SEMANTIC_GROUP && semanticGroup !== DEFAULT_SEMANTIC_GROUP;

  const noCvrRow = !cvrRow;
  const proposalBelowSystem =
    resolvedPrelimsTotal != null &&
    systemForecast != null &&
    resolvedPrelimsTotal + MONEY_TOLERANCE < systemForecast;

  const cannotAdopt = noCvrRow || resolvedPrelimsTotal == null;

  const metadata =
    existingMetadata != null
      ? normalizePrelimsAdoptionMetadata(existingMetadata)
      : null;

  const drift = resolveAdoptionDriftState({
    metadata,
    currentFingerprint: fingerprint,
    currentFinalForecast,
    currentAdjustment,
    systemForecast,
  });

  const flags = {
    [PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE]: (prelimsBucket?.unresolvedCount || 0) > 0,
    [PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM]: proposalBelowSystem,
    [PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]: noCvrRow,
    [PRELIMS_ADOPTION_FLAG_KEYS.NON_PRELIMS_CLASSIFICATION]: nonPrelimsClassification,
    [PRELIMS_ADOPTION_FLAG_KEYS.CANNOT_ADOPT]: cannotAdopt,
  };

  return {
    costCodeKey: key,
    lineCount: prelimsBucket?.lineCount || linesForCode.length,
    resolvedPrelimsTotal,
    unresolvedCount: prelimsBucket?.unresolvedCount || 0,
    unresolvedLineIds: [...(prelimsBucket?.unresolvedLineIds || [])],
    sourceLineIds: [...(prelimsBucket?.sourceLineIds || [])],
    excludedUnresolvedLineIds: [...(prelimsBucket?.excludedUnresolvedLineIds || [])],
    systemForecast,
    currentAdjustment,
    currentFinalForecast,
    manualAccrual,
    adoptedTargetFinal,
    proposedAdjustment,
    proposedFinalForecast,
    deltaFinal,
    proposalFingerprint: fingerprint,
    flags,
    driftState: drift.primary,
    driftFlags: drift.flags,
    isUpToDate: drift.isUpToDate,
    adoptionMetadata: metadata,
    cannotAdopt,
    semanticGroup,
  };
}

function buildPrelimsAdoptionPreview({
  developmentId = "",
  periodKey = "",
  reportingMonth = null,
  prelimsItems = [],
  programme = null,
  cvrRows = [],
  classifications = [],
  displayMetadataByCostCode = {},
} = {}) {
  const context = { programme, reportingMonth };
  const enrichedLines = enrichPrelimsItemsForAdoption(prelimsItems, context);
  const buckets = aggregateAdoptionCandidatesByCostCode(enrichedLines);
  const bucketByKey = new Map(buckets.map((bucket) => [bucket.costCodeKey, bucket]));
  const cvrByKey = new Map(
    cvrRows.map((row) => [String(row.costCodeKey || row.cost_code_key || "").trim(), row])
  );
  const classificationByKey = new Map(
    classifications.map((row) => [
      String(row.costCodeKey || row.cost_code_key || "").trim(),
      row,
    ])
  );

  const allKeys = new Set([...bucketByKey.keys(), ...cvrByKey.keys()]);

  const candidates = [...allKeys]
    .filter((key) => key && key !== "(blank)")
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((key) => {
      const displayMetadata = displayMetadataByCostCode[key] || null;
      const existingMetadata = displayMetadata
        ? extractPrelimsAdoptionMetadata(displayMetadata)
        : null;

      return comparePrelimsAdoptionCandidate({
        costCodeKey: key,
        prelimsBucket: bucketByKey.get(key) || null,
        cvrRow: cvrByKey.get(key) || null,
        classification: classificationByKey.get(key) || null,
        periodKey,
        reportingMonth,
        developmentId,
        enrichedLines,
        existingMetadata,
      });
    });

  const prelimsOnly = candidates.filter((row) => row.resolvedPrelimsTotal != null);
  const adoptable = candidates.filter((row) => !row.cannotAdopt);

  return {
    developmentId,
    periodKey,
    reportingMonth: normalizeReportingMonth(reportingMonth),
    candidates,
    summary: {
      costCodeCount: candidates.length,
      prelimsCostCodeCount: prelimsOnly.length,
      adoptableCostCodeCount: adoptable.length,
      unresolvedCostCodeCount: candidates.filter(
        (row) => row.flags[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE]
      ).length,
      notOnCvrCount: candidates.filter((row) => row.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW])
        .length,
    },
  };
}

module.exports = {
  PRELIMS_ADOPTION_METADATA_KEY,
  PRELIMS_ADOPTION_DRIFT_STATES,
  PRELIMS_ADOPTION_FLAG_KEYS,
  roundMoney,
  buildProposalFingerprint,
  normalizePrelimsAdoptionMetadata,
  buildPrelimsAdoptionMetadata,
  extractPrelimsAdoptionMetadata,
  enrichPrelimsItemsForAdoption,
  aggregateAdoptionCandidatesByCostCode,
  resolveAdoptionDriftState,
  comparePrelimsAdoptionCandidate,
  buildPrelimsAdoptionPreview,
};
