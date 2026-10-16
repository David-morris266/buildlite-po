const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('node:crypto');
const createApp = require('../app');
const { pool } = require('../db');
const { createTestAuthAdapter } = require('../auth/authAdapters');
const termsRepository = require('../services/subcontractTermsRepository');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');

const clients=[];
const users=[];
const completeRules={configurationState:'complete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'},notice:{paymentNoticeMode:'separate_payment_notice',paymentNoticeIssuer:'company',certificateDocumentConstitutesNotice:false,basisOfCalculationRequired:true,paymentNoticeDocumentIdentity:'payment_notice',payLessIssuer:'company',payLessWorkflowSupported:true}};

async function tenant(label,active=false){
  const client=(await pool.query(`INSERT INTO clients(code,name,is_active) VALUES($1,$2,$3) RETURNING *`,[`TERMS_${label}_${randomUUID().slice(0,6)}`,`Terms ${label}`,active])).rows[0];
  clients.push(client.id);
  const developmentId=`dev-terms-${randomUUID()}`;
  const poNumber=`T-${randomUUID().slice(0,8)}`;
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')`,[developmentId,client.id,label,`Terms ${label}`]);
  await pool.query(`INSERT INTO purchase_orders(po_number,client_id,payload) VALUES($1,$2,$3)`,[poNumber,client.id,JSON.stringify({poNumber,status:'Draft',developmentId})]);
  const draft=await termsRepository.createFamily(client.id,{name:`Terms ${label}`,rulesSchemaVersion:2,paymentRules:completeRules,actor:'Fixture'});
  const published=await termsRepository.publish(client.id,draft.version.id,{actor:'Fixture'});
  const unpublished=await termsRepository.createFamily(client.id,{name:`Draft ${label}`,rulesSchemaVersion:2,paymentRules:completeRules,actor:'Fixture'});
  return {client,developmentId,poNumber,published:published.version,unpublished:unpublished.version};
}

async function principal(clientId,roleKey){
  const role=(await pool.query(`SELECT r.*,array_agg(rp.permission_key ORDER BY rp.permission_key) permissions FROM roles r JOIN role_permissions rp ON rp.role_id=r.id WHERE r.key=$1 GROUP BY r.id`,[roleKey])).rows[0];
  const providerUserId=`terms-${roleKey}-${randomUUID()}`;
  const user=(await pool.query(`INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,$2,$3,'active') RETURNING *`,[providerUserId,`${providerUserId}@example.test`,`Terms ${role.name}`])).rows[0];
  users.push(user.id);
  const membership=(await pool.query(`INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *`,[clientId,user.id,role.id])).rows[0];
  return {userId:user.id,providerUserId,displayName:`Terms ${role.name}`,clientId,membershipId:membership.id,roleKey,roleName:role.name,permissions:role.permissions,memberships:[],platformPermissions:[]};
}

test.before(async()=>prepareIntegrationTestDatabase(pool));
test.after(async()=>{
  if(clients.length){
    await pool.query('ALTER TABLE authorization_action_audit DISABLE TRIGGER USER');
    await pool.query('DELETE FROM authorization_action_audit WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('ALTER TABLE authorization_action_audit ENABLE TRIGGER USER');
    await pool.query('DELETE FROM subcontract_terms_audit WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM purchase_order_terms_overrides WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM development_subcontract_terms_defaults WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM client_subcontract_terms_defaults WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM subcontract_terms_versions WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM subcontract_terms_families WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM purchase_orders WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM developments WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM client_user_memberships WHERE client_id=ANY($1::uuid[])',[clients]);
    await pool.query('DELETE FROM clients WHERE id=ANY($1::uuid[])',[clients]);
  }
  if(users.length)await pool.query('DELETE FROM buildlite_users WHERE id=ANY($1::uuid[])',[users]);
});

test('published terms assignment is permissioned, tenant-scoped and fail-closed',async()=>{
  const a=await tenant('A',true),b=await tenant('B');
  const director=await principal(a.client.id,'commercial_director');
  const site=await principal(a.client.id,'site');
  const foreignDirector=await principal(b.client.id,'commercial_director');
  const directorApp=createApp({authAdapter:createTestAuthAdapter(director)});
  const siteApp=createApp({authAdapter:createTestAuthAdapter(site)});
  const foreignApp=createApp({authAdapter:createTestAuthAdapter(foreignDirector)});

  let response=await request(directorApp).put(`/api/subcontract-terms/purchase-orders/${a.poNumber}/override`).send({termsVersionId:a.published.id,reason:'Governed assignment'});
  assert.equal(response.status,200,response.body?.message);
  let assigned=(await pool.query('SELECT * FROM purchase_order_terms_overrides WHERE client_id=$1 AND po_number=$2',[a.client.id,a.poNumber])).rows[0];
  assert.equal(assigned.terms_version_id,a.published.id);
  assert.equal(assigned.assigned_by,director.displayName);

  const before={override:assigned.terms_version_id,audit:Number((await pool.query('SELECT count(*) n FROM subcontract_terms_audit WHERE client_id=$1',[a.client.id])).rows[0].n)};
  response=await request(siteApp).put(`/api/subcontract-terms/purchase-orders/${a.poNumber}/override`).send({termsVersionId:a.unpublished.id,reason:'Denied'});
  assert.equal(response.status,403);
  response=await request(directorApp).put(`/api/subcontract-terms/purchase-orders/${a.poNumber}/override`).send({termsVersionId:a.unpublished.id,reason:'Draft must fail'});
  assert.equal(response.status,400);
  response=await request(foreignApp).put(`/api/subcontract-terms/purchase-orders/${a.poNumber}/override`).send({termsVersionId:b.published.id,reason:'Cross tenant'});
  assert.ok([403,404].includes(response.status),response.body?.message);
  assigned=(await pool.query('SELECT * FROM purchase_order_terms_overrides WHERE client_id=$1 AND po_number=$2',[a.client.id,a.poNumber])).rows[0];
  assert.equal(assigned.terms_version_id,before.override);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM subcontract_terms_audit WHERE client_id=$1',[a.client.id])).rows[0].n),before.audit);

  response=await request(directorApp).put(`/api/subcontract-terms/developments/${a.developmentId}/default`).send({termsVersionId:a.published.id});
  assert.equal(response.status,200,response.body?.message);
  assert.equal((await pool.query('SELECT terms_version_id FROM development_subcontract_terms_defaults WHERE client_id=$1 AND development_id=$2',[a.client.id,a.developmentId])).rows[0].terms_version_id,a.published.id);
});
