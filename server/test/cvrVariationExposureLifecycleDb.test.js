const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const {
  approveCvrPeriod,
  getCvrPeriod,
  rejectCvrPeriod,
  submitCvrPeriod,
} = require('../services/cvrPeriodRepository');
const { compareSubmittedVariationExposure } = require('../services/cvrVariationExposureSnapshot');
const variationAccountRepository = require('../services/variationAccountRepository');
const { verifyJsonIntegrity } = require('../services/canonicalJsonIntegrity');

let fixture;

test.before(async () => {
  if (!isDbConfigured()) return;
  await prepareIntegrationTestDatabase(pool);
  const client = (await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,'VA5B',false) RETURNING *`, [`VA5B_${randomUUID().slice(0, 8)}`])).rows[0];
  const developmentId = `dev-${randomUUID()}`;
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'VA5B','VA5B','live',$3)`, [developmentId, client.id, JSON.stringify({ plotMaster: { plots: [] } })]);
  await pool.query(`INSERT INTO development_revenue_settings(client_id,development_id,recognition_policy,strategy,house_type_pricing,revenue_adjustments,recognition_settings,created_by,updated_by) VALUES($1,$2,'completion','{}','{}','[]','{}','VA5B','VA5B')`, [client.id, developmentId]);
  const packageRow = (await pool.query(`INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,'supplier-va5b','4330',$3) RETURNING *`, [client.id, developmentId, `va5b:${randomUUID()}`])).rows[0];
  const user = (await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'va5b@test','VA5B Director','active') RETURNING *`, [`provider-${randomUUID()}`])).rows[0];
  const role = (await pool.query(`SELECT id FROM roles WHERE key='commercial_director'`)).rows[0];
  const membership = (await pool.query(`INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *`, [client.id, user.id, role.id])).rows[0];
  const va = (await pool.query(`INSERT INTO package_variation_account_items(client_id,development_id,package_id,cost_code,variation_reference,description,current_contractor_value,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,'4330','VA-0001','VA5B lifecycle',20000,17000,$4,$5,$6,$7) RETURNING *`, [client.id, developmentId, packageRow.id, user.id, membership.id, user.provider_user_id, user.display_name])).rows[0];
  const period = (await pool.query(`INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version) VALUES($1,$2,'P01','P01','draft','{}',1) RETURNING *`, [client.id, developmentId])).rows[0];
  const permissions = (await pool.query(`SELECT permission_key FROM role_permissions WHERE role_id=$1`, [role.id])).rows.map((row) => row.permission_key);
  fixture = { client, developmentId, packageRow, user, membership, va, period, auth: { clientId: client.id, userId: user.id, membershipId: membership.id, providerUserId: user.provider_user_id, displayName: user.display_name, roleKey: 'commercial_director', permissions } };
});

test.after(async () => {
  if (!fixture) return;
  await pool.query(`ALTER TABLE cvr_variation_exposure_acknowledgements DISABLE TRIGGER USER`);
  await pool.query(`DELETE FROM cvr_variation_exposure_acknowledgements WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`ALTER TABLE cvr_variation_exposure_acknowledgements ENABLE TRIGGER USER`);
  await pool.query(`DELETE FROM cvr_period_snapshot_rows WHERE snapshot_id IN (SELECT id FROM cvr_period_snapshots WHERE client_id=$1)`, [fixture.client.id]);
  await pool.query(`DELETE FROM cvr_period_snapshot_plots WHERE snapshot_id IN (SELECT id FROM cvr_period_snapshots WHERE client_id=$1)`, [fixture.client.id]);
  await pool.query(`DELETE FROM cvr_period_snapshots WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`DELETE FROM cvr_periods WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`ALTER TABLE package_variation_account_forecast_history DISABLE TRIGGER USER`);
  await pool.query(`DELETE FROM package_variation_account_forecast_history WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`ALTER TABLE package_variation_account_forecast_history ENABLE TRIGGER USER`);
  await pool.query(`ALTER TABLE package_variation_account_items DISABLE TRIGGER USER`);
  await pool.query(`DELETE FROM package_variation_account_items WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`ALTER TABLE package_variation_account_items ENABLE TRIGGER USER`);
  await pool.query(`DELETE FROM packages WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`DELETE FROM development_revenue_settings WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`DELETE FROM developments WHERE client_id=$1`, [fixture.client.id]);
  await pool.query(`DELETE FROM client_user_memberships WHERE id=$1`, [fixture.membership.id]);
  await pool.query(`DELETE FROM buildlite_users WHERE id=$1`, [fixture.user.id]);
  await pool.query(`DELETE FROM clients WHERE id=$1`, [fixture.client.id]);
});

