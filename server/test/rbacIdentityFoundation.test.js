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
const { ensureActiveTestClient, prepareIntegrationTestDatabase } = require('./integrationTestSetup');

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
  assert.ok(Number((await pool.query('SELECT COUNT(*) n FROM roles')).rows[0].n) >= 6);
  assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM roles WHERE key IN('site','buyer','qs','commercial_manager','commercial_director','admin')")).rows[0].n), 6);
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
  if (!isDbConfigured()) return;
  const clientId = await ensureActiveTestClient(pool);
  const authenticated = createApp({authAdapter:createTestAuthAdapter({...principal,clientId})});
  const response = await request(authenticated).get('/api/auth/me');
  assert.equal(response.status, 200);
  assert.equal(response.body.user.id, 'user-1');
  assert.deepEqual(response.body.permissions, [PERMISSIONS.COMMERCIAL_READ]);
  assert.equal(typeof response.body.tenantReadiness.configured, 'boolean');
  const readiness = await request(authenticated).get('/api/auth/readiness');
  assert.equal(readiness.status, 200);
  assert.equal(readiness.body.clientId, clientId);
  assert.equal(typeof readiness.body.tenantReadiness.configured, 'boolean');
});

test('critical financial route is denied before domain execution when permission is absent', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter(principal)});
  const response = await request(app).post('/api/po/S001/approve').send({approvedBy:'Forged Actor'});
  assert.equal(response.status, 403);
  assert.match(response.body.message, /po\.approve/);
});

test('PO, supplier and Commercial Event import mutations deny before domain execution', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter(principal)});
  const attempts = [
    ['post', '/api/po', PERMISSIONS.PO_CREATE],
    ['put', '/api/po/M001', PERMISSIONS.PO_EDIT],
    ['post', '/api/po/M001/request-approval', PERMISSIONS.PO_SUBMIT],
    ['delete', '/api/po/M001', PERMISSIONS.PO_DELETE_DRAFT],
    ['post', '/api/po/suppliers', PERMISSIONS.PO_CREATE],
    ['put', '/api/po/suppliers/supplier-1', PERMISSIONS.PO_EDIT],
    ['post', '/api/packages/materialise', PERMISSIONS.PO_APPROVE],
    ['post', '/api/packages/materialise-from-po/S001', PERMISSIONS.PO_APPROVE],
    ['post', '/api/commercial-events/import', PERMISSIONS.CE_APPROVE],
  ];
  for (const [method, route, permission] of attempts) {
    const response = await request(app)[method](route).send({name:'Forged',status:'Approved'});
    assert.equal(response.status, 403, `${method.toUpperCase()} ${route}`);
    assert.match(response.body.message, new RegExp(permission.replace('.', '\\.')));
  }
});

test('certificate submit requires its permission rather than a role name', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter({...principal,roleKey:'commercial_director',roleName:'Commercial Director',permissions:[]})});
  const response = await request(app).post('/api/packages/00000000-0000-0000-0000-000000000010/certificates/00000000-0000-0000-0000-000000000011/submit').send({version:1,actor:'Forged'});
  assert.equal(response.status, 403);
  assert.match(response.body.message, /certificate\.submit/);
});

test('certificate Return to Draft requires certificate.reject rather than a role name', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter({...principal,roleKey:'commercial_director',roleName:'Commercial Director',permissions:[]})});
  const response = await request(app).post('/api/packages/00000000-0000-0000-0000-000000000010/certificates/00000000-0000-0000-0000-000000000011/reject').send({version:1,comment:'Return',actor:'Forged'});
  assert.equal(response.status, 403);
  assert.match(response.body.message, /certificate\.reject/);
});

test('Commercial Event approve and reject decisions both require ce.approve', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter({...principal,roleKey:'qs',roleName:'QS',permissions:[]})});
  for (const action of ['approve','reject']) {
    const response = await request(app).post(`/api/commercial-events/ce-test/${action}`).send({comment:'Forged decision'});
    assert.equal(response.status, 403);
    assert.match(response.body.message, /ce\.approve/);
  }
});

