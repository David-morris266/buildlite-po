const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApplication, APPLICATION_BASES, validateApplicationBasis } = require('../services/paymentApplicationNormalization');

test('normalises current-period gross and preserves variance sign', () => {
  const base = { applicationBasis: APPLICATION_BASES.currentPeriodGross, currentPeriodGrossClaimed: 30000 };
  assert.deepEqual(normalizeApplication(base, { grossWorksThisCertificate: 27000 }), {
    comparable: true, comparisonBasis: 'current_period_gross', applicationCurrentGross: 30000,
    applicationCumulativeGross: null, assessmentCurrentGross: 27000, difference: -3000, reason: null,
  });
  assert.equal(normalizeApplication(base, { grossWorksThisCertificate: 30000 }).difference, 0);
  assert.equal(normalizeApplication(base, { grossWorksThisCertificate: 32000 }).difference, 2000);
});

test('normalises cumulative less previous application and previous certified distinctly', () => {
  assert.equal(normalizeApplication({ applicationBasis: APPLICATION_BASES.cumulativeLessPreviousApplication, cumulativeGrossClaimed: 100000, previousApplicationStated: 70000 }, { grossWorksThisCertificate: 27000 }).applicationCurrentGross, 30000);
  assert.equal(normalizeApplication({ applicationBasis: APPLICATION_BASES.cumulativeLessPreviousCertified, cumulativeGrossClaimed: 100000, previousCertifiedStated: 68000 }, { grossWorksThisCertificate: 27000 }).applicationCurrentGross, 32000);
});

test('missing values and net-only remain not comparable rather than becoming zero', () => {
  const missing = normalizeApplication({ applicationBasis: APPLICATION_BASES.currentPeriodGross }, { grossWorksThisCertificate: 0 });
  assert.equal(missing.comparable, false);
  assert.equal(missing.applicationCurrentGross, null);
  const net = normalizeApplication({ applicationBasis: APPLICATION_BASES.netOnly, netRequestedStated: 1000 }, { grossWorksThisCertificate: 1000 });
  assert.equal(net.comparable, false);
  assert.match(net.reason, /Net-only/);
});

test('validates the required source operands for all four application bases', () => {
  const cases = [
    [{ applicationBasis: APPLICATION_BASES.currentPeriodGross, currentPeriodGrossClaimed: 0 }, 'currentPeriodGrossClaimed'],
    [{ applicationBasis: APPLICATION_BASES.cumulativeLessPreviousApplication, cumulativeGrossClaimed: 100, previousApplicationStated: 40 }, 'previousApplicationStated'],
    [{ applicationBasis: APPLICATION_BASES.cumulativeLessPreviousCertified, cumulativeGrossClaimed: 100, previousCertifiedStated: 40 }, 'previousCertifiedStated'],
    [{ applicationBasis: APPLICATION_BASES.netOnly, netRequestedStated: 60 }, 'netRequestedStated'],
  ];
  for (const [complete, requiredField] of cases) {
    assert.equal(validateApplicationBasis(complete).valid, true);
    const incomplete = { ...complete, [requiredField]: '' };
    const result = validateApplicationBasis(incomplete);
    assert.equal(result.valid, false);
    assert.equal(result.errors[0].field, requiredField);
  }
});

test('previous-certified basis uses only the contractor-stated operand and net-only never derives gross', () => {
  const cumulative = normalizeApplication({
    applicationBasis: APPLICATION_BASES.cumulativeLessPreviousCertified,
    cumulativeGrossClaimed: 100.01,
    previousCertifiedStated: 40.02,
  }, { grossWorksThisCertificate: 59.99 });
  assert.equal(cumulative.applicationCurrentGross, 59.99);
  const net = normalizeApplication({ applicationBasis: APPLICATION_BASES.netOnly, netRequestedStated: 91.2 }, { grossWorksThisCertificate: 80 });
  assert.equal(net.applicationCurrentGross, null);
  assert.equal(net.comparable, false);
  assert.match(net.reason, /normal Application vs Assessment comparison/);
});
