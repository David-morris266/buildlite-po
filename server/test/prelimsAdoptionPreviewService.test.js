/**
 * BL-033D.x.4B — Prelims adoption review preview (pure / service helpers).
 * Reuses x.4A compare engine; no CVR writes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRELIMS_ADOPTION_FLAG_KEYS,
  buildPrelimsAdoptionPreview,
} = require("../services/prelimsAdoptionCompare");
const {
  enrichCandidate,
  buildCommercialSummary,
} = require("../services/prelimsAdoptionPreviewService");

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
    name: "BL-033D.1 LUMP SUM UAT",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 20000,
    status: "active",
    version: 6,
  },
  {
    id: "da5b67be-8432-454e-b6a5-37e163078f1c",
    costCodeKey: "5231",
    name: "BL-033D.1 TIME UAT",
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
    name: "BL-033D.1 FIRST_COMPLETION unresolved",
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
    name: "UAT development-only line",
    forecastDriver: "LUMP_SUM",
    lumpSumAmount: 1000,
    status: "active",
    version: 1,
  },
];

function buildReviewShape() {
  const engine = buildPrelimsAdoptionPreview({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    prelimsItems: TEST_SITE_1_PRELIMS,
    programme: TEST_SITE_1_PROGRAMME,
    cvrRows: [
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        systemForecast: 50280,
        commercialAdjustment: 520,
        finalForecast: 50800,
        manualAccrual: 120,
      },
    ],
    classifications: [{ costCodeKey: "5231", semanticGroup: "PRELIMS" }],
  });

  const itemsById = new Map(TEST_SITE_1_PRELIMS.map((item) => [String(item.id), item]));
  // Attach calculations via engine enrichment path: re-run compare already used items
  // Enrich unresolved details from engine-decorated preview by merging names.
  const enrichedItems = require("../services/prelimsAdoptionCompare").enrichPrelimsItemsForAdoption(
    TEST_SITE_1_PRELIMS,
    { programme: TEST_SITE_1_PROGRAMME, reportingMonth: REPORTING_MONTH }
  );
  const calcById = new Map(enrichedItems.map((item) => [String(item.id), item]));

  const cvrByKey = new Map([
    [
      "5231",
      {
        costCodeKey: "5231",
        costCodeLabel: "Site Prelims",
        systemForecast: 50280,
        commercialAdjustment: 520,
        finalForecast: 50800,
        manualAccrual: 120,
      },
    ],
  ]);

  const candidates = engine.candidates
    .filter((row) => (row.lineCount || 0) > 0)
    .map((row) =>
      enrichCandidate(row, {
        itemsById: new Map(
          [...itemsById.entries()].map(([id, item]) => [id, calcById.get(id) || item])
        ),
        cvrByKey,
      })
    );

  return {
    candidates: candidates.filter((row) => !row.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]),
    missingFromCvr: candidates.filter((row) => row.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW]),
    summary: buildCommercialSummary(candidates),
  };
}

test("x.4B review shape preserves Test Site 1 5231 worked-example maths", () => {
  const review = buildReviewShape();
  const row = review.candidates.find((item) => item.costCodeKey === "5231");
  assert.ok(row);
  assert.equal(row.resolvedPrelimsTotal, 58000);
  assert.equal(row.unresolvedCount, 1);
  assert.equal(row.systemForecast, 50280);
  assert.equal(row.currentAdjustment, 520);
  assert.equal(row.currentFinalForecast, 50800);
  assert.equal(row.proposedAdjustment, 7720);
  assert.equal(row.proposedFinalForecast, 58000);
  assert.equal(row.deltaFinal, 7200);
  assert.equal(row.costCodeDescription, "Site Prelims");
});

test("proposed adjustment is a replacement, not added to existing adjustment", () => {
  const review = buildReviewShape();
  const row = review.candidates.find((item) => item.costCodeKey === "5231");
  assert.equal(row.systemForecast + row.currentAdjustment, row.currentFinalForecast);
  assert.equal(row.systemForecast + row.proposedAdjustment, row.proposedFinalForecast);
  assert.notEqual(row.currentAdjustment + row.proposedAdjustment, row.proposedAdjustment);
  assert.equal(50280 + 7720, 58000);
  assert.notEqual(520 + 7720, 7720);
  assert.match(row.adjustmentSemantics, /replaces/i);
});

test("unresolved FIRST_COMPLETION line is excluded and never treated as £0", () => {
  const review = buildReviewShape();
  const row = review.candidates.find((item) => item.costCodeKey === "5231");
  assert.equal(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.UNRESOLVED_EXPOSURE], true);
  assert.equal(row.unresolvedLines.length, 1);
  assert.equal(row.unresolvedLines[0].id, "da6668b7-329c-4cab-a0aa-1233184d79cb");
  assert.equal(row.unresolvedLines[0].excludedFromProposal, true);
  assert.match(row.unresolvedExcludedMessage, /1 unresolved line excluded from proposed CVR value/i);
  assert.notEqual(row.resolvedPrelimsTotal, 0);
  assert.equal(row.resolvedPrelimsTotal, 58000);
});

test("UAT-CC-001 missing CVR target is surfaced separately", () => {
  const review = buildReviewShape();
  const missing = review.missingFromCvr.find((item) => item.costCodeKey === "UAT-CC-001");
  assert.ok(missing);
  assert.equal(missing.resolvedPrelimsTotal, 1000);
  assert.equal(missing.cannotAdopt, true);
  assert.equal(missing.flags[PRELIMS_ADOPTION_FLAG_KEYS.NO_CVR_ROW], true);
  assert.match(missing.missingFromCvrMessage, /not present in the current CVR/i);
  assert.equal(
    review.candidates.some((item) => item.costCodeKey === "UAT-CC-001"),
    false
  );
});

test("negative proposed adjustment keeps proposalBelowSystem flag", () => {
  const engine = buildPrelimsAdoptionPreview({
    developmentId: DEV_ID,
    periodKey: PERIOD_KEY,
    reportingMonth: REPORTING_MONTH,
    prelimsItems: TEST_SITE_1_PRELIMS.slice(0, 2),
    programme: TEST_SITE_1_PROGRAMME,
    cvrRows: [
      {
        costCodeKey: "5231",
        systemForecast: 70000,
        commercialAdjustment: 0,
        finalForecast: 70000,
      },
    ],
    classifications: [{ costCodeKey: "5231", semanticGroup: "PRELIMS" }],
  });
  const row = engine.candidates.find((item) => item.costCodeKey === "5231");
  assert.equal(row.proposedAdjustment, -12000);
  assert.equal(row.flags[PRELIMS_ADOPTION_FLAG_KEYS.PROPOSAL_BELOW_SYSTEM], true);
  assert.equal(row.deltaFinal, -12000);
});

test("positive deltaFinal for 5231 worked example", () => {
  const review = buildReviewShape();
  const row = review.candidates.find((item) => item.costCodeKey === "5231");
  assert.ok(row.deltaFinal > 0);
  assert.equal(row.deltaFinal, 7200);
});