test('critical-route manifest covers the pilot high-risk boundary', () => {
  const values = Object.values(CRITICAL_ROUTE_PERMISSIONS).join('|');
  for (const permission of [PERMISSIONS.PO_APPROVE,PERMISSIONS.CE_APPROVE,PERMISSIONS.VO_ISSUE,PERMISSIONS.CVR_LOCK,PERMISSIONS.CERTIFICATE_SUBMIT,PERMISSIONS.CERTIFICATE_LOCK,PERMISSIONS.INTENDED_PAYMENT_CONFIRM,PERMISSIONS.PAYMENT_NOTICE_ISSUE,PERMISSIONS.PAY_LESS_ISSUE,PERMISSIONS.DOCUMENT_GENERATE,PERMISSIONS.DOCUMENT_ISSUE,PERMISSIONS.DOCUMENT_VIEW,PERMISSIONS.TERMS_PUBLISH,PERMISSIONS.PAYMENT_RELEASE_EXECUTE]) assert.match(values, new RegExp(permission.replace('.','\\.')));
});

test('critical-route manifest protects certificate Return to Draft with certificate.reject', () => {
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/packages/:packageId/certificates/:certificateId/reject'], PERMISSIONS.CERTIFICATE_REJECT);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/subcontract-terms/purchase-orders/:poNumber/confirm-legacy'], PERMISSIONS.TERMS_ASSIGN_OVERRIDE);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/commercial-events/:id/reject'], PERMISSIONS.CE_APPROVE);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/po'], PERMISSIONS.PO_CREATE);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['PUT /api/po/:poNumber'], PERMISSIONS.PO_EDIT);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/po/:poNumber/request-approval'], PERMISSIONS.PO_SUBMIT);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['DELETE /api/po/:poNumber'], PERMISSIONS.PO_DELETE_DRAFT);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/packages/materialise'], PERMISSIONS.PO_APPROVE);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/packages/materialise-from-po/:poNumber'], PERMISSIONS.PO_APPROVE);
  assert.equal(CRITICAL_ROUTE_PERMISSIONS['POST /api/commercial-events/import'], PERMISSIONS.CE_APPROVE);
});

