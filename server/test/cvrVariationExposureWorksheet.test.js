const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateFinalForecast, enrichCvrForecastRow, buildCvrTotals } = require('../services/cvrCloseFormulas');
const { acknowledgementRequirements, blockingExceptions } = require('../services/cvrVariationExposureSnapshot');

test('VA uplift is a separate exact-pence Final Forecast contribution', () => {
  assert.equal(calculateFinalForecast(12000, 250, 500, 5000), 17750);
  const row = enrichCvrForecastRow({ committed: 12000, currentBudget: 20000, actualCost: 0, manualAccrual: 0, expectedLiability: 500, vaExposureUplift: 5000, commercialAdjustment: 250, certified: 0 });
  assert.equal(row.systemForecast, 12000);
  assert.equal(row.vaExposureUplift, 5000);
  assert.equal(row.finalForecast, 17750);
  assert.equal(buildCvrTotals([row]).vaExposureUplift, 5000);
});

test('Payment Authority floor does not add on top of the VA envelope', () => {
  const row = enrichCvrForecastRow({ committed: 0, currentBudget: 0, actualCost: 0, vaExposureUplift: 17000, expectedLiability: 0, commercialAdjustment: 0 });
  assert.equal(row.finalForecast, 17000);
});

test('same-direction exceptions require acknowledgement but hard blockers cannot be acknowledged', () => {
  const document = { items: [{ variationAccountItemId: 'va-1', reference: 'VA-0001', qsForecast: 17000, effectiveRecognisedAuthority: 18000, cumulativeLockedCertification: 19000,
    exceptions: ['forecast_below_recognised_authority', 'opposing_sign_exposure'] }] };
  assert.deepEqual(acknowledgementRequirements(document).map((item) => item.exceptionCode), ['forecast_below_recognised_authority']);
  assert.equal(acknowledgementRequirements(document)[0].variance, 1000);
  assert.deepEqual(blockingExceptions(document).map((item) => item.reason), ['opposing_sign_exposure']);
});

test('penny and negative VA uplift arithmetic is exact', () => {
  assert.equal(calculateFinalForecast(-12.34, -0.01, 0, -0.02), -12.37);
});

test('Migration 042 is additive, attempt-bound, authenticated and append-only', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '042_cvr_variation_exposure_acknowledgements.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE cvr_variation_exposure_acknowledgements/i);
  assert.match(sql, /submission_id UUID NOT NULL REFERENCES cvr_period_variation_exposure_submissions/i);
  assert.match(sql, /acknowledged_by_user_id UUID NOT NULL REFERENCES buildlite_users/i);
  assert.match(sql, /membership_id UUID NOT NULL REFERENCES client_user_memberships/i);
  assert.match(sql, /UNIQUE\(client_id,submission_id,variation_account_item_id,exception_code\)/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE/i);
  assert.doesNotMatch(sql, /UPDATE\s+(?:cvr_periods|package_variation_account_items)/i);
});
