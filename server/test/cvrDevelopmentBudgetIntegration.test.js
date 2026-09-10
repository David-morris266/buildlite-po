const test=require('node:test'); const assert=require('node:assert/strict'); const {randomUUID}=require('node:crypto');
const {pool}=require('../db'); const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const budget=require('../services/developmentBudgetRepository'); const cvr=require('../services/cvrPeriodRepository'); const snapshots=require('../services/cvrDevelopmentBudgetSnapshot'); const {PERMISSIONS}=require('../auth/permissions');
let f;
test.before(async()=>{await prepareIntegrationTestDatabase(pool); const client=(await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'GP5A4',false) RETURNING *",[`GP5A4_${randomUUID().slice(0,8)}`])).rows[0]; const developmentId=`dev-${randomUUID()}`;
 await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'GP5A4','GP5A4','live','{}')",[developmentId,client.id]);
 const code=(await pool.query("INSERT INTO cost_codes(client_id,code,description,commercial_head,commercial_family,reporting_group,is_active) VALUES($1,'4120','Brickwork','Build','Trade','Sub-Con',true) RETURNING *",[client.id])).rows[0];
 const user=(await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'gp5a4@test','GP5A4 QS','active') RETURNING *",[`gp5a4-${randomUUID()}`])).rows[0];
 const role=(await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0]; const membership=(await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *',[client.id,user.id,role.id])).rows[0];
 const auth={userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,roleKey:'qs',permissions:[PERMISSIONS.COMMERCIAL_READ,PERMISSIONS.DEVELOPMENT_BUDGET_POST]}; f={client,developmentId,code,auth}; });
test.after(async()=>{await pool.end();});
test('new CVR adopts live authority, freezes exact submission, and becomes stale without dual-writing budgets',async()=>{
 await budget.postEvent(f.client.id,f.developmentId,{eventType:'opening_budget',effectiveDate:'2026-09-10',reference:'OPEN',reason:'Opening',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'100000.00'}]},f.auth);
 const created=await cvr.createCvrPeriod(f.client.id,f.developmentId,{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-09-01'},{actor:'QS'}); assert.equal(created.period.budgetSourceMode,'development_budget'); assert.equal(created.period.budgetSource.document.currentBudgetPence,10000000);
 const inputs=await cvr.listCostCodeInputs(f.client.id,f.developmentId,created.period.id); assert.deepEqual(inputs.inputs,[]);
 const submitted=await cvr.submitCvrPeriod(f.client.id,f.developmentId,created.period.id,{}, {actor:'QS'}); assert.equal(submitted.ok,true); assert.equal(submitted.period.budgetSource.stale,false); assert.equal(submitted.period.budgetSource.document.positions[0].currentPence,10000000);
 await budget.postEvent(f.client.id,f.developmentId,{eventType:'addition',effectiveDate:'2026-09-10',reference:'ADD',reason:'Add',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'1.00'}]},f.auth);
 const compared=await snapshots.compare(pool,{clientId:f.client.id,developmentId:f.developmentId,periodId:created.period.id}); assert.equal(compared.stale,true); assert.deepEqual(compared.reasons,['development_budget_changed']); assert.equal(compared.submitted.source_snapshot.positions[0].currentPence,10000000); assert.equal(compared.live.positions[0].currentPence,10000100);
 const locked=await cvr.approveCvrPeriod(f.client.id,f.developmentId,created.period.id,{version:submitted.period.version},{actor:'Commercial Director'}); assert.equal(locked.ok,false); assert.equal(locked.status,409); assert.match(locked.message,/Development Budget changed/);
 const snapshotsAfter=(await pool.query('SELECT COUNT(*)::int count FROM cvr_period_snapshots WHERE client_id=$1 AND period_id=$2',[f.client.id,created.period.id])).rows[0]; assert.equal(snapshotsAfter.count,0);
});
test('existing Draft retains its baseline until explicit adoption, then rejects CVR budget edits',async()=>{
 const developmentId=`dev-${randomUUID()}`; await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'LEGACY','Legacy adoption','live','{}')",[developmentId,f.client.id]);
 await budget.postEvent(f.client.id,developmentId,{eventType:'opening_budget',effectiveDate:'2026-09-10',reference:'OPEN2',reason:'Opening',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'50000.00'}]},f.auth);
 const period=(await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source) VALUES($1,$2,'P01','P01','draft','{}',1,'legacy_cvr') RETURNING *",[f.client.id,developmentId])).rows[0];
 const before=await cvr.getCvrPeriod(f.client.id,developmentId,period.id); assert.equal(before.period.budgetSource.adoptionAvailable,true); assert.equal(before.period.budgetSource.adopted,false);
 const adopted=await cvr.adoptDevelopmentBudget(f.client.id,developmentId,period.id,{reason:'Use authority'},{actor:'QS'}); assert.equal(adopted.ok,true); assert.equal(adopted.period.budgetSource.document.currentBudgetPence,5000000);
 const create=await cvr.createCostCodeInput(f.client.id,developmentId,period.id,{costCodeKey:'4120',costCodeLabel:'4120',originalBudget:1,currentBudget:1},{actor:'QS'}); assert.equal(create.status,409); assert.match(create.message,/Development Budget/);
});