test('commercial mutation surface denies before domain execution when permissions are absent', async () => {
  const app = createApp({authAdapter:createTestAuthAdapter({...principal,permissions:[]})});
  const id='00000000-0000-0000-0000-000000000010';
  const attempts = [
    ['post','/api/developments/dev-test/cvr/periods',PERMISSIONS.CVR_EDIT],
    ['patch',`/api/developments/dev-test/cvr/periods/${id}`,PERMISSIONS.CVR_EDIT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/submit`,PERMISSIONS.CVR_SUBMIT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/reject`,PERMISSIONS.CVR_REJECT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/development-budget-adoption`,PERMISSIONS.CVR_ADOPT],
    ['put',`/api/developments/dev-test/cvr/periods/${id}/inputs`,PERMISSIONS.CVR_EDIT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/inputs`,PERMISSIONS.CVR_EDIT],
    ['patch',`/api/developments/dev-test/cvr/periods/${id}/inputs/${id}`,PERMISSIONS.CVR_EDIT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/budget-import`,PERMISSIONS.CVR_EDIT],
    ['post',`/api/developments/dev-test/cvr/periods/${id}/prelims-adoption`,PERMISSIONS.CVR_ADOPT],
    ['post','/api/developments/dev-test/prelims-setup/apply',PERMISSIONS.CVR_EDIT],
    ['post','/api/developments/dev-test/prelims-items',PERMISSIONS.CVR_EDIT],
    ['put',`/api/developments/dev-test/prelims-items/${id}`,PERMISSIONS.CVR_EDIT],
    ['post','/api/commercial-events',PERMISSIONS.CE_CREATE],
    ['put','/api/commercial-events/ce-test',PERMISSIONS.CE_EDIT],
    ['post','/api/commercial-events/ce-test/submit',PERMISSIONS.CE_SUBMIT],
    ['patch','/api/commercial-events/ce-test/expected-liability',PERMISSIONS.CE_EXPECTED_TREATMENT],
    ['post','/api/commercial-events/ce-test/create-linked-recovery',PERMISSIONS.CE_EDIT],
    ['post','/api/variation-orders',PERMISSIONS.VO_CREATE],
    ['put',`/api/variation-orders/${id}`,PERMISSIONS.VO_EDIT],
    ['post',`/api/variation-orders/${id}/submit`,PERMISSIONS.VO_SUBMIT],
    ['post',`/api/variation-orders/${id}/reject`,PERMISSIONS.VO_APPROVE],
    ['put',`/api/packages/${id}/matrix`,PERMISSIONS.APPLICATION_RECORD],
    ['post',`/api/packages/${id}/payment-applications`,PERMISSIONS.APPLICATION_RECORD],
    ['post',`/api/packages/${id}/certificates`,PERMISSIONS.CERTIFICATE_CREATE],
    ['patch',`/api/packages/${id}/certificates/${id}`,PERMISSIONS.CERTIFICATE_EDIT],
    ['delete',`/api/packages/${id}/certificates/${id}`,PERMISSIONS.CERTIFICATE_DELETE_DRAFT],
    ['post',`/api/packages/${id}/certificates/${id}/payment-notices`,PERMISSIONS.PAYMENT_NOTICE_PREPARE],
    ['post',`/api/packages/${id}/certificates/${id}/pay-less-notices`,PERMISSIONS.PAY_LESS_PREPARE],
  ];
  for (const [method,route,permission] of attempts) {
    const response=await request(app)[method](route).send({actor:'Forged Actor',version:1});
    assert.equal(response.status,403,`${method.toUpperCase()} ${route}`);
    assert.match(response.body.message,new RegExp(permission.replace('.','\\.')));
  }
});

test('combined Variation Order approval and issue requires both authorities', async () => {
  const id='00000000-0000-0000-0000-000000000010';
  for (const permissions of [[PERMISSIONS.VO_APPROVE],[PERMISSIONS.VO_ISSUE]]) {
    const app=createApp({authAdapter:createTestAuthAdapter({...principal,permissions})});
    const response=await request(app).post(`/api/variation-orders/${id}/approve-and-issue`).send({actor:'Forged Actor'});
    assert.equal(response.status,403);
  }
});

test('critical-route manifest covers all approved commercial mutation permissions', () => {
  const values=Object.values(CRITICAL_ROUTE_PERMISSIONS).join('|');
  for (const permission of [
    PERMISSIONS.CE_CREATE,PERMISSIONS.CE_EDIT,PERMISSIONS.CE_SUBMIT,PERMISSIONS.CE_EXPECTED_TREATMENT,
    PERMISSIONS.VO_CREATE,PERMISSIONS.VO_EDIT,PERMISSIONS.VO_SUBMIT,PERMISSIONS.VO_APPROVE,
    PERMISSIONS.APPLICATION_RECORD,PERMISSIONS.CERTIFICATE_CREATE,PERMISSIONS.CERTIFICATE_EDIT,
    PERMISSIONS.CERTIFICATE_REJECT,PERMISSIONS.CERTIFICATE_DELETE_DRAFT,PERMISSIONS.INTENDED_PAYMENT_PROPOSE,
    PERMISSIONS.PAYMENT_NOTICE_PREPARE,PERMISSIONS.PAY_LESS_PREPARE,
    PERMISSIONS.CVR_EDIT,PERMISSIONS.CVR_ADOPT,PERMISSIONS.CVR_SUBMIT,PERMISSIONS.CVR_REJECT,PERMISSIONS.CVR_LOCK,
  ]) assert.match(values,new RegExp(permission.replace('.','\\.')));
});

test('Migration 031 retains the settled CVR role separation', async () => {
  const result = await pool.query(`SELECT r.key role_key,p.permission_key
    FROM role_permissions p JOIN roles r ON r.id=p.role_id
    WHERE p.permission_key=ANY($1::text[])`, [[PERMISSIONS.CVR_EDIT,PERMISSIONS.CVR_ADOPT,PERMISSIONS.CVR_SUBMIT,PERMISSIONS.CVR_REJECT,PERMISSIONS.CVR_LOCK]]);
  const grants = new Set(result.rows.map(row => `${row.role_key}:${row.permission_key}`));
  for (const role of ['qs','commercial_manager','commercial_director']) {
    for (const permission of [PERMISSIONS.CVR_EDIT,PERMISSIONS.CVR_ADOPT,PERMISSIONS.CVR_SUBMIT]) assert.ok(grants.has(`${role}:${permission}`));
  }
  for (const role of ['commercial_manager','commercial_director']) {
    for (const permission of [PERMISSIONS.CVR_REJECT,PERMISSIONS.CVR_LOCK]) assert.ok(grants.has(`${role}:${permission}`));
  }
  for (const role of ['site','buyer','admin','finance']) {
    for (const permission of [PERMISSIONS.CVR_EDIT,PERMISSIONS.CVR_ADOPT,PERMISSIONS.CVR_SUBMIT,PERMISSIONS.CVR_REJECT,PERMISSIONS.CVR_LOCK]) assert.equal(grants.has(`${role}:${permission}`),false);
  }
  assert.equal(grants.has(`qs:${PERMISSIONS.CVR_REJECT}`),false);
  assert.equal(grants.has(`qs:${PERMISSIONS.CVR_LOCK}`),false);
});

test('CVR and Development Prelims services deny direct mutation without matching authority', async () => {
  const deniedAuth={...principal,permissions:[]};
  const id='00000000-0000-0000-0000-000000000010';
  const period=require('../services/cvrPeriodRepository');
  const budgetImport=require('../services/cvrBudgetImportService');
  const prelimsAdoption=require('../services/prelimsAdoptionApplyService');
  const prelimsItems=require('../services/prelimsItemRepository');
  const prelimsSetup=require('../services/prelimsSetupService');
  const sellingCostsAdoption=require('../services/sellingCostsAdoptionApplyService');
  const cvrMembership=require('../services/cvrMembershipService');
  const calls=[
    [()=>period.createCvrPeriod('client-1','dev-1',{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>period.patchCvrPeriod('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>period.submitCvrPeriod('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_SUBMIT],
    [()=>period.rejectCvrPeriod('client-1','dev-1',id,{comment:'No'}, {auth:deniedAuth}),PERMISSIONS.CVR_REJECT],
    [()=>period.adoptDevelopmentBudget('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_ADOPT],
    [()=>period.createCostCodeInput('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>period.patchCostCodeInput('client-1','dev-1',id,id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>period.upsertCostCodeInputs('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>budgetImport.importDraftCvrBudget('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>prelimsAdoption.adoptPrelimsForecasts('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_ADOPT],
    [()=>prelimsItems.createPrelimsItem('client-1','dev-1',{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>prelimsItems.updatePrelimsItem('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>prelimsSetup.applyPrelimsSetup('client-1','dev-1',{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
    [()=>sellingCostsAdoption.adoptSellingCostsForecasts('client-1','dev-1',{}, {auth:deniedAuth}),PERMISSIONS.CVR_ADOPT],
    [()=>cvrMembership.addDraftCvrCostCodeMember('client-1','dev-1',id,{}, {auth:deniedAuth}),PERMISSIONS.CVR_EDIT],
  ];
  for (const [call,permission] of calls) await assert.rejects(call,error=>error.status===403&&error.message.includes(permission));
});
