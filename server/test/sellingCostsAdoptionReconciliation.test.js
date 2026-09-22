const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSellingCostsReconciliation,
  classifySellingCostsOwnership,
} = require("../services/sellingCostsAdoptionReconciliation");

function adoptedInput(overrides = {}) {
  const adjustment = overrides.commercialAdjustment ?? 50000;
  const reason = overrides.adjustmentReason ?? "Selling Costs forecast adopted — 2026-08";
  return {
    id: overrides.id || "input-a",
    costCodeKey: overrides.costCodeKey || "A",
    costCodeLabel: overrides.costCodeLabel || "A — Selling Costs",
    version: overrides.version || 2,
    commercialAdjustment: adjustment,
    adjustmentReason: reason,
    displayMetadata: {
      sellingCostsAdoption: {
        adoptedTargetFinal: adjustment,
        adoptedAdjustment: adjustment,
        previousAdjustment: 10000,
        originalBaselineAdjustment: 10000,
        originalBaselineReason: "Original QS judgement",
        superseded: false,
      },
      adjustmentHistory: [{
        source: "selling_costs_adoption",
        previousAdjustment: 10000,
        newAdjustment: adjustment,
        previousReason: "Original QS judgement",
        newReason: reason,
      }],
    },
    ...overrides,
  };
}

test("classifies proven workflow ownership and retains the original baseline", () => {
  const ownership = classifySellingCostsOwnership(adoptedInput());
  assert.equal(ownership.owned, true);
  assert.equal(ownership.originalBaselineAdjustment, 10000);
  assert.equal(ownership.originalBaselineReason, "Original QS judgement");
});

test("removed workflow destinations release while a manual supersession is preserved", () => {
  const owned = adoptedInput();
  const manual = adoptedInput({
    id: "input-b",
    costCodeKey: "B",
    commercialAdjustment: 62000,
    adjustmentReason: "Later QS judgement",
  });
  manual.displayMetadata = {
    ...manual.displayMetadata,
    adjustmentHistory: [
      ...manual.displayMetadata.adjustmentHistory,
      { source: "manual_adjustment", newAdjustment: 62000, newReason: "Later QS judgement" },
    ],
  };
  const rows = buildSellingCostsReconciliation({ inputs: [owned, manual], newDestinationKeys: ["C"] });
  assert.deepEqual(rows.map((row) => [row.costCodeKey, row.action]), [
    ["A", "released"],
    ["B", "preserved_manual"],
  ]);
  assert.equal(rows[0].baselineAdjustment, 10000);
  assert.equal(rows[1].currentAdjustment, 62000);
});

test("retained destinations are excluded from the release set", () => {
  assert.deepEqual(
    buildSellingCostsReconciliation({ inputs: [adoptedInput()], newDestinationKeys: ["a"] }),
    []
  );
});

test("detailed-shaped A/B to B/C set transition releases only A", () => {
  const rows = buildSellingCostsReconciliation({
    inputs: [adoptedInput({ costCodeKey: "A" }), adoptedInput({ id: "input-b", costCodeKey: "B" })],
    newDestinationKeys: ["B", "C"],
  });
  assert.deepEqual(rows.map((row) => [row.costCodeKey, row.action]), [["A", "released"]]);
});

test("historic released evidence is not treated as an active prior or manual position", () => {
  const released = adoptedInput({
    displayMetadata: {
      sellingCostsAdoption: {
        adoptedTargetFinal: 100,
        adoptedAdjustment: 100,
        originalBaselineAdjustment: 0,
        released: true,
        superseded: true,
      },
      adjustmentHistory: [{ source: "selling_costs_adoption", newAdjustment: 0, newReason: "Released" }],
    },
    commercialAdjustment: 0,
    adjustmentReason: "",
  });
  assert.deepEqual(buildSellingCostsReconciliation({ inputs: [released], newDestinationKeys: ["B"] }), []);
});
