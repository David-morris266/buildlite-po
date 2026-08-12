/**
 * BL-028A — CCV classification pure tests.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  affectsContractValue,
  isRecoveryCommercialEvent,
  COMMERCIAL_EVENT_STATUSES,
} = require("../services/commercialEventConstants");

test("approved variation affects CCV", () => {
  assert.equal(
    affectsContractValue({
      status: COMMERCIAL_EVENT_STATUSES.approved,
      eventType: "variation",
      financialTreatment: "contractAmendment",
      relationshipType: null,
    }),
    true
  );
});

test("approved sales upgrade affects CCV", () => {
  assert.equal(
    affectsContractValue({
      status: COMMERCIAL_EVENT_STATUSES.approved,
      eventType: "salesUpgrade",
      financialTreatment: "contractAmendment",
      relationshipType: null,
    }),
    true
  );
});

test("approved credit affects CCV with signed value", () => {
  const event = {
    status: COMMERCIAL_EVENT_STATUSES.approved,
    eventType: "credit",
    financialTreatment: null,
    relationshipType: null,
    value: -2500,
  };
  assert.equal(affectsContractValue(event), true);
});

test("approved contract amendment contra affects CCV", () => {
  assert.equal(
    affectsContractValue({
      status: COMMERCIAL_EVENT_STATUSES.approved,
      eventType: "contraCharge",
      financialTreatment: "contractAmendment",
      relationshipType: null,
    }),
    true
  );
});

test("linked recovery does not affect CCV", () => {
  const event = {
    status: COMMERCIAL_EVENT_STATUSES.approved,
    eventType: "contraCharge",
    financialTreatment: "recoverableDeduction",
    relationshipType: "recovery",
    linkedEventId: "ce-origin-1",
    value: -1000,
  };
  assert.equal(isRecoveryCommercialEvent(event), true);
  assert.equal(affectsContractValue(event), false);
});

test("direct recovery does not affect CCV", () => {
  const event = {
    status: COMMERCIAL_EVENT_STATUSES.approved,
    eventType: "contraCharge",
    financialTreatment: "recoverableDeduction",
    relationshipType: "recovery",
    linkedEventId: null,
    value: -500,
  };
  assert.equal(isRecoveryCommercialEvent(event), true);
  assert.equal(affectsContractValue(event), false);
});

test("draft events do not affect CCV", () => {
  assert.equal(
    affectsContractValue({
      status: COMMERCIAL_EVENT_STATUSES.draft,
      eventType: "variation",
      financialTreatment: "contractAmendment",
    }),
    false
  );
});
