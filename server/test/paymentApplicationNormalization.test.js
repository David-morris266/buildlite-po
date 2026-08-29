const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeApplication, APPLICATION_BASES } = require('../services/paymentApplicationNormalization');

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
