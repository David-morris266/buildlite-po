/**
 * BL-033D.x.4A — Prelims adoption compare engine tests.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRELIMS_ADOPTION_DRIFT_STATES,
  PRELIMS_ADOPTION_FLAG_KEYS,
  PRELIMS_ADOPTION_METADATA_KEY,
  buildPrelimsAdoptionMetadata,
  buildPrelimsAdoptionPreview,
  buildProposalFingerprint,
  comparePrelimsAdoptionCandidate,
  enrichPrelimsItemsForAdoption,
  resolveAdoptionDriftState,
} = require("../services/prelimsAdoptionCompare");

const DEV_ID = "dev-1785599776666-zck5pl";
const PERIOD_KEY = "P04";
const REPORTING_MONTH = "2026-08";

const TEST_SITE_1_PROGRAMME = {
  siteStart: "2026-09-01",
  firstCompletion: null,
  finalCompletion: "2029-10-01",
};

const TEST_SITE_1_PRELIMS = [
  {
    id: "3e9402bf-3093-4228-be69-0d163e5b5bda",
    costCodeKey: "5231",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 20000,
    status: "active",
    version: 6,
  },
  {
    id: "da5b67be-8432-454e-b6a5-37e163078f1c",
    costCodeKey: "5231",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "SITE_START",
    endBasis: "FINAL_COMPLETION",
    status: "active",
    version: 1,
  },
  {
    id: "da6668b7-329c-4cab-a0aa-1233184d79cb",
    costCodeKey: "5231",
    forecastDriver: "TIME",
    monthlyRate: 1000,
    startBasis: "FIRST_COMPLETION",
    endBasis: "FINAL_COMPLETION",
    status: "active",
    version: 1,
  },
  {
    id: "c67ee4db-7f7f-4813-8cbf-d289781c2efa",
    costCodeKey: "UAT-CC-001",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 1000,
    status: "active",
    version: 1,
  },
];

function enriched5231Lines() {
  return enrichPrelimsItemsForAdoption(TEST_SITE_1_PRELIMS, {
    programme: TEST_SITE_1_PROGRAMME,
    reportingMonth: REPORTING_MONTH,
  }).filter((line) => line.costCodeKey === "5231");
}

test("Test Site 1 5231 adoption compare matches worked example", () => {
  const preview = buildPrelimsAdoptionPreview({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    prelimsItems: TEST_SITE_1_PRELIMS,
    programme: TEST_SITE_1_PROGRAMME,
    cvrRows: [
      {
        costCodeKey: "5231",
        systemForecast: 50280,
        commercialAdjustment: 520,
        finalForecast: 50800,
        manualAccrual: 120,
      },
    ],
    classifications: [{ costCodeKey: "5231", semanticGroup: "PRELIMS" }],
  });

  const row = preview.candidates.find((item) => item.costCodeKey === "5231");
  assert.equal(row.systemForecast, 50280);
  assert.equal(row.currentAdjustment, 520);
  assert.equal(row.currentFinalForecast, 50800);
  assert.equal(row.resolvedPrelimsTotal, 58000);
  assert.equal(row.unresolvedCount, 1);
  assert.equal(row.proposedAdjustment, 7720);
  assert.equal(row.proposedFinalForecast, 58000);
  assert.equal(row.deltaFinal, 7200);
  assert.equal(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE], true);
});

test("proposal below system forecast yields negative adjustment", () => {
  const row = comparePrelimsAdoptionCandidate({
    costCodeKey: "5231",
    prelimsBucket: {
      costCodeKey: "5231",
      resolvedPrelimsTotal: 58000,
      unresolvedCount: 0,
      unresolvedLineIds: [],
      sourceLineIds: ["a", "b"],
      excludedUnresolvedLineIds: [],
      lineCount: 2,
    },
    cvrRow: {
      costCodeKey: "5231",
      systemForecast: 70000,
      commercialAdjustment: 0,
      finalForecast: 70000,
    },
    enrichedLines: enriched5231Lines().slice(0, 2),
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
  });

  assert.equal(row.proposedAdjustment, -12000);
  assert.equal(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM], true);
});

test("UAT-CC-001 without CVR row cannot adopt", () => {
  const preview = buildPrelimsAdoptionPreview({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    prelimsItems: TEST_SITE_1_PRELIMS,
    programme: TEST_SITE_1_PROGRAMME,
    cvrRows: [],
    classifications: [],
  });

  const row = preview.candidates.find((item) => item.costCodeKey === "UAT-CC-001");
  assert.equal(row.resolvedPrelimsTotal, 1000);
  assert.equal(row.cannotAdopt, true);
  assert.equal(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW], true);
});

test("fingerprint is deterministic and changes when proposal inputs change", () => {
  const lines = enriched5231Lines();
  const first = buildProposalFingerprint({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    lines,
  });
  const second = buildProposalFingerprint({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    lines,
  });
  const changed = buildProposalFingerprint({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    lines: lines.map((line) =>
      line.id === "da5b67be-8432-454e-b6a5-37e163078f1c"
        ? { ...line, monthlyRate: 1100 }
        : line
    ),
  });

  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("drift states cover up to date, proposal changed, CVR drift, and superseded", () => {
  const lines = enriched5231Lines();
  const fingerprint = buildProposalFingerprint({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    lines,
  });

  const upToDate = resolveAdoptionDriftState({
    metadata: {
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      proposalFingerprint: fingerprint,
    },
    currentFingerprint: fingerprint,
    currentFinalForecast: 58000,
    currentAdjustment: 7720,
    systemForecast: 50280,
  });
  assert.equal(upToDate.primary, PRELIMS_ADOPTION_DRIFT_STATES.UP_TO_DATE);

  const proposalChanged = resolveAdoptionDriftState({
    metadata: {
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      proposalFingerprint: fingerprint,
    },
    currentFingerprint: `${fingerprint}-changed`,
    currentFinalForecast: 58000,
    currentAdjustment: 7720,
    systemForecast: 50280,
  });
  assert.equal(proposalChanged.primary, PRELIMS_ADOPTION_DRIFT_STATES.PROPOSAL_CHANGED);

  const cvrDrift = resolveAdoptionDriftState({
    metadata: {
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      systemForecastAtAdoption: 50280,
      proposalFingerprint: fingerprint,
    },
    currentFingerprint: fingerprint,
    currentFinalForecast: 63000,
    currentAdjustment: 7720,
    systemForecast: 55280,
  });
  assert.equal(cvrDrift.primary, PRELIMS_ADOPTION_DRIFT_STATES.CVR_DRIFT);

  const superseded = resolveAdoptionDriftState({
    metadata: {
      adoptedTargetFinal: 58000,
      adoptedAdjustment: 7720,
      proposalFingerprint: fingerprint,
    },
    currentFingerprint: fingerprint,
    currentFinalForecast: 59000,
    currentAdjustment: 8720,
    systemForecast: 50280,
  });
  assert.equal(superseded.primary, PRELIMS_ADOPTION_DRIFT_STATES.ADOPTION_SUPERSEDED);
});

test("metadata contract uses prelimsAdoption key", () => {
  assert.equal(PRELIMS_ADOPTION_METADATA_KEY, "prelimsAdoption");
  const metadata = buildPrelimsAdoptionMetadata({
    adoptedTargetFinal: 58000,
    adoptedAdjustment: 7720,
    systemForecastAtAdoption: 50280,
    previousFinalForecast: 50800,
    previousAdjustment: 520,
    proposalFingerprint: "bl033dx4a-deadbeef",
    sourceLineIds: ["a"],
    excludedUnresolvedLineIds: ["b"],
    reportingMonth: REPORTING_MONTH,
    periodKey: PERIOD_KEY,
    adoptedAt: "2026-08-23T10:00:00.000Z",
    adoptedBy: "Commercial Manager",
  });

  assert.equal(metadata.adoptedTargetFinal, 58000);
  assert.equal(metadata.reportingMonth, "2026-08");
  assert.deepEqual(metadata.sourceLineIds, ["a"]);
});
