/**
 * BL-034C — Pure Selling Costs CVR review compare (no DB).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SELLING_COSTS_ADOPTION_METADATA_KEY,
  SELLING_COSTS_REVIEW_STATES,
  calculateReplacementAdjustment,
  calculateProposedFinalForecast,
  calculateResultingMovement,
  compareSellingCostsToCvr,
  resolveSellingCostsReviewState,
  buildProposalFingerprint,
  buildSellingCostsAdoptionMetadata,
} = require("../services/sellingCostsAdoptionCompare");

const PROPOSAL = 182780.64;
const REVENUE = 10444608;

test("BL-034C target-final replacement-adjustment maths", () => {
  assert.equal(calculateReplacementAdjustment(PROPOSAL, 0), PROPOSAL);
  assert.equal(calculateProposedFinalForecast(0, PROPOSAL), PROPOSAL);
  assert.equal(calculateResultingMovement(PROPOSAL, 0), PROPOSAL);

  const withSystem = calculateReplacementAdjustment(PROPOSAL, 200000);
  assert.equal(withSystem, -17219.36);
  assert.equal(calculateProposedFinalForecast(200000, withSystem), PROPOSAL);
  assert.equal(calculateResultingMovement(PROPOSAL, 200000), -17219.36);
});

test("BL-034C current adjustment is replaced, not added", () => {
  const comparison = compareSellingCostsToCvr({
    developmentId: "dev-1",
    periodKey: "P04",
    reportingMonth: "2026-08",
    assumptionPercent: 1.75,
    forecastRevenue: REVENUE,
    forecastSellingCosts: PROPOSAL,
    destinationCostCodeKey: "5400",
    cvrRow: {
      systemForecast: 0,
      commercialAdjustment: 5000,
      finalForecast: 5000,
      manualAccrual: 0,
    },
    overlay: { id: "input-1", version: 1, commercialAdjustment: 5000, displayMetadata: {} },
  });

  assert.equal(comparison.proposedReplacementAdjustment, PROPOSAL);
  assert.equal(comparison.proposedFinalForecast, PROPOSAL);
  assert.equal(comparison.resultingMovement, 177780.64);
  assert.equal(comparison.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
});

test("BL-034C negative replacement when proposal is below system forecast", () => {
  const comparison = compareSellingCostsToCvr({
    developmentId: "dev-1",
    periodKey: "P04",
    reportingMonth: "2026-08",
    assumptionPercent: 1.75,
    forecastRevenue: REVENUE,
    forecastSellingCosts: PROPOSAL,
    destinationCostCodeKey: "5400",
    cvrRow: {
      systemForecast: 200000,
      commercialAdjustment: 0,
      finalForecast: 200000,
      manualAccrual: 0,
    },
    overlay: { id: "input-1", version: 1, commercialAdjustment: 0, displayMetadata: {} },
  });

  assert.equal(comparison.proposedReplacementAdjustment, -17219.36);
  assert.equal(comparison.flags.proposalBelowSystem, true);
  assert.equal(comparison.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
});

test("BL-034C coincidental numeric equality without provenance is NOT ADOPTED", () => {
  const comparison = compareSellingCostsToCvr({
    developmentId: "dev-1",
    periodKey: "P04",
    reportingMonth: "2026-08",
    assumptionPercent: 1.75,
    forecastRevenue: REVENUE,
    forecastSellingCosts: PROPOSAL,
    destinationCostCodeKey: "5400",
    cvrRow: {
      systemForecast: 0,
      commercialAdjustment: PROPOSAL,
      finalForecast: PROPOSAL,
      manualAccrual: 0,
    },
    overlay: { id: "input-1", version: 1, commercialAdjustment: PROPOSAL, displayMetadata: {} },
  });

  assert.equal(comparison.reviewState, SELLING_COSTS_REVIEW_STATES.NOT_ADOPTED);
  assert.equal(comparison.isUpToDate, false);
  assert.equal(comparison.coincidentalMatch, true);
  assert.equal(comparison.resultingMovement, 0);
});

test("BL-034C provenance-aware UP TO DATE / DRIFTED / SUPERSEDED", () => {
  const fingerprint = buildProposalFingerprint({
    developmentId: "dev-1",
    periodKey: "P04",
    reportingMonth: "2026-08",
    mode: "simple",
    assumptionPercent: 1.75,
    forecastRevenue: REVENUE,
    forecastSellingCosts: PROPOSAL,
    destinationCostCodeKey: "5400",
  });
  const metadata = buildSellingCostsAdoptionMetadata({
    adoptedTargetFinal: PROPOSAL,
    adoptedAdjustment: PROPOSAL,
    systemForecastAtAdoption: 0,
    previousFinalForecast: 0,
    previousAdjustment: 0,
    proposalFingerprint: fingerprint,
    assumptionPercent: 1.75,
    forecastRevenueUsed: REVENUE,
    destinationCostCodeKey: "5400",
    settingsVersion: 1,
    reportingMonth: "2026-08",
    periodKey: "P04",
    inputId: "input-1",
    inputVersion: 1,
  });

  const upToDate = resolveSellingCostsReviewState({
    metadata,
    currentFingerprint: fingerprint,
    currentFinalForecast: PROPOSAL,
    currentAdjustment: PROPOSAL,
    currentProposal: PROPOSAL,
  });
  assert.equal(upToDate.primary, SELLING_COSTS_REVIEW_STATES.UP_TO_DATE);

  const drifted = resolveSellingCostsReviewState({
    metadata,
    currentFingerprint: `${fingerprint}-changed`,
    currentFinalForecast: PROPOSAL,
    currentAdjustment: PROPOSAL,
    currentProposal: 208892.16,
  });
  assert.equal(drifted.primary, SELLING_COSTS_REVIEW_STATES.DRIFTED);

  const systemDrift = resolveSellingCostsReviewState({
    metadata,
    currentFingerprint: fingerprint,
    currentFinalForecast: 190000,
    currentAdjustment: PROPOSAL,
    currentProposal: PROPOSAL,
  });
  assert.equal(systemDrift.primary, SELLING_COSTS_REVIEW_STATES.DRIFTED);

  const superseded = resolveSellingCostsReviewState({
    metadata,
    currentFingerprint: fingerprint,
    currentFinalForecast: 50000,
    currentAdjustment: 50000,
    currentProposal: PROPOSAL,
  });
  assert.equal(superseded.primary, SELLING_COSTS_REVIEW_STATES.SUPERSEDED);

  const flagged = resolveSellingCostsReviewState({
    metadata: { ...metadata, superseded: true },
    currentFingerprint: fingerprint,
    currentFinalForecast: PROPOSAL,
    currentAdjustment: PROPOSAL,
    currentProposal: PROPOSAL,
  });
  assert.equal(flagged.primary, SELLING_COSTS_REVIEW_STATES.SUPERSEDED);

  assert.equal(SELLING_COSTS_ADOPTION_METADATA_KEY, "sellingCostsAdoption");
});
