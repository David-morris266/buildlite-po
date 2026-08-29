const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildContractAuthority,
  buildVariationOrderCertificationReadiness,
} = require("../services/variationOrderAuthority");
const { buildCommitmentsByCostCode } = require("../services/cvrCloseEngine");
const { validateLinesAgainstEvents } = require("../services/paymentCertificateValidation");

const event = (id, value, overrides = {}) => ({
  id, value, status: "approved", eventType: "variation", relationshipType: "none", ...overrides,
});
const vo = (status, value, source = "ce-1") => ({
  id: "vo-1", status, signedValue: value,
  sourceCommercialEvents: [{ commercialEventId: source }],
});

test("authority transfers only on Issue and never double counts", () => {
  for (const status of ["draft", "submitted", "approved"]) {
    const result = buildContractAuthority({ originalOrderValue: 235000, events: [event("ce-1", 5000)], variationOrders: [vo(status, 4500)] });
    assert.equal(result.currentContract, 240000);
    assert.equal(result.approvedUninstructedValue, 5000);
    assert.equal(result.issuedVariationOrderValue, 0);
  }
  const issued = buildContractAuthority({ originalOrderValue: 235000, events: [event("ce-1", 5000)], variationOrders: [vo("issued", 4500)] });
  assert.deepEqual(issued, {
    originalOrder: 235000, approvedUninstructedValue: 0, issuedVariationOrderValue: 4500,
    currentContract: 239500, pendingEventValue: 0, supersededCommercialEventIds: ["ce-1"], issuedVariationOrderCount: 1,
  });
});

test("unlinked approved events remain authoritative; recoveries remain excluded", () => {
  const result = buildContractAuthority({
    originalOrderValue: 235000,
    events: [event("ce-1", 5000), event("ce-2", 2000), event("recovery", -1000, { relationshipType: "recovery" })],
    variationOrders: [vo("issued", 4500)],
  });
  assert.equal(result.approvedUninstructedValue, 2000);
  assert.equal(result.currentContract, 241500);
});

test("negative Issued VO symmetrically supersedes its source credit", () => {
  const result = buildContractAuthority({ originalOrderValue: 10000, events: [event("ce-1", -3000, { eventType: "credit" })], variationOrders: [vo("issued", -2500)] });
  assert.equal(result.currentContract, 7500);
  assert.equal(result.issuedVariationOrderValue, -2500);
});

test("certification readiness accounts for historic CE certification and exposes excess", () => {
  assert.deepEqual(buildVariationOrderCertificationReadiness({ status: "issued", value: 4500, historicCertified: 2000, lineCount: 1 }), {
    isIssuedAuthority: true, certifiable: true, authorityValue: 4500, historicCertifiedValue: 2000,
    remainingCertifiableValue: 2500, overCertifiedAmount: 0, exception: null, readinessReason: null,
  });
  const excess = buildVariationOrderCertificationReadiness({ status: "issued", value: 4500, historicCertified: 5000, lineCount: 1 });
  assert.equal(excess.remainingCertifiableValue, 0);
  assert.equal(excess.overCertifiedAmount, 500);
  assert.match(excess.exception, /500\.00 certified above/);
});

test("non-Issued and multi-line VOs are not exposed as certifiable; signed credits retain sign", () => {
  assert.equal(buildVariationOrderCertificationReadiness({ status: "approved", value: 5000, historicCertified: 0 }).certifiable, false);
  const credit = buildVariationOrderCertificationReadiness({ status: "issued", value: -3000, historicCertified: -1500, lineCount: 1 });
  assert.equal(credit.remainingCertifiableValue, -1500);
  assert.equal(credit.certifiable, true);
  assert.equal(buildVariationOrderCertificationReadiness({ status: "issued", value: 5000, lineCount: 2 }).certifiable, false);
});

test("CVR committed/System authority uses the Issued VO substitution", () => {
  const orderKey = "dev-1::supplier-1::5218";
  const po = { type: "S", status: "approved", supplierId: "supplier-1", subtotal: 235000,
    poNumber: "PO-1", developmentId: "dev-1", costRef: { costCode: "5218" } };
  const events = [{ ...event("ce-1", 5000), orderKey, packageId: orderKey }];
  const before = buildCommitmentsByCostCode("dev-1", [po], events, [vo("approved", 4500)]);
  assert.equal(before.totals.get("5218"), 240000);
  const issuedVo = { ...vo("issued", 4500), orderKey };
  const after = buildCommitmentsByCostCode("dev-1", [po], events, [issuedVo]);
  assert.equal(after.totals.get("5218"), 239500);
});

test("an issued VO removes its source CE from new certificate eligibility", () => {
  const ce = { ...event("ce-1", 5000), eventNumber: "CE-1", packageUuid: "pkg-1", orderKey: "order-1", issuedVariationOrderId: "vo-1" };
  const result = validateLinesAgainstEvents({
    lines: [{ commercialEventId: "ce-1", lineType: "valueInclusion", amountThisCertificate: 1000, sourceEventValue: 5000 }],
    eventsById: new Map([[ce.id, ce]]), packageId: "pkg-1", orderKey: "order-1", lockedCertificates: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Issued Variation Order/);
});