test('Submit freezes, stale source blocks Lock, and Reject/resubmit appends fresh evidence', async (t) => {
  if (!fixture) return t.skip();
  const submitted = await submitCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, {}, { actor: 'VA5B QS' });
  assert.equal(submitted.ok, true);
  assert.equal(submitted.period.variationExposure.state, 'submitted');
  assert.equal(submitted.period.variationExposure.document.items[0].qsForecast, 17000);
  const firstSubmission = (await pool.query(`SELECT source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme FROM cvr_period_variation_exposure_submissions WHERE period_id=$1 AND attempt_number=1`, [fixture.period.id])).rows[0];
  assert.equal(verifyJsonIntegrity(firstSubmission.source_snapshot, firstSubmission.source_snapshot_sha256, firstSubmission.source_snapshot_hash_scheme).valid, true);
  await assert.rejects(
    pool.query(`UPDATE cvr_period_variation_exposure_submissions SET captured_by='tampered' WHERE period_id=$1`, [fixture.period.id]),
    /immutable/i
  );
  const revised = await variationAccountRepository.updateForecast(
    fixture.client.id,
    fixture.va.id,
    { version: fixture.va.version, qsForecast: 18000, reason: 'Updated live QS risk assessment' },
    fixture.auth
  );
  assert.equal(revised.ok, true, revised.message);
  assert.equal(revised.item.qsForecast, 18000);
  assert.equal(revised.item.version, 2);
  assert.equal(revised.item.forecastHistory.at(-1).priorValue, 17000);
  assert.equal(revised.item.forecastHistory.at(-1).newValue, 18000);
  assert.equal(revised.item.forecastHistory.at(-1).reason, 'Updated live QS risk assessment');
  assert.equal(revised.item.forecastHistory.at(-1).actor.userId, fixture.user.id);
  const read = await getCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id);
  assert.equal(read.period.variationExposure.stale, true);
  const lock = await approveCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, {}, { actor: 'VA5B Director', auth: fixture.auth });
  assert.equal(lock.ok, false);
  assert.equal(lock.status, 409);
  assert.match(lock.message, /Reject, review and resubmit/);
  assert.equal((await pool.query(`SELECT status FROM cvr_periods WHERE id=$1`, [fixture.period.id])).rows[0].status, 'submitted');

  assert.equal((await rejectCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, { comment: 'Refresh VA exposure' }, { actor: 'VA5B Director' })).ok, true);
  assert.equal((await submitCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, {}, { actor: 'VA5B QS' })).ok, true);
  const attempts = await pool.query(`SELECT attempt_number,source_snapshot FROM cvr_period_variation_exposure_submissions WHERE period_id=$1 ORDER BY attempt_number`, [fixture.period.id]);
  assert.equal(attempts.rowCount, 2);
  assert.equal(attempts.rows[0].source_snapshot.items[0].qsForecast, 17000);
  assert.equal(attempts.rows[1].source_snapshot.items[0].qsForecast, 18000);
  assert.deepEqual(attempts.rows[0].source_snapshot, firstSubmission.source_snapshot);
  const secondSubmission = (await pool.query(`SELECT source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme FROM cvr_period_variation_exposure_submissions WHERE period_id=$1 AND attempt_number=2`, [fixture.period.id])).rows[0];
  assert.equal(verifyJsonIntegrity(secondSubmission.source_snapshot, secondSubmission.source_snapshot_sha256, secondSubmission.source_snapshot_hash_scheme).valid, true);
  const comparison = await compareSubmittedVariationExposure(pool, { clientId: fixture.client.id, developmentId: fixture.developmentId, periodId: fixture.period.id });
  assert.equal(comparison.stale, false);

  const locked = await approveCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id, {}, { actor: 'VA5B Director', auth: fixture.auth });
  assert.equal(locked.ok, true, locked.message);
  assert.equal(locked.period.snapshot.variationExposure.document.items[0].qsForecast, 18000);
  const laterRevision = await variationAccountRepository.updateForecast(
    fixture.client.id,
    fixture.va.id,
    { version: revised.item.version, qsForecast: 19000, reason: 'Later live forecast after CVR Lock' },
    fixture.auth
  );
  assert.equal(laterRevision.ok, true, laterRevision.message);
  const historicRead = await getCvrPeriod(fixture.client.id, fixture.developmentId, fixture.period.id);
  assert.equal(historicRead.period.status, 'locked');
  assert.equal(historicRead.period.snapshot.variationExposure.document.items[0].qsForecast, 18000);
  assert.equal(laterRevision.item.qsForecast, 19000);
});

