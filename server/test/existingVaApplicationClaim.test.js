// Repository contract checks with an in-memory query adapter: no database or migrations.
const test = require('node:test');
const assert = require('node:assert/strict');
let calls, application, item;
const actor = { clientId:'tenant', userId:'user', membershipId:'member', providerUserId:'provider', displayName:'QS', permissions:['variation_account.create'] };
const body = { description:'Additional hot water circulation pipework', contractorValue:8500, previousClaim:0, currentClaim:8500, cumulativeClaim:8500 };
const line = { id:'claim', client_id:'tenant', package_id:'package', application_id:'application', contractor_variation_value:8500, previous_claim:0, current_claim:8500, cumulative_claim:8500 };
const db = { release() {}, async query(sql, params) {
  calls.push({sql,params});
  if (sql.includes('SELECT a.*,c.status')) return {rows:application ? [application] : []};
  if (sql.startsWith('SELECT * FROM subcontract_payment_application_variation_lines')) return {rows:[line]};
  if (sql.startsWith('SELECT * FROM package_variation_account_items')) return {rows:item ? [item] : []};
  if (sql.includes('INSERT INTO subcontract_payment_application_variation_lines')) return {rows:[line]};
  if (sql.startsWith('UPDATE subcontract_payment_application_variation_lines')) return {rows:[{...line,variation_account_item_id:params[0]}]};
  return {rows:[]};
} };
require.cache[require.resolve('../db')] = { id:require.resolve('../db'), filename:require.resolve('../db'), loaded:true, exports:{pool:{connect:async()=>db},query:db.query.bind(db)} };
const repo = require('../services/applicationVariationRepository');
test.beforeEach(()=>{calls=[];application={status:'recorded',certificate_id:'certificate',certificate_status:'draft',revision_number:1};item={id:'existing-va',variation_reference:'VA-0001',current_qs_forecast:6200,current_contractor_value:8500};});

test('create and match retain exact tenant/package/application/VA identity and actor audit without creating a VA',async()=>{
  const created=await repo.addLine('tenant','package','application',body,actor);
  assert.equal(created.ok,true);assert.equal(created.line.currentClaim,8500);
  const matched=await repo.matchLine('tenant','package','application','claim','existing-va',actor);
  assert.equal(matched.ok,true);assert.equal(matched.line.variationAccountItemId,'existing-va');
  assert.deepEqual(calls.find(c=>c.sql.startsWith('SELECT * FROM package_variation_account_items')).params,['tenant','package','existing-va']);
  assert.deepEqual(calls.find(c=>c.sql.startsWith('SELECT * FROM subcontract_payment_application_variation_lines')).params,['tenant','package','application','claim']);
  assert.ok(calls.filter(c=>c.sql.includes('SELECT a.*,c.status')).every(c=>JSON.stringify(c.params)===JSON.stringify(['tenant','package','application'])));
  assert.ok(calls.filter(c=>c.sql.includes('INSERT INTO subcontract_payment_application_variation_audit')).every(c=>c.params.includes('member')&&c.params.includes('provider')));
  assert.ok(!calls.some(c=>/INSERT INTO package_variation_account_items|UPDATE package_variation_account_items|INSERT INTO variation_orders|INSERT INTO commercial_events/.test(c.sql)));
});
test('missing tenant/package application and foreign VA fail closed',async()=>{
  application=null;assert.equal((await repo.addLine('other','package','application',body,actor)).status,404);
  application={status:'recorded',certificate_id:'certificate',certificate_status:'draft'};item=null;
  assert.equal((await repo.matchLine('tenant','other-package','application','claim','foreign-va',actor)).status,404);
  assert.ok(!calls.some(c=>c.sql.startsWith('UPDATE subcontract_payment_application_variation_lines')));
});
test('locked evidence cannot be created or matched',async()=>{
  application.certificate_status='locked';
  assert.equal((await repo.addLine('tenant','package','application',body,actor)).status,409);
  assert.equal((await repo.matchLine('tenant','package','application','claim','existing-va',actor)).status,409);
  assert.ok(!calls.some(c=>/^(INSERT|UPDATE)/.test(c.sql)));
});
test('claim creation and matching enforce permission before querying',async()=>{
  const denied={...actor,permissions:[]};
  await assert.rejects(repo.addLine('tenant','package','application',body,denied),{status:403});
  await assert.rejects(repo.matchLine('tenant','package','application','claim','existing-va',denied),{status:403});
  assert.equal(calls.length,0);
});
