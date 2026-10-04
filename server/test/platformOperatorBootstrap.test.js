const test=require('node:test');
const assert=require('node:assert/strict');
const request=require('supertest');
const {randomUUID}=require('crypto');
const createApp=require('../app');
const {createTestAuthAdapter}=require('../auth/authAdapters');
const {pool}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');

const providerUserId=`platform-${randomUUID()}`;
const email=`platform-${randomUUID()}@test.invalid`;
const identity={provider:'clerk',providerUserId,email,displayName:'First Platform Operator'};
const priorAllowlist=process.env.BUILDLITE_PLATFORM_OPERATOR_IDS;
let clientId;

function productionShapedAdapter(value=identity){
  const adapter=createTestAuthAdapter(value);
  delete adapter.principal;
  return adapter;
}

test.before(async()=>{await prepareIntegrationTestDatabase(pool);});
test.after(async()=>{
  if(clientId){
    await pool.query('ALTER TABLE tenant_membership_authority_audit DISABLE TRIGGER USER');
    await pool.query('ALTER TABLE tenant_provisioning_audit DISABLE TRIGGER USER');
    await pool.query('DELETE FROM tenant_membership_authority_audit WHERE client_id=$1',[clientId]);
    await pool.query('DELETE FROM tenant_provisioning_audit WHERE client_id=$1',[clientId]);
    await pool.query('ALTER TABLE tenant_membership_authority_audit ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE tenant_provisioning_audit ENABLE TRIGGER USER');
    await pool.query('DELETE FROM tenant_company_settings WHERE client_id=$1',[clientId]);
    await pool.query('DELETE FROM client_user_membership_capabilities WHERE client_id=$1',[clientId]);
    await pool.query('DELETE FROM client_user_memberships WHERE client_id=$1',[clientId]);
    await pool.query('DELETE FROM client_brand_profiles WHERE client_id=$1',[clientId]);
    await pool.query('DELETE FROM clients WHERE id=$1',[clientId]);
  }
  await pool.query('ALTER TABLE platform_identity_bootstrap_audit DISABLE TRIGGER USER');
  await pool.query('DELETE FROM platform_identity_bootstrap_audit WHERE provider_user_id=$1',[providerUserId]);
  await pool.query('ALTER TABLE platform_identity_bootstrap_audit ENABLE TRIGGER USER');
  await pool.query(`DELETE FROM buildlite_users WHERE auth_provider='clerk' AND provider_user_id=$1`,[providerUserId]);
  if(priorAllowlist===undefined)delete process.env.BUILDLITE_PLATFORM_OPERATOR_IDS;else process.env.BUILDLITE_PLATFORM_OPERATOR_IDS=priorAllowlist;
});