test('same-direction acknowledgement is immutable, authenticated and attempt-specific', async (t) => {
  if (!fixture) return t.skip();
  const { hashCanonicalJson, CANONICAL_JSON_SHA256_V1 } = require('../services/canonicalJsonIntegrity');
  const { appendAcknowledgement, listAcknowledgements } = require('../services/cvrVariationExposureSnapshot');
  const acknowledgementPeriod = (await pool.query(`INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,submitted_at,submitted_by) VALUES($1,$2,'P02','P02','submitted','{}',2,NOW(),$3) RETURNING *`, [fixture.client.id, fixture.developmentId, fixture.user.display_name])).rows[0];
  const source = { calculationVersion: 'va_expected_exposure_v1', items: [{ variationAccountItemId: fixture.va.id, reference: 'VA-0001', costCode: '4330', qsForecast: 17000, effectiveRecognisedAuthority: 18000, cumulativeLockedCertification: 0, effectiveVaExposure: 18000, authorityAlreadyInCurrentContract: 0, vaExposureUplift: 18000, exceptions: ['forecast_below_recognised_authority'] }] };
  const submission = (await pool.query(`INSERT INTO cvr_period_variation_exposure_submissions(client_id,development_id,period_id,attempt_number,calculation_version,source_snapshot,source_snapshot_hash_scheme,source_snapshot_sha256,captured_by) VALUES($1,$2,$3,1,'va_expected_exposure_v1',$4,$5,$6,$7) RETURNING *`, [fixture.client.id,fixture.developmentId,acknowledgementPeriod.id,JSON.stringify(source),CANONICAL_JSON_SHA256_V1,hashCanonicalJson(source),fixture.user.display_name])).rows[0];
  const result = await appendAcknowledgement(pool, { clientId: fixture.client.id, developmentId: fixture.developmentId, periodId: acknowledgementPeriod.id, requirement: { variationAccountItemId: fixture.va.id, exceptionCode: 'forecast_below_recognised_authority' }, reason: 'Reviewed floor', auth: fixture.auth });
  assert.equal(result.ok, true);
  const rows = await listAcknowledgements(pool, fixture.client.id, submission.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].acknowledgedByUserId, fixture.user.id);
  assert.equal(rows[0].membershipId, fixture.membership.id);
  assert.equal(rows[0].effectiveFloor, 18000);
  await assert.rejects(pool.query(`UPDATE cvr_variation_exposure_acknowledgements SET reason='changed' WHERE id=$1`, [rows[0].id]), /immutable/i);
});
