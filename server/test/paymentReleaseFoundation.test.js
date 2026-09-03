const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const release = require('../services/paymentReleaseRepository');
const authority = require('../services/variationAccountAuthorityRepository');
const { PERMISSIONS } = require('../auth/permissions');
const { CANONICAL_JSON_SHA256_V1, hashCanonicalJson, verifyJsonIntegrity } = require('../services/canonicalJsonIntegrity');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '040_payment_release.sql'), 'utf8');
const sql038 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '038_payment_authority.sql'), 'utf8');
const sql039 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '039_payment_authority_snapshot_hash_scheme.sql'), 'utf8');

test('release readiness separates ready, changed authority and released states', () => {
  const row = { signed_cash_amount: '9120.00', reversal_cash: '0', released_cash: '0', certificate_status: 'locked', source_snapshot: {}, source_snapshot_sha256: hashCanonicalJson({}), source_snapshot_hash_scheme: CANONICAL_JSON_SHA256_V1, supplier_payload: {} };
  assert.equal(release.releaseReadiness(row).workflowState, 'ready');
  const changed = release.releaseReadiness({ ...row, reversal_cash: '-500.00' });
  assert.equal(changed.workflowState, 'needs_review'); assert.match(changed.reasons.join(' '), /reapproved/);
  const unsupported = release.releaseReadiness({ ...row, source_snapshot_hash_scheme: 'unknown' });
  assert.equal(unsupported.workflowState, 'needs_review'); assert.match(unsupported.reasons.join(' '), /unsupported/);
  const completed = release.releaseReadiness({ ...row, released_cash: '9120.00' });
  assert.equal(completed.workflowState, 'released'); assert.equal(completed.releasableCash, 0);
});

test('Migration 040 is additive, immutable and seeds Finance while enforcing the permission rather than role name', () => {
  for (const table of ['payment_release_batches', 'payment_release_items', 'payment_release_audit']) assert.match(migration, new RegExp(`CREATE TABLE ${table}`));
  assert.match(migration, /Payment Release history is append-only/);
  assert.match(migration, /Payment Release batch totals do not reconcile/);
  assert.match(migration, /active membership with payment_release\.execute/);
  assert.match(migration, /JOIN role_permissions rp ON rp\.role_id=m\.role_id AND rp\.permission_key='payment_release\.execute'/);
  assert.doesNotMatch(migration, /m\.is_active=true\s+AND r\.key='finance'/);
  assert.match(migration, /payment_release\.execute/);
  assert.match(migration, /'finance','Finance'/);
  assert.doesNotMatch(migration, /INSERT INTO payment_release_(batches|items|audit)\s*SELECT/i);
  assert.doesNotMatch(migration, /UPDATE\s+(package_payment_certificates|payment_authority_decisions|package_variation_account|commercial_events|variation_orders|cvr_)/i);
});