test('first allowlisted verified Clerk operator bootstraps once, stays tenantless, then provisions through normal authority',async()=>{
  delete process.env.BUILDLITE_PLATFORM_OPERATOR_IDS;
  const denied=await request(createApp({authAdapter:productionShapedAdapter()})).get('/api/auth/me');
  assert.equal(denied.status,403);
  assert.match(denied.body.message,/inactive or not provisioned/i);
  assert.equal(Number((await pool.query(`SELECT count(*) count FROM buildlite_users WHERE provider_user_id=$1`,[providerUserId])).rows[0].count),0);

  process.env.BUILDLITE_PLATFORM_OPERATOR_IDS=providerUserId;
  const app=createApp({authAdapter:productionShapedAdapter()});
  const first=await request(app).get('/api/auth/me');
  assert.equal(first.status,200);
  assert.equal(first.body.platformOnly,true);
  assert.equal(first.body.activeTenant,null);
  assert.deepEqual(first.body.permissions,[]);
  assert.deepEqual(first.body.memberships,[]);
  assert.deepEqual(first.body.platformPermissions,['platform.tenant_provision']);
  const userId=first.body.user.id;
  assert.equal(Number((await pool.query('SELECT count(*) count FROM client_user_memberships WHERE user_id=$1',[userId])).rows[0].count),0);

  const repeated=await request(app).get('/api/auth/me');
  assert.equal(repeated.status,200);
  assert.equal(repeated.body.user.id,userId);
  assert.equal(Number((await pool.query(`SELECT count(*) count FROM buildlite_users WHERE provider_user_id=$1`,[providerUserId])).rows[0].count),1);
  assert.equal(Number((await pool.query(`SELECT count(*) count FROM platform_identity_bootstrap_audit WHERE provider_user_id=$1`,[providerUserId])).rows[0].count),1);
  await assert.rejects(pool.query(`UPDATE platform_identity_bootstrap_audit SET display_name='Changed' WHERE provider_user_id=$1`,[providerUserId]),/append-only/);

  assert.equal((await request(app).get('/api/developments')).status,403);
  assert.equal((await request(app).get('/api/auth/me').set('X-BuildLite-Client-Id',randomUUID())).status,403);

  const provisioned=await request(app).post('/api/platform/tenants').send({tenantName:'First Controlled Company',tenantCode:`first_${randomUUID().slice(0,8)}`,initialUserEmail:email,initialRoleKey:'commercial_director',idempotencyKey:randomUUID()});
  assert.equal(provisioned.status,201);
  clientId=provisioned.body.tenant.id;
  assert.equal(provisioned.body.membership.roleKey,'commercial_director');
  assert.deepEqual(provisioned.body.membership.capabilityKeys,['company_administration']);

  const normal=await request(app).get('/api/auth/me');
  assert.equal(normal.status,200);
  assert.equal(normal.body.platformOnly,undefined);
  assert.equal(normal.body.activeTenant.clientId,clientId);
  assert(normal.body.permissions.includes('commercial.read'));
  assert(normal.body.permissions.includes('users.manage'));
  assert.deepEqual(normal.body.platformPermissions,['platform.tenant_provision']);
  assert.equal(Number((await pool.query('SELECT count(*) count FROM tenant_provisioning_audit WHERE client_id=$1',[clientId])).rows[0].count),1);
  assert.equal(Number((await pool.query(`SELECT count(*) count FROM tenant_membership_authority_audit WHERE client_id=$1 AND operation='bootstrap_admin_established'`,[clientId])).rows[0].count),1);
});

test('allowlisted bootstrap requires verified Clerk evidence and fails closed on identity conflict',async()=>{
  const unverifiedId=`unverified-${randomUUID()}`;
  process.env.BUILDLITE_PLATFORM_OPERATOR_IDS=unverifiedId;
  const missingEvidence={middleware(_req,_res,next){next();},identity(){return {provider:'clerk',providerUserId:unverifiedId};},async verifiedIdentity(){return null;}};
  assert.equal((await request(createApp({authAdapter:missingEvidence})).get('/api/auth/me')).status,403);
  assert.equal(Number((await pool.query('SELECT count(*) count FROM buildlite_users WHERE provider_user_id=$1',[unverifiedId])).rows[0].count),0);

  const conflictId=`conflict-${randomUUID()}`,conflictEmail=`conflict-${randomUUID()}@test.invalid`;
  await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,'Existing Identity','active')`,[`existing-${randomUUID()}`,conflictEmail]);
  process.env.BUILDLITE_PLATFORM_OPERATOR_IDS=conflictId;
  const conflict=await request(createApp({authAdapter:productionShapedAdapter({provider:'clerk',providerUserId:conflictId,email:conflictEmail,displayName:'Conflicting Identity'})})).get('/api/auth/me');
  assert.equal(conflict.status,409);
  assert.equal(Number((await pool.query('SELECT count(*) count FROM buildlite_users WHERE provider_user_id=$1',[conflictId])).rows[0].count),0);
  await pool.query('DELETE FROM buildlite_users WHERE email_snapshot=$1',[conflictEmail]);
});
