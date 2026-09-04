const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  appendSubmittedVariationExposure,
  buildLiveVariationExposure,
  compareSubmittedVariationExposure,
} = require('../services/cvrVariationExposureSnapshot');

function exposure(overrides = {}) {
  return {
    calculationVersion: 'va_expected_exposure_v1', ready: true,
    variationAccountItemId: 'va-1', reference: 'VA-0001', status: 'active', itemVersion: 1,
    developmentId: 'dev-1', packageId: 'package-1', costCode: '4330',
    contractorValue: 20000, contractorClaim: 10000, qsForecast: 17000,
    effectiveRecognisedAuthority: 12000, cumulativeLockedCertification: 8000,
    effectiveVaExposure: 17000, authorityAlreadyInCurrentContract: 12000,
    vaExposureUplift: 5000, remainingForecastExposure: 5000,
    authorityComposition: { effectiveCommercialEvent: 0, effectiveVariationOrder: 12000, effectivePaymentAuthority: 0 },
    exceptions: [],
    sourceVersions: { variationAccountItemVersion: 1, allocationIds: ['vo-allocation'], substitutionIds: [], lockedAssessmentIds: ['assessment-1'] },
    provenance: { allocations: [], substitutions: [], lockedAssessments: [] },
    ...overrides,
  };
}

function memoryDb() {
  const rows = [];
  return {
    rows,
    async query(sql, params) {
      if (/MAX\(attempt_number\)/.test(sql)) return { rows: [{ attempt: rows.length + 1 }] };
      if (/INSERT INTO cvr_period_variation_exposure_submissions/.test(sql)) {
        const row = { id: `submission-${rows.length + 1}`, client_id: params[0], development_id: params[1], period_id: params[2], attempt_number: params[3], calculation_version: params[4], source_snapshot: JSON.parse(params[5]), source_snapshot_hash_scheme: params[6], source_snapshot_sha256: params[7], captured_by: params[8] };
        rows.push(row); return { rows: [row] };
      }
      if (/FROM cvr_period_variation_exposure_submissions/.test(sql)) return { rows: rows.length ? [rows.at(-1)] : [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

test('Draft calculation is live and Submit freezes £17k / VO £12k / uplift £5k canonically', async () => {
  const db = memoryDb();
  const loadFacts = async () => [exposure()];
  const live = await buildLiveVariationExposure(db, 'client-1', 'dev-1', loadFacts);
  assert.equal(live.document.items[0].vaExposureUplift, 5000);
  const submitted = await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', actor: 'QS', loadFacts });
  assert.equal(submitted.ok, true);
  assert.equal(db.rows[0].source_snapshot.items[0].effectiveVaExposure, 17000);
  assert.equal(db.rows[0].source_snapshot_hash_scheme, 'canonical_json_sha256_v1');
});

test('forecast, authority or Locked certification changes make submitted evidence stale without rewriting it', async () => {
  for (const changed of [
    exposure({ qsForecast: 18000, effectiveVaExposure: 18000, vaExposureUplift: 6000 }),
    exposure({ effectiveRecognisedAuthority: 13000, authorityComposition: { effectiveCommercialEvent: 0, effectiveVariationOrder: 13000, effectivePaymentAuthority: 0 } }),
    exposure({ cumulativeLockedCertification: 9000, sourceVersions: { variationAccountItemVersion: 1, allocationIds: ['vo-allocation'], substitutionIds: [], lockedAssessmentIds: ['assessment-1', 'assessment-2'] } }),
  ]) {
    const db = memoryDb();
    await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [exposure()] });
    const frozen = JSON.stringify(db.rows[0].source_snapshot);
    const compared = await compareSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [changed] });
    assert.equal(compared.stale, true);
    assert.ok(compared.staleReasons.includes('variation_exposure_sources_changed'));
    assert.equal(JSON.stringify(db.rows[0].source_snapshot), frozen);
  }
});

test('Payment Release and irrelevant display metadata cannot make submitted evidence stale', async () => {
  const db = memoryDb();
  await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [exposure()] });
  const liveWithIgnoredFacts = { ...exposure(), paymentRelease: 9120, displayMetadata: { colour: 'blue' } };
  delete liveWithIgnoredFacts.paymentRelease;
  delete liveWithIgnoredFacts.displayMetadata;
  const compared = await compareSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [liveWithIgnoredFacts] });
  assert.equal(compared.stale, false);
  assert.equal(compared.integrity.valid, true);
});

test('Reject/resubmit appends fresh reviewed evidence that can compare cleanly', async () => {
  const db = memoryDb();
  await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [exposure()] });
  const revised = exposure({ qsForecast: 18000, itemVersion: 2, effectiveVaExposure: 18000, vaExposureUplift: 6000, remainingForecastExposure: 6000, sourceVersions: { variationAccountItemVersion: 2, allocationIds: ['vo-allocation'], substitutionIds: [], lockedAssessmentIds: ['assessment-1'] } });
  await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [revised] });
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows[0].source_snapshot.items[0].qsForecast, 17000);
  assert.equal(db.rows[1].source_snapshot.items[0].qsForecast, 18000);
  const compared = await compareSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [revised] });
  assert.equal(compared.stale, false);
});

test('blocking exceptions prevent a submitted exposure attempt while floor exceptions remain frozen', async () => {
  const db = memoryDb();
  const blocked = await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [exposure({ ready: false, effectiveVaExposure: null, vaExposureUplift: null, exceptions: ['opposing_sign_exposure'] })] });
  assert.equal(blocked.ok, false);
  assert.equal(db.rows.length, 0);
  const allowed = await appendSubmittedVariationExposure(db, { clientId: 'client-1', developmentId: 'dev-1', periodId: 'period-1', loadFacts: async () => [exposure({ exceptions: ['forecast_below_recognised_authority'] })] });
  assert.equal(allowed.ok, true);
  assert.deepEqual(db.rows[0].source_snapshot.items[0].exceptions, ['forecast_below_recognised_authority']);
});

test('legacy pre-VA period remains not captured rather than stale', async () => {
  const result = await compareSubmittedVariationExposure(memoryDb(), { clientId: 'client-1', developmentId: 'dev-1', periodId: 'legacy-period', loadFacts: async () => [exposure()] });
  assert.deepEqual(result, { captured: false, legacy: true, stale: false, staleReasons: [] });
});

test('Migration 041 is additive, append-only, canonical-hashed and has no backfill', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '041_cvr_variation_exposure_snapshots.sql'), 'utf8');
  assert.match(sql, /canonical_json_sha256_v1/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cvr_period_variation_exposure_submissions/);
  assert.match(sql, /variation_exposure_submission_id/);
  assert.doesNotMatch(sql, /INSERT INTO cvr_period_variation_exposure_submissions\s+SELECT/i);
  assert.doesNotMatch(sql, /UPDATE\s+cvr_periods|UPDATE\s+cvr_period_snapshots/i);
});

test('Lock lifecycle checks submitted staleness and persists the exact submission link', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'cvrPeriodRepository.js'), 'utf8');
  const snapshot = fs.readFileSync(path.join(__dirname, '..', 'services', 'cvrSnapshotRepository.js'), 'utf8');
  assert.match(source, /compareSubmittedVariationExposure/);
  assert.match(source, /Reject, review and resubmit before Lock/);
  assert.match(source, /variationExposureSubmissionId: variationExposure\.submitted\?\.id/);
  assert.match(snapshot, /variation_exposure_submission_id/);
});
