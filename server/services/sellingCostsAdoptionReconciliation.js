const {
  costCodeKeyIdentity,
  extractSellingCostsAdoptionMetadata,
  moneyClose,
  roundMoney,
} = require("./sellingCostsAdoptionCompare");

function inputKey(input) {
  return String(input?.costCodeKey || input?.cost_code_key || "").trim();
}

function inputReason(input) {
  return String(input?.adjustmentReason ?? input?.commercialReason ?? "").trim();
}

function historyOf(input) {
  const metadata = input?.displayMetadata || input?.display_metadata || {};
  return Array.isArray(metadata.adjustmentHistory) ? metadata.adjustmentHistory : [];
}

function historyReason(entry) {
  return String(entry?.newReason ?? entry?.reason ?? "").trim();
}

function classifySellingCostsOwnership(input) {
  const displayMetadata = input?.displayMetadata || input?.display_metadata || {};
  const metadata = extractSellingCostsAdoptionMetadata(displayMetadata);
  if (!metadata) return { associated: false, owned: false, metadata: null };

  const history = historyOf(input);
  const latest = history.at(-1) || null;
  const currentAdjustment = roundMoney(input?.commercialAdjustment ?? input?.commercial_adjustment) ?? 0;
  const owned = Boolean(
    !metadata.superseded &&
      !metadata.released &&
      latest?.source === "selling_costs_adoption" &&
      moneyClose(latest.newAdjustment, currentAdjustment) &&
      moneyClose(metadata.adoptedAdjustment, currentAdjustment) &&
      historyReason(latest) === inputReason(input)
  );

  return {
    associated: true,
    owned,
    metadata,
    latestHistory: latest,
    originalBaselineAdjustment:
      roundMoney(metadata.originalBaselineAdjustment) ??
      roundMoney(metadata.previousAdjustment) ??
      0,
    originalBaselineReason: String(
      metadata.originalBaselineReason ?? latest?.previousReason ?? ""
    ),
  };
}

function buildSellingCostsReconciliation({ inputs = [], newDestinationKeys = [] } = {}) {
  const newKeys = new Set(newDestinationKeys.map(costCodeKeyIdentity).filter(Boolean));
  const rows = [];
  for (const input of inputs) {
    const costCodeKey = inputKey(input);
    const identity = costCodeKeyIdentity(costCodeKey);
    const ownership = classifySellingCostsOwnership(input);
    if (!ownership.associated || ownership.metadata?.released || newKeys.has(identity)) continue;
    rows.push({
      action: ownership.owned ? "released" : "preserved_manual",
      costCodeKey,
      costCodeDescription: input.costCodeLabel || input.description || costCodeKey,
      inputId: input.id,
      inputVersion: Number(input.version),
      currentAdjustment:
        roundMoney(input.commercialAdjustment ?? input.commercial_adjustment) ?? 0,
      currentReason: inputReason(input),
      baselineAdjustment: ownership.originalBaselineAdjustment,
      baselineReason: ownership.originalBaselineReason,
      ownership,
    });
  }
  return rows;
}

module.exports = {
  buildSellingCostsReconciliation,
  classifySellingCostsOwnership,
};
