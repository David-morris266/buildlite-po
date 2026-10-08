const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateSelectionAgainstCandidate,
} = require("../services/prelimsAdoptionApplyService");
const {
  validateSelectionAgainstComparison,
} = require("../services/sellingCostsAdoptionApplyService");

test("Prelims fails closed when Selling Costs actively owns the Cost Code adjustment", () => {
  const result = validateSelectionAgainstCandidate({
    selection: { costCodeKey: "5400" },
    candidate: {},
    inputDoc: {
      displayMetadata: {
        sellingCostsAdoption: { superseded: false, released: false },
      },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "WORKFLOW_OWNERSHIP_CONFLICT");
  assert.equal(result.conflictingOwner, "selling_costs");
});

test("Selling Costs fails closed when Prelims actively owns the Cost Code adjustment", () => {
  const result = validateSelectionAgainstComparison({
    selection: { destinationCostCodeKey: "5400" },
    comparison: {},
    inputDoc: {
      displayMetadata: {
        prelimsAdoption: { superseded: false, released: false },
      },
    },
    resolvedDestinationKey: "5400",
    destination: { status: "ready" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.equal(result.code, "WORKFLOW_OWNERSHIP_CONFLICT");
  assert.equal(result.conflictingOwner, "prelims");
});
