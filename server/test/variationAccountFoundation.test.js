const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const request=require('supertest');
const {pool,isDbConfigured}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const repository=require('../services/variationAccountRepository');
const createApp=require('../app');
const {createTestAuthAdapter}=require('../auth/authAdapters');
const {PERMISSIONS}=require('../auth/permissions');

const migration=name=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8');
const migration033=migration('033_package_variation_account.sql');
const createdClients=[];
const createdUsers=[];
let a,b,qsAuth,adminAuth;

async function seed(label,roleKey='qs') {
  const client=(await pool.query('INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *',[`VA_${label}_${randomUUID().slice(0,6)}`,`VA ${label}`])).rows[0];
  createdClients.push(client.id);
  const development=`dev-va-${label}-${randomUUID()}`;
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')",[development,client.id,`VA-${label}`,`VA Development ${label}`]);
  const pkg=(await pool.query("INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,$3,'4330',$4) RETURNING *",[client.id,development,`supplier-${label}`,`subcontract:${randomUUID()}`])).rows[0];
  const user=(await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,$3,'active') RETURNING *",[`provider-${randomUUID()}`,`${label}@example.test`,`VA ${label}`])).rows[0];
  createdUsers.push(user.id);
  const role=(await pool.query('SELECT id FROM roles WHERE key=$1',[roleKey])).rows[0];
  const membership=(await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *',[client.id,user.id,role.id])).rows[0];
  const permissions=(await pool.query('SELECT permission_key FROM role_permissions WHERE role_id=$1',[role.id])).rows.map(row=>row.permission_key);
  return {client,development,pkg,user,membership,auth:{userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,roleKey,clientId:client.id,permissions}};
}

test('Migration 033 is additive, leaves Migration 032 facts untouched and adds no financial integration',()=>{
  for(const table of ['package_variation_account_items','package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_lifecycle_audit','package_variation_account_payment_discovered_links'])assert.match(migration033,new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`,'i'));
  assert.match(migration033,/Existing Migration 032 facts are not backfilled or reinterpreted/i);
  assert.doesNotMatch(migration033,/UPDATE\s+(package_payment_certificates|commercial_events|variation_orders|cvr_)/i);
  assert.doesNotMatch(migration033,/INSERT INTO package_variation_account_items\s+SELECT/i);
  for(const table of ['purchase_orders','package_payment_certificates','commercial_events','variation_orders','cvr_periods','package_payment_notices','commercial_documents'])assert.doesNotMatch(migration033,new RegExp(`ALTER TABLE\\s+${table}`,'i'));
});

test.before(async()=>{
  if(!isDbConfigured())return;
  await prepareIntegrationTestDatabase(pool);
  for(const name of ['004_developments.sql','005_packages.sql','006_commercial_events.sql','008_package_payment_certificates.sql','023_variation_orders.sql','031_rbac_identity_foundation.sql','032_payment_certificate_source_authority.sql'])await pool.query(migration(name));
  const before032=Number((await pool.query('SELECT count(*) n FROM package_payment_discovered_items')).rows[0].n);
  await pool.query(migration033);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM package_payment_discovered_items')).rows[0].n),before032);
  a=await seed('A');b=await seed('B');qsAuth=a.auth;
  const adminRole=(await pool.query("SELECT id FROM roles WHERE key='admin'")).rows[0];
  adminAuth={...qsAuth,roleKey:'admin',permissions:(await pool.query('SELECT permission_key FROM role_permissions WHERE role_id=$1',[adminRole.id])).rows.map(row=>row.permission_key)};
});

test.after(async()=>{
  if(!isDbConfigured()||!createdClients.length)return;
  for(const table of ['package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_lifecycle_audit','package_variation_account_payment_discovered_links','package_variation_account_items','authorization_action_audit'])await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  await pool.query('DELETE FROM package_variation_account_payment_discovered_links WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM package_variation_account_forecast_history WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM package_variation_account_contractor_positions WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM package_variation_account_lifecycle_audit WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM package_variation_account_items WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM authorization_action_audit WHERE client_id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[createdClients]);
  await pool.query('DELETE FROM buildlite_users WHERE id=ANY($1::uuid[])',[createdUsers]);
  for(const table of ['package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_lifecycle_audit','package_variation_account_payment_discovered_links','package_variation_account_items','authorization_action_audit'])await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
});

test('Migration 033 applies with zero invented account/link rows and correct lean role grants',async t=>{
  if(!isDbConfigured())return t.skip();
  assert.equal(Number((await pool.query('SELECT count(*) n FROM package_variation_account_items WHERE client_id=ANY($1::uuid[])',[createdClients])).rows[0].n),0);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM package_variation_account_payment_discovered_links WHERE client_id=ANY($1::uuid[])',[createdClients])).rows[0].n),0);
  for(const role of ['qs','commercial_manager','commercial_director']){
    const permissions=(await pool.query("SELECT permission_key FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key=$1 AND rp.permission_key LIKE 'variation_account.%'",[role])).rows.map(row=>row.permission_key);
    for(const required of ['variation_account.view','variation_account.create','variation_account.forecast_edit','variation_account.resolve'])assert.ok(permissions.includes(required));
  }
  assert.equal(Number((await pool.query("SELECT count(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key='admin' AND rp.permission_key='variation_account.view'")).rows[0].n),1);
  assert.equal(Number((await pool.query("SELECT count(*) n FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.key='admin' AND rp.permission_key IN ('variation_account.create','variation_account.forecast_edit','variation_account.resolve','variation_account.assess','variation_account.authority_allocate')")).rows[0].n),0);
});

test('QS creates positive variation and negative credit with stable package numbering and distinct values',async t=>{
  if(!isDbConfigured())return t.skip();
  const positive=await repository.createItem(a.client.id,a.pkg.id,{description:'Drainage design changes',contractorReference:'GW-VAR-01',contractorValue:20000,qsForecast:17000,reason:'QS assessment'},qsAuth);
  assert.equal(positive.ok,true,positive.message);assert.equal(positive.item.reference,'VA-0001');assert.equal(positive.item.contractorValue,20000);assert.equal(positive.item.qsForecast,17000);assert.equal(positive.item.forecastHistory.length,1);assert.equal(positive.item.contractorPositionHistory.length,1);assert.equal(positive.item.createdBy.providerUserId,qsAuth.providerUserId);
  const credit=await repository.createItem(a.client.id,a.pkg.id,{description:'Omitted scope credit',contractorValue:-3000,qsForecast:-2500,reason:'Credit assessment'},qsAuth);
  assert.equal(credit.item.reference,'VA-0002');assert.equal(credit.item.qsForecast,-2500);
  const other=await repository.createItem(b.client.id,b.pkg.id,{description:'Tenant B variation',qsForecast:500,reason:'Initial assessment'},b.auth);
  assert.equal(other.item.reference,'VA-0001');
  assert.equal(await repository.getItem(b.client.id,positive.item.id,b.auth),null);
});

test('QS Forecast and confirmed contractor changes append immutable histories',async t=>{
  if(!isDbConfigured())return t.skip();
  let item=(await repository.createItem(a.client.id,a.pkg.id,{description:'History test',contractorValue:10000,qsForecast:8000,reason:'Initial'},qsAuth)).item;
  const protectedBefore={
    contractorValue:item.contractorValue,
    allocations:Number((await pool.query('SELECT count(*) n FROM package_variation_account_authority_allocations WHERE variation_account_item_id=$1',[item.id])).rows[0].n),
    assessments:Number((await pool.query('SELECT count(*) n FROM package_variation_account_certificate_assessments WHERE variation_account_item_id=$1',[item.id])).rows[0].n),
    commercialEvents:Number((await pool.query('SELECT count(*) n FROM commercial_events WHERE client_id=$1 AND package_id=$2',[a.client.id,a.pkg.id])).rows[0].n),
    variationOrders:Number((await pool.query('SELECT count(*) n FROM variation_orders WHERE client_id=$1 AND package_id=$2',[a.client.id,a.pkg.id])).rows[0].n),
  };
  item=(await repository.updateForecast(a.client.id,item.id,{version:item.version,qsForecast:7500,reason:'Risk reassessed'},qsAuth)).item;
  assert.equal(item.qsForecast,7500);assert.equal(item.version,2);assert.deepEqual(item.forecastHistory.map(row=>row.newValue),[8000,7500]);assert.equal(item.contractorValue,10000);
  assert.equal(item.forecastHistory[1].priorValue,8000);assert.equal(item.forecastHistory[1].reason,'Risk reassessed');assert.equal(item.forecastHistory[1].itemVersion,2);
  assert.equal(item.forecastHistory[1].actor.userId,qsAuth.userId);assert.equal(item.forecastHistory[1].actor.membershipId,qsAuth.membershipId);assert.equal(item.forecastHistory[1].actor.providerUserId,qsAuth.providerUserId);
  const protectedAfter={
    contractorValue:item.contractorValue,
    allocations:Number((await pool.query('SELECT count(*) n FROM package_variation_account_authority_allocations WHERE variation_account_item_id=$1',[item.id])).rows[0].n),
    assessments:Number((await pool.query('SELECT count(*) n FROM package_variation_account_certificate_assessments WHERE variation_account_item_id=$1',[item.id])).rows[0].n),
    commercialEvents:Number((await pool.query('SELECT count(*) n FROM commercial_events WHERE client_id=$1 AND package_id=$2',[a.client.id,a.pkg.id])).rows[0].n),
    variationOrders:Number((await pool.query('SELECT count(*) n FROM variation_orders WHERE client_id=$1 AND package_id=$2',[a.client.id,a.pkg.id])).rows[0].n),
  };
  assert.deepEqual(protectedAfter,protectedBefore);
  item=(await repository.recordContractorPosition(a.client.id,item.id,{version:item.version,contractorValue:12000,contractorReference:'REV-2',reason:'QS reconciled revised application'},qsAuth)).item;
  assert.equal(item.contractorValue,12000);assert.equal(item.qsForecast,7500);assert.deepEqual(item.contractorPositionHistory.map(row=>row.value),[10000,12000]);
  await assert.rejects(pool.query('UPDATE package_variation_account_forecast_history SET reason=$1 WHERE variation_account_item_id=$2',['rewrite',item.id]),/append-only/);
});

test('explicit resolve and reopen require reason, version and append lifecycle evidence',async t=>{
  if(!isDbConfigured())return t.skip();
  let item=(await repository.createItem(a.client.id,a.pkg.id,{description:'Lifecycle test',qsForecast:0,reason:'Initial'},qsAuth)).item;
  assert.equal((await repository.transitionItem(a.client.id,item.id,'resolve',{version:item.version},qsAuth)).status,400);
  item=(await repository.transitionItem(a.client.id,item.id,'resolve',{version:item.version,reason:'Commercially resolved'},qsAuth)).item;assert.equal(item.status,'resolved');
  item=(await repository.transitionItem(a.client.id,item.id,'reopen',{version:item.version,reason:'Further exposure identified'},qsAuth)).item;assert.equal(item.status,'active');
  assert.deepEqual(item.lifecycleHistory.map(row=>row.action),['created','resolved','reopened']);
});

test('RBAC defaults deny; QS is permitted and Admin gains no Variation Account financial action',async t=>{
  if(!isDbConfigured())return t.skip();
  await assert.rejects(()=>repository.createItem(a.client.id,a.pkg.id,{description:'Denied',qsForecast:1},{...qsAuth,permissions:[]}),error=>error.status===403);
  await assert.rejects(()=>repository.updateForecast(a.client.id,randomUUID(),{version:1,qsForecast:1,reason:'Denied'},adminAuth),error=>error.status===403);
  const app=createApp({authAdapter:createTestAuthAdapter({...adminAuth,clientId:a.client.id})});
  const response=await request(app).post('/api/variation-account').set('X-BuildLite-Client-Id',a.client.id).send({packageId:a.pkg.id,description:'Forged',qsForecast:100});
  assert.equal(response.status,403);assert.match(response.body.message,/variation_account\.create/);
});

test('authenticated tenant route creates and reads only its package Variation Account',async t=>{
  if(!isDbConfigured())return t.skip();
  const app=createApp({authAdapter:createTestAuthAdapter(qsAuth)});
  const created=await request(app).post('/api/variation-account').set('X-BuildLite-Client-Id',a.client.id).send({packageId:a.pkg.id,description:'Route-created variation',contractorValue:20000,qsForecast:17000,reason:'Route QS assessment'});
  assert.equal(created.status,201,created.text);assert.equal(created.body.item.qsForecast,17000);
  const listed=await request(app).get(`/api/variation-account?packageId=${a.pkg.id}`).set('X-BuildLite-Client-Id',a.client.id);
  assert.equal(listed.status,200,listed.text);assert.ok(listed.body.items.some(item=>item.id===created.body.item.id));
  const cross=await request(app).get(`/api/variation-account?packageId=${b.pkg.id}`).set('X-BuildLite-Client-Id',a.client.id);
  assert.equal(cross.status,200);assert.deepEqual(cross.body.items,[]);
});
