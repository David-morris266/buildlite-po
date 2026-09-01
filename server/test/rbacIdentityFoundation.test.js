const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const createApp = require('../app');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const { resolveBuildLitePrincipal, assertPermission } = require('../auth/authorization');
const { PERMISSIONS } = require('../auth/permissions');
const { CRITICAL_ROUTE_PERMISSIONS } = require('../auth/routePermissionManifest');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '031_rbac_identity_foundation.sql'), 'utf8');
const principal = { userId:'user-1', providerUserId:'clerk-1', displayName:'Pilot QS', clientId:'client-1', membershipId:'membership-1', roleKey:'qs', roleName:'QS', permissions:[PERMISSIONS.COMMERCIAL_READ], memberships:[] };

test('migration 031 is additive and does not backfill users, memberships or historic actors', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS buildlite_users/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS client_user_memberships/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS role_permissions/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS authorization_action_audit/i);
  assert.match(migration, /authorization action audit is append-only/i);
  assert.doesNotMatch(migration, /INSERT INTO buildlite_users/i);
  assert.doesNotMatch(migration, /INSERT INTO client_user_memberships/i);
  assert.doesNotMatch(migration, /UPDATE\s+(purchase_orders|commercial_events|package_payment_certificates)/i);
});

test('migration 031 applies to buildlite_test and seeds only role/permission definitions', async t => {
  if (!isDbConfigured()) return t.skip();
  await prepareIntegrationTestDatabase(pool);
  const beforeUsers = await pool.query(`SELECT to_regclass('buildlite_users') table_name`);
  const existingUsers = beforeUsers.rows[0].table_name ? Number((await pool.query('SELECT COUNT(*) n FROM buildlite_users')).rows[0].n) : 0;
  const existingMemberships = beforeUsers.rows[0].table_name ? Number((await pool.query('SELECT COUNT(*) n FROM client_user_memberships')).rows[0].n) : 0;
  await pool.query(migration);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM buildlite_users')).rows[0].n), existingUsers);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM client_user_memberships')).rows[0].n), existingMemberships);
  assert.equal(Number((await pool.query('SELECT COUNT(*) n FROM roles')).rows[0].n), 6);
  assert.ok(Number((await pool.query('SELECT COUNT(*) n FROM permissions')).rows[0].n) >= 40);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key='admin' AND rp.permission_key IN ('po.approve','certificate.lock','payment_release.approve')`)).rows[0].n), 0);
});

test('principal resolution is tenant-scoped and rejects cross-tenant selection', async () => {
  const db = { async query(sql) {
    if (sql.includes('FROM buildlite_users')) return { rows:[{id:'user-1',status:'active',display_name:'Pilot QS',email_snapshot:'qs@example.test'}] };
    return { rows:[{membership_id:'m-1',client_id:'client-a',is_active:true,role_key:'qs',role_name:'QS',permissions:[PERMISSIONS.COMMERCIAL_READ]}] };
  }};
  const resolved = await resolveBuildLitePrincipal({provider:'clerk',providerUserId:'clerk-1'}, 'client-a', db);
  assert.equal(resolved.clientId, 'client-a');
  await assert.rejects(resolveBuildLitePrincipal({provider:'clerk',providerUserId:'clerk-1'}, 'client-b', db), error => error.status === 403);
});

test('permission assertion defaults to deny', () => {
  assert.throws(() => assertPermission(principal, PERMISSIONS.PO_APPROVE), error => error.status === 403);
  assert.equal(assertPermission({...principal,permissions:[PERMISSIONS.PO_APPROVE]}, PERMISSIONS.PO_APPROVE).userId, 'user-1');
});

test('API returns 401 without identity and exposes authenticated BuildLite principal', async () => {
  const anonymous = createApp({authAdapter:createTestAuthAdapter(null)});
  assert.equal((await request(anonymous).get('/api/auth/me')).status, 401);
  const authenticated = createApp({authAdapter:createTestAuthAdapter(principal)});
  const response = await request(authenticated).get('/api/auth/me');
  assert.equal(response.status, 200);
  assert.equal(response.body.user.id, 'user-1');
  assert.deepEqual(response.body.permissions, [PERMISSIONS.COMMERCIAL_READ]);
});

test('critical financial route is denied before domain execution when permission is absent', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter(principal)});
  const response = await request(app).post('/api/po/S001/approve').send({approvedBy:'Forged Actor'});
  assert.equal(response.status, 403);
  assert.match(response.body.message, /po\.approve/);
});

test('critical-route manifest covers the pilot high-risk boundary', () => {
  const values = Object.values(CRITICAL_ROUTE_PERMISSIONS).join('|');
  for (const permission of [PERMISSIONS.PO_APPROVE,PERMISSIONS.CE_APPROVE,PERMISSIONS.VO_ISSUE,PERMISSIONS.CVR_LOCK,PERMISSIONS.CERTIFICATE_LOCK,PERMISSIONS.INTENDED_PAYMENT_CONFIRM,PERMISSIONS.PAYMENT_NOTICE_ISSUE,PERMISSIONS.PAY_LESS_ISSUE,PERMISSIONS.DOCUMENT_GENERATE,PERMISSIONS.DOCUMENT_ISSUE,PERMISSIONS.DOCUMENT_VIEW,PERMISSIONS.TERMS_PUBLISH]) assert.match(values, new RegExp(permission.replace('.','\\.')));
});
