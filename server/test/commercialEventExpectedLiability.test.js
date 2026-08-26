/**
 * BL-038B — Pure CE expected-liability derivation (no DB, no CVR wiring).
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  effectiveExpectedLiability,
  potentialLiability,
  enrichExpectedLiabilityReadModel,
  validateExpectedLiabilityIntent,
  expectedExceedsSubmitted,
} = require("../services/commercialEventExpectedLiability");

function event(overrides = {}) {
  return {
    id: "ce-1",
    eventType: "variation",
    financialTreatment: "contractAmendment",
    relationshipType: null,
    status: "submitted",
    value: 20000,
    expectedTreatment: "default",
    expectedAmount: null,
    expectedReason: null,
    ...overrides,
  };
}

test("1. draft effective expected is 0 regardless of default treatment", () => {
  const draft = event({ status: "draft" });
  assert.equal(effectiveExpectedLiability(draft), 0);
  assert.equal(potentialLiability(draft), 0);
});

test("1b. draft stored override is inactive", () => {
  const draft = event({
    status: "draft",
    expectedTreatment: "override",
    expectedAmount: 15000,
    expectedReason: "QS view",
  });
  assert.equal(effectiveExpectedLiability(draft), 0);
  assert.equal(expectedExceedsSubmitted(draft), false);
});

test("2. submitted default expected equals CE value", () => {
  assert.equal(effectiveExpectedLiability(event()), 20000);
  assert.equal(potentialLiability(event()), 20000);
});

test("3. override below submitted", () => {
  const ce = event({
    expectedTreatment: "override",
    expectedAmount: 12500,
    expectedReason: "Likely settlement",
  });
  assert.equal(effectiveExpectedLiability(ce), 12500);
});

test("4. override equal submitted", () => {
  const ce = event({
    expectedTreatment: "override",
    expectedAmount: 20000,
    expectedReason: "Confirm full",
  });
  assert.equal(effectiveExpectedLiability(ce), 20000);
  assert.equal(expectedExceedsSubmitted(ce), false);
});

test("5. override above submitted allowed with warning", () => {
  const ce = event({
    expectedTreatment: "override",
    expectedAmount: 25000,
    expectedReason: "Likely extra instruction",
  });
  assert.equal(effectiveExpectedLiability(ce), 25000);
  assert.equal(expectedExceedsSubmitted(ce), true);
  const read = enrichExpectedLiabilityReadModel(ce);
  assert.equal(read.warningAboveSubmitted, true);
  assert.equal(read.expectedWarning, "above_submitted");
});

test("6. override zero", () => {
  const ce = event({
    expectedTreatment: "override",
    expectedAmount: 0,
    expectedReason: "Expect nil settlement",
  });
  assert.equal(effectiveExpectedLiability(ce), 0);
});

test("7. hold is 0", () => {
  assert.equal(
    effectiveExpectedLiability(event({ expectedTreatment: "hold", expectedReason: "Awaiting info" })),
    0
  );
});

test("8. exclude is 0", () => {
  assert.equal(
    effectiveExpectedLiability(
      event({ expectedTreatment: "exclude", expectedReason: "Not this code" })
    ),
    0
  );
});

test("9. restore default follows submitted value", () => {
  const restored = event({ expectedTreatment: "default", expectedAmount: null });
  assert.equal(effectiveExpectedLiability(restored), 20000);
});

test("10. reason required for override/hold/exclude", () => {
  assert.equal(validateExpectedLiabilityIntent({ treatment: "override", expectedAmount: 1 }, event()).ok, false);
  assert.equal(validateExpectedLiabilityIntent({ treatment: "hold" }, event()).ok, false);
  assert.equal(validateExpectedLiabilityIntent({ treatment: "exclude" }, event()).ok, false);
});

test("11. default clears amount/reason in intent", () => {
  const result = validateExpectedLiabilityIntent({ treatment: "default" }, event());
  assert.equal(result.ok, true);
  assert.equal(result.expectedAmount, null);
  assert.equal(result.expectedReason, null);
  assert.equal(result.nextEffectiveExpected, 20000);
});

test("12-14. approved / rejected / included / closed expected is 0", () => {
  for (const status of ["approved", "rejected", "includedInCertificate", "closed"]) {
    const ce = event({
      status,
      expectedTreatment: "override",
      expectedAmount: 18000,
      expectedReason: "historic",
    });
    assert.equal(effectiveExpectedLiability(ce), 0, status);
    assert.equal(enrichExpectedLiabilityReadModel(ce).isExpectedTreatmentEditable, false, status);
  }
});

test("15. recovery / non-contract-value expected is 0", () => {
  const recovery = event({ relationshipType: "recovery", value: -5000 });
  assert.equal(effectiveExpectedLiability(recovery), 0);
  const deduction = event({ financialTreatment: "recoverableDeduction", value: -2000 });
  assert.equal(effectiveExpectedLiability(deduction), 0);
  const intent = validateExpectedLiabilityIntent({ treatment: "hold", reason: "no" }, recovery);
  assert.equal(intent.ok, false);
  assert.equal(intent.code, "NOT_CONTRACT_VALUE");
});

test("20. read model exposes effective and potential", () => {
  const read = enrichExpectedLiabilityReadModel(event());
  assert.equal(read.potentialLiability, 20000);
  assert.equal(read.expectedLiability, 20000);
  assert.equal(read.effectiveExpectedLiability, 20000);
  assert.equal(read.expectedTreatment, "default");
  assert.equal(read.isDefaultTreatment, true);
  assert.equal(read.canEditExpectedLiability, true);
});

test("21. submitted default follows later CE factual value", () => {
  assert.equal(effectiveExpectedLiability(event({ value: 333.33 })), 333.33);
});

test("draft is not editable for treatment", () => {
  const intent = validateExpectedLiabilityIntent({ treatment: "override", expectedAmount: 1, reason: "x" }, event({ status: "draft" }));
  assert.equal(intent.ok, false);
  assert.equal(intent.code, "NOT_SUBMITTED");
});