test('permission-bearing membership releases exact full authority once without commercial side effects', async t => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  if (!(await pool.query("SELECT to_regclass('payment_authority_runs') name")).rows[0].name) await pool.query(sql038);
  if (!(await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='payment_authority_decisions' AND column_name='source_snapshot_hash_scheme'")).rowCount) await pool.query(sql039);
  await pool.query('DROP TABLE IF EXISTS payment_release_audit,payment_release_items,payment_release_batches CASCADE');
  await pool.query(migration);
  const ids = { client: randomUUID(), dev: `dev-release-${randomUUID()}`, supplier: `sup-${randomUUID()}`, pkg: randomUUID(), user: randomUUID(), membership: randomUUID(), cert: randomUUID(), va: randomUUID(), assessment: randomUUID(), run: randomUUID(), decision: randomUUID(), line: randomUUID() };
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,'Release test',false)", [ids.client, `REL_${randomUUID().slice(0, 6)}`]);
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'REL','Release Development','live','{}')", [ids.dev, ids.client]);
  await pool.query("INSERT INTO suppliers(id,name,payload,client_id) VALUES($1,'Release Supplier','{}',$2)", [ids.supplier, ids.client]);
  await pool.query("INSERT INTO packages(id,client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_name,payload) VALUES($1,$2,$3,$4,'4330',$5,'Release Supplier','Release Development',$6)", [ids.pkg, ids.client, ids.dev, ids.supplier, `subcontract:${randomUUID()}`, JSON.stringify({ description: 'Drainage' })]);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'finance@test.invalid','Finance User','active')", [ids.user, `provider-${randomUUID()}`]);
  const financeRole = (await pool.query("SELECT id FROM roles WHERE key='finance'")).rows[0];
  const qsRole = (await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0];
  assert.ok(financeRole);
  await pool.query("DELETE FROM role_permissions WHERE role_id=$1 AND permission_key='payment_release.execute'", [qsRole.id]);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key='finance' AND rp.permission_key='payment_release.execute'")).rows[0].n), 1);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key IN('qs','commercial_manager','commercial_director','admin') AND rp.permission_key='payment_release.execute'")).rows[0].n), 0);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)', [ids.membership, ids.client, ids.user, financeRole.id]);
  await pool.query(`INSERT INTO package_payment_certificates(id,client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,payload,version,gross_value,net_value,matrix_gross,commercial_event_gross,recovery_signed,retention,vat,retention_rate,vat_rate,approved_at)
    VALUES($1,$2,$3,$4,$5,1,'locked','2026-09-01',$6,3,8000,9120,0,8000,0,400,1520,.05,.2,NOW())`, [ids.cert, ids.client, ids.pkg, ids.dev, `subcontract:${randomUUID()}`, JSON.stringify({ sourceAuthoritySnapshot: { unapprovedCertifiedGross: 8000 } })]);
  await pool.query(`INSERT INTO package_variation_account_items(id,client_id,development_id,package_id,cost_code,variation_reference,description,status,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,$4,'4330','VA-0001','Release variation','active',17000,$5,$6,'provider','Finance User')`, [ids.va, ids.client, ids.dev, ids.pkg, ids.user, ids.membership]);
  await pool.query(`INSERT INTO package_variation_account_certificate_assessments(id,client_id,development_id,package_id,certificate_id,variation_account_item_id,signed_current_assessment,assessment_basis,status,previous_certified_at_lock,cumulative_certified_at_lock,source_authority_snapshot,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name,locked_at,locked_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6,8000,'QS assessment','locked',0,8000,$7,$8,$9,'provider','Finance User',$8,$9,'provider','Finance User',NOW(),$8)`, [ids.assessment, ids.client, ids.dev, ids.pkg, ids.cert, ids.va, JSON.stringify({ priorAuthority: 0, unapprovedAmount: 8000 }), ids.user, ids.membership]);
  await pool.query(`INSERT INTO payment_authority_runs(id,client_id,run_reference,status,idempotency_key,summary,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,completed_at)
    VALUES($1,$2,'PAR-REL','completed',$3,'{}',$4,$5,'provider','Director',NOW())`, [ids.run, ids.client, randomUUID(), ids.user, ids.membership]);
  const paSnapshot = { certificateId: ids.cert, certificateVersion: 3, lines: [{ assessmentId: ids.assessment }] };
  await pool.query(`INSERT INTO payment_authority_decisions(id,client_id,run_id,development_id,package_id,certificate_id,certificate_version,signed_cash_amount,certified_gross,retention,recoveries,vat,certificate_net,notified_sum,intended_payment,pay_less_reduction,final_payment_date,notice_mode,reason,source_snapshot,source_snapshot_sha256,source_snapshot_hash_scheme,idempotency_key,approved_by_user_id,approved_by_membership_id,approved_by_provider_user_id,approved_by_display_name,approved_role_key)
    VALUES($1,$2,$3,$4,$5,$6,3,9120,8000,400,0,1520,9120,9120,9120,0,'2026-10-06','certificate_as_payment_notice','Approved',$7,$8,$9,$10,$11,$12,'provider','Director','commercial_director')`, [ids.decision, ids.client, ids.run, ids.dev, ids.pkg, ids.cert, JSON.stringify(paSnapshot), hashCanonicalJson(paSnapshot), CANONICAL_JSON_SHA256_V1, randomUUID(), ids.user, ids.membership]);
  await pool.query(`INSERT INTO payment_authority_decision_lines(id,client_id,decision_id,package_id,certificate_id,variation_account_item_id,assessment_id,signed_assessment,signed_unapproved_at_lock,signed_existing_support,signed_unresolved_amount,signed_new_commercial_authority,basis,source_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,8000,8000,0,8000,8000,'Authority','{}')`, [ids.line, ids.client, ids.decision, ids.pkg, ids.cert, ids.va, ids.assessment]);
  await pool.query(`INSERT INTO package_variation_account_authority_allocations(client_id,development_id,package_id,variation_account_item_id,source_type,future_source_id,payment_authority_decision_line_id,signed_allocated_amount,reason,source_status_snapshot,source_value_snapshot,source_reference_snapshot,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name)
    VALUES($1,$2,$3,$4,'payment_authority',$5::text,$5::uuid,8000,'Authority','approved',8000,'Payment Authority',$6,$7,'provider','Director')`, [ids.client, ids.dev, ids.pkg, ids.va, ids.line, ids.user, ids.membership]);
  const financeAuth = { clientId: ids.client, userId: ids.user, membershipId: ids.membership, providerUserId: 'provider', displayName: 'Finance User', roleKey: 'finance', permissions: [PERMISSIONS.PAYMENT_RELEASE_EXECUTE] };
  assert.equal((await release.listQueue(ids.client, financeAuth))[0].workflowState, 'ready');
  await assert.rejects(release.listQueue(ids.client, { ...financeAuth, permissions: [] }), /payment_release\.execute/);
  await assert.rejects(release.listQueue(ids.client, { ...financeAuth, roleKey: 'finance', permissions: [] }), /payment_release\.execute/);

  // Tenant policy can grant execution to another role without changing Release domain code.
  await pool.query("INSERT INTO role_permissions(role_id,permission_key) VALUES($1,'payment_release.execute') ON CONFLICT DO NOTHING", [qsRole.id]);
  await pool.query('UPDATE client_user_memberships SET role_id=$1 WHERE id=$2', [qsRole.id, ids.membership]);
  const auth = { ...financeAuth, roleKey: 'qs' };
  const releaseKey = `release-${randomUUID()}`;
  const result = await release.executeBatch(ids.client, { idempotencyKey: releaseKey, reason: 'Release to Accounts', paymentAuthorityDecisionIds: [ids.decision] }, auth);
  assert.equal(result.ok, true, result.message); assert.equal(result.totalReleased, 9120); assert.equal(result.itemCount, 1); assert.equal(result.externalStatus, 'not_exported');
  const batch = (await pool.query('SELECT * FROM payment_release_batches WHERE id=$1', [result.batchId])).rows[0];
  const item = (await pool.query('SELECT * FROM payment_release_items WHERE batch_id=$1', [result.batchId])).rows[0];
  assert.equal(Number(item.signed_released_cash), 9120); assert.equal(item.external_status, 'not_exported');
  assert.deepEqual(verifyJsonIntegrity(batch.source_snapshot, batch.source_snapshot_sha256, batch.source_snapshot_hash_scheme).valid, true);
  assert.deepEqual(verifyJsonIntegrity(item.source_snapshot, item.source_snapshot_sha256, item.source_snapshot_hash_scheme).valid, true);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM payment_release_audit WHERE batch_id=$1', [result.batchId])).rows[0].n), 2);
  assert.equal(batch.released_by_user_id, ids.user);
  assert.equal(batch.released_by_membership_id, ids.membership);
  assert.equal(batch.released_role_key, 'qs');
  assert.equal(batch.released_permission_key, PERMISSIONS.PAYMENT_RELEASE_EXECUTE);
  assert.equal((await pool.query('SELECT approved_by_user_id FROM payment_authority_decisions WHERE id=$1', [ids.decision])).rows[0].approved_by_user_id, ids.user);
  const releaseAudit = (await pool.query('SELECT * FROM payment_release_audit WHERE batch_id=$1 ORDER BY created_at,id', [result.batchId])).rows;
  assert.equal(releaseAudit.length, 2);
  assert.ok(releaseAudit.every(entry => entry.actor_user_id === ids.user && entry.actor_membership_id === ids.membership));
  assert.ok(releaseAudit.every(entry => entry.actor_role_key === 'qs' && entry.permission_key === PERMISSIONS.PAYMENT_RELEASE_EXECUTE));
  const replay = await release.executeBatch(ids.client, { idempotencyKey: releaseKey, reason: 'Release to Accounts', paymentAuthorityDecisionIds: [ids.decision] }, auth); assert.equal(replay.idempotent, true); assert.equal(replay.batchId, result.batchId);
  const after = (await release.listQueue(ids.client, auth))[0]; assert.equal(after.workflowState, 'released'); assert.equal(after.previouslyReleased, 9120); assert.equal(after.releasableCash, 0);
  const duplicate = await release.executeBatch(ids.client, { idempotencyKey: `release-${randomUUID()}`, reason: 'Duplicate', paymentAuthorityDecisionIds: [ids.decision] }, auth); assert.equal(duplicate.ok, false); assert.match(duplicate.message, /already been released/);
  const projection = await authority.getProjection(ids.client, ids.va, { ...auth, permissions: Object.values(PERMISSIONS) }); assert.equal(projection.effectivePaymentAuthority, 8000); assert.equal(projection.remainingForecastExposure, 9000);
  assert.equal((await pool.query('SELECT status,gross_value,net_value FROM package_payment_certificates WHERE id=$1', [ids.cert])).rows[0].status, 'locked');
  await pool.query('ALTER TABLE payment_release_items ENABLE TRIGGER USER');
  await assert.rejects(pool.query("UPDATE payment_release_items SET supplier_label='Changed' WHERE id=$1", [item.id]), /append-only/);
  for (const table of ['payment_release_audit','payment_release_items','payment_release_batches','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions','payment_authority_runs','package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_lifecycle_audit','package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_items']) await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  for (const table of ['payment_release_audit','payment_release_items','payment_release_batches','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions','payment_authority_runs','package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_lifecycle_audit','package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_items']) await pool.query(`DELETE FROM ${table} WHERE client_id=$1`, [ids.client]);
  await pool.query('DELETE FROM package_payment_certificates WHERE client_id=$1', [ids.client]); await pool.query('DELETE FROM packages WHERE client_id=$1', [ids.client]); await pool.query('DELETE FROM suppliers WHERE client_id=$1', [ids.client]); await pool.query('DELETE FROM client_user_memberships WHERE client_id=$1', [ids.client]); await pool.query('DELETE FROM clients WHERE id=$1', [ids.client]); await pool.query('DELETE FROM buildlite_users WHERE id=$1', [ids.user]);
  await pool.query("DELETE FROM role_permissions WHERE role_id=$1 AND permission_key='payment_release.execute'", [qsRole.id]);
  for (const table of ['payment_release_audit','payment_release_items','payment_release_batches','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions','payment_authority_runs','package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_lifecycle_audit','package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_items']) await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
});
