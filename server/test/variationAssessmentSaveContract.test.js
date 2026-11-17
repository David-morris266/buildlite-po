// Exercise the existing repository using a query adapter; no database or migrations.
const test = require('node:test');
const assert = require('node:assert/strict');
let calls, saved, certificateStatus, validLine;
const auth = {userId:'user',membershipId:'member',providerUserId:'provider',displayName:'QS',permissions:['variation_account.assess']};
const body = {variationAccountItemId:'va',applicationVariationLineId:'claim',currentAssessment:6200,basis:'Measured completed work'};
const db = {release(){},async query(sql,params){
  calls.push({sql,params});
  if(sql.startsWith('SELECT c.*,p.development_id'))return {rows:[{id:'cert',development_id:'dev',status:certificateStatus,certificate_number:1}]};
  if(sql.startsWith('SELECT * FROM package_variation_account_items'))return {rows:[{id:'va',status:'active',current_qs_forecast:6200,current_contractor_value:8500}]};
  if(sql.startsWith('SELECT COALESCE(SUM'))return {rows:[{total:0}]};
  if(sql.startsWith('SELECT l.*'))return {rows:validLine?[{id:'claim',cumulative_claim:8500}]:[]};
  if(sql.startsWith('SELECT * FROM package_variation_account_certificate_assessments'))return {rows:saved?[saved]:[]};
  if(sql.startsWith('INSERT INTO package_variation_account_certificate_assessments(')){
    saved={id:'assessment',client_id:params[0],development_id:params[1],package_id:params[2],certificate_id:params[3],variation_account_item_id:params[4],application_variation_line_id:params[5],signed_current_assessment:params[6],assessment_basis:params[7],status:'draft',version:1};
    return {rows:[saved]};
  }
  if(sql.startsWith('UPDATE package_variation_account_certificate_assessments SET')){
    saved={...saved,application_variation_line_id:params[0],signed_current_assessment:params[1],assessment_basis:params[2],version:saved.version+1};return {rows:[saved]};
  }
  return {rows:[]};
}};
const dbPath=require.resolve('../db');
require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{pool:{connect:async()=>db},query:db.query.bind(db)}};
const repo=require('../services/variationAccountCertificateAssessmentRepository');
test.beforeEach(()=>{calls=[];saved=null;certificateStatus='draft';validLine=true;});
test('6200 saves against the existing VA and exact claim, with audit, and updates without duplication',async()=>{
  let result=await repo.saveAssessment('tenant','package','cert',body,auth);
  assert.equal(result.ok,true);assert.equal(result.assessment.currentAssessment,6200);assert.equal(result.assessment.cumulativeCertified,6200);assert.equal(result.assessment.applicationVariationLineId,'claim');
  result=await repo.saveAssessment('tenant','package','cert',{...body,currentAssessment:6000,basis:'Revised measurement'},auth);
  assert.equal(result.assessment.id,'assessment');assert.equal(result.assessment.currentAssessment,6000);assert.equal(result.assessment.version,2);
  assert.equal(calls.filter(c=>c.sql.startsWith('INSERT INTO package_variation_account_certificate_assessments(')).length,1);
  assert.equal(calls.filter(c=>c.sql.startsWith('UPDATE package_variation_account_certificate_assessments SET')).length,1);
  assert.equal(calls.filter(c=>c.sql.includes('INSERT INTO package_variation_account_certificate_assessment_audit')).length,2);
  assert.ok(!calls.some(c=>/^(INSERT INTO|UPDATE) (package_variation_account_items|subcontract_payment_application_variation_lines|commercial_events|variation_orders)/.test(c.sql)));
});
test('blank and whitespace basis reject before database work',async()=>{
  for(const basis of ['', '   '])assert.equal((await repo.saveAssessment('tenant','package','cert',{...body,basis},auth)).status,400);
  assert.equal(calls.length,0);
});
test('permission rejection occurs before database work',async()=>{
  await assert.rejects(repo.saveAssessment('tenant','package','cert',body,{...auth,permissions:[]}),{status:403});assert.equal(calls.length,0);
});
test('financial limit and stale application provenance reject without a saved assessment',async()=>{
  assert.equal((await repo.saveAssessment('tenant','package','cert',{...body,currentAssessment:6201},auth)).status,409);
  validLine=false;const result=await repo.saveAssessment('tenant','package','cert',body,auth);assert.equal(result.status,400);assert.match(result.message,/provenance/);assert.equal(saved,null);
  assert.deepEqual(calls.find(c=>c.sql.startsWith('SELECT l.*')).params,['claim','tenant','package','va','cert']);
});
test('locked certificate remains immutable',async()=>{
  certificateStatus='locked';assert.equal((await repo.saveAssessment('tenant','package','cert',body,auth)).status,409);assert.equal(saved,null);
});
