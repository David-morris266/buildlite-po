const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const request=require('supertest');
const {pool}=require('../db');
const createApp=require('../app');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const {isDbConfigured}=require('../utils/env');
const {buildReviewDocument}=require('../services/plotTenureReview');

test('24 exact Open Market sources form one suggested but unresolved cohort',()=>{
  const plots=Array.from({length:24},(_,i)=>({id:`plot-${i+1}`,plotNumber:String(i+1),tenure:'Open Market'}));
  const review=buildReviewDocument({id:'dev-hawthorn',version:3,plotMaster:{plots}});
  assert.equal(review.reviewed,0);assert.equal(review.needsAttention,24);assert.equal(review.cohorts.length,1);
  assert.equal(review.cohorts[0].suggestedTenureCode,'OPEN_MARKET');assert.equal(review.cohorts[0].plots.every(plot=>plot.tenureCode==='UNREVIEWED'),true);
});

test('Migration 056 is zero-backfill, append-only and grants only approved roles',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'..','migrations','056_plot_master_tenure_review.sql'),'utf8');
  assert.match(sql,/plot_master\.manage/);assert.match(sql,/commercial_director/);assert.match(sql,/commercial_manager/);assert.match(sql,/\bqs\b/);assert.match(sql,/\badmin\b/);
  assert.doesNotMatch(sql,/\bbuyer\b|\bsite\b/i);assert.doesNotMatch(sql,/UPDATE\s+developments/i);assert.match(sql,/BEFORE UPDATE OR DELETE ON plot_tenure_review_audit/i);
});

test('authenticated atomic review records audit and stale/source-changed requests fail closed',async t=>{
  if(!isDbConfigured())return t.skip();await prepareIntegrationTestDatabase(pool);
  const grants=await pool.query("SELECT r.key FROM roles r JOIN role_permissions rp ON rp.role_id=r.id WHERE rp.permission_key='plot_master.manage' ORDER BY r.key");assert.deepEqual(grants.rows.map(row=>row.key),['admin','commercial_director','commercial_manager','qs']);
  const clientId=randomUUID(),userId=randomUUID(),membershipId=randomUUID(),developmentId=`dev-tenure-${randomUUID()}`;
  const role=(await pool.query("SELECT id FROM roles WHERE key='commercial_manager'")).rows[0];
  await pool.query("INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,$3,false)",[clientId,`TEN-${Date.now()}`,'Tenure test']);
  await pool.query("INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'tenure@test.invalid','Real Reviewer','active')",[userId,`tenure-${randomUUID()}`]);
  await pool.query('INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)',[membershipId,clientId,userId,role.id]);
  const plots=[{id:'p1',plotNumber:'1',tenure:'Open Market',tenureCode:'UNREVIEWED'},{id:'p2',plotNumber:'2',tenure:'Open Market',tenureCode:'UNREVIEWED'}];
  await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload,version) VALUES($1,$2,'TEN-1','Tenure','live',$3,1)",[developmentId,clientId,JSON.stringify({plotMaster:{plots}})]);
  const principal={userId,providerUserId:`tenure-${randomUUID()}`,displayName:'Real Reviewer',clientId,membershipId,roleKey:'commercial_manager',roleName:'Commercial Manager',permissions:['commercial.read','plot_master.manage'],memberships:[]};
  await pool.query('UPDATE buildlite_users SET provider_user_id=$1 WHERE id=$2',[principal.providerUserId,userId]);
  const app=createApp({testPrincipal:principal});
  {
    const loaded=await request(app).get(`/api/developments/${developmentId}/plot-tenure-review`);assert.equal(loaded.status,200);
    const decisions=loaded.body.cohorts[0].plots.map(plot=>({plotId:plot.id,sourceTenure:plot.sourceTenure,sourceFingerprint:plot.sourceFingerprint,previousTenureCode:plot.tenureCode,resultingTenureCode:plot.id==='p2'?'AFFORDABLE_RENT':'OPEN_MARKET'}));
    const applied=await request(app).post(`/api/developments/${developmentId}/plot-tenure-review/apply`).send({developmentVersion:1,decisions,actor:'Spoofed'});assert.equal(applied.status,200);assert.equal(applied.body.applied,2);assert.equal(applied.body.development.version,2);
    const audit=await pool.query('SELECT * FROM plot_tenure_review_audit WHERE client_id=$1 ORDER BY plot_id',[clientId]);assert.equal(audit.rowCount,2);assert.equal(audit.rows.every(row=>row.actor_display_name==='Real Reviewer'&&row.actor_membership_id===membershipId),true);
    const stale=await request(app).post(`/api/developments/${developmentId}/plot-tenure-review/apply`).send({developmentVersion:1,decisions});assert.equal(stale.status,409);
    const current=await request(app).get(`/api/developments/${developmentId}/plot-tenure-review`);const changedSource=[...current.body.cohorts[0].plots].map((plot,index)=>({plotId:plot.id,sourceTenure:plot.sourceTenure,sourceFingerprint:index===0?'0'.repeat(64):plot.sourceFingerprint,previousTenureCode:plot.tenureCode,resultingTenureCode:index===0?'OTHER':'OPEN_MARKET'}));const sourceConflict=await request(app).post(`/api/developments/${developmentId}/plot-tenure-review/apply`).send({developmentVersion:2,decisions:changedSource});assert.equal(sourceConflict.status,409);
    assert.equal((await pool.query('SELECT count(*)::int n FROM plot_tenure_review_audit WHERE client_id=$1',[clientId])).rows[0].n,2);
    const denied=createApp({testPrincipal:{...principal,roleKey:'buyer',permissions:['commercial.read']}});assert.equal((await request(denied).post(`/api/developments/${developmentId}/plot-tenure-review/apply`).send({developmentVersion:2,decisions})).status,403);
  }
});
