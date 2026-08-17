/**
 * BL-030A — Pure certificate maths parity with client fixtures.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateCertificateCellValues,
  resolveThisCertificatePct,
  sumPreviousApprovedProgress,
  validateThisCertificatePct,
} = require("../services/paymentCertificateCalculations");

test("complete with no prior progress is 100%", () => {
  assert.equal(resolveThisCertificatePct(0, 0, { complete: true }), 100);
});

test("complete after 40% previously approved is 60%", () => {
  assert.equal(resolveThisCertificatePct(40, 0, { complete: true }), 60);
});

test("entering 100% uses complete semantics", () => {
  assert.equal(resolveThisCertificatePct(40, 100), 60);
});

test("partial incremental entry is kept", () => {
  assert.equal(resolveThisCertificatePct(40, 25), 25);
});

test("complete remaining after known previous percentages", () => {
  const cases = [
    [10, 90],
    [25, 75],
    [40, 60],
    [75, 25],
    [90, 10],
  ];
  for (const [previous, expected] of cases) {
    assert.equal(
      resolveThisCertificatePct(previous, 100, { complete: true }),
      expected
    );
  }
});

test("UAT scenario: cert 2 complete after cert 1 at 40% of £10,000", () => {
  const previous = 40;
  const thisCert = resolveThisCertificatePct(previous, 100, { complete: true });
  const values = calculateCertificateCellValues({
    previousCumulativePct: previous,
    thisCertificatePct: thisCert,
    contractValue: 10000,
  });
  assert.equal(thisCert, 60);
  assert.equal(values.thisCertificatePct, 60);
  assert.equal(values.cumulativePct, 100);
  assert.equal(values.thisCertificateValue, 6000);
  assert.equal(values.certifiedToDateValue, 10000);
  assert.equal(values.remainingValue, 0);
});

test("certificate 1 partial progress of £10,000 at 40%", () => {
  const values = calculateCertificateCellValues({
    previousCumulativePct: 0,
    thisCertificatePct: 40,
    contractValue: 10000,
  });
  assert.equal(values.thisCertificatePct, 40);
  assert.equal(values.cumulativePct, 40);
  assert.equal(values.thisCertificateValue, 4000);
  assert.equal(values.remainingValue, 6000);
});

test("sumPreviousApprovedProgress sums incremental approved percentages", () => {
  assert.equal(sumPreviousApprovedProgress([40]), 40);
  assert.equal(sumPreviousApprovedProgress([40, 60]), 100);
  assert.equal(sumPreviousApprovedProgress([0, 25, 15]), 40);
});

test("validateThisCertificatePct rejects cumulative overflow", () => {
  const result = validateThisCertificatePct(40, 70);
  assert.equal(result.valid, false);
});

test("validateThisCertificatePct accepts complete after 40%", () => {
  const result = validateThisCertificatePct(40, 100, { complete: true });
  assert.equal(result.valid, true);
  assert.equal(result.pct, 60);
});
