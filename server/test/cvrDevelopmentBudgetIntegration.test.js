const test=require('node:test'); const assert=require('node:assert/strict'); const {randomUUID}=require('node:crypto');
const {pool}=require('../db'); const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const budget=require('../services/developmentBudgetRepository'); const cvr=require('../services/cvrPeriodRepository'); const snapshots=require('../services/cvrDevelopmentBudgetSnapshot'); const {PERMISSIONS}=require('../auth/permissions');
let f; const FIXED_CURRENT_DATE=new Date('2027-03-08T12:00:00.000Z');
test.before(async()=>{await prepareIntegrationTestDatabase(pool); const client=(await pool.query("INSERT INTO clients(code,name,is_active) VALUES($1,'GP5A4',false) RETURNING *",[`GP5A4_${randomUUID().slice(0,8)}`])).rows[0]; const developmentId=`dev-${randomUUID()}`;
 await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'GP5A4','GP5A4','live','{}')",[developmentId,client.id]);
 const code=(await pool.query("INSERT INTO cost_codes(client_id,code,description,commercial_head,commercial_family,reporting_group,is_active) VALUES($1,'4120','Brickwork','Build','Trade','Sub-Con',true) RETURNING *",[client.id])).rows[0];
 const user=(await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'gp5a4@test','GP5A4 QS','active') RETURNING *",[`gp5a4-${randomUUID()}`])).rows[0];
 const role=(await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0]; const membership=(await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *',[client.id,user.id,role.id])).rows[0];
 const auth={userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,roleKey:'qs',permissions:[PERMISSIONS.COMMERCIAL_READ,PERMISSIONS.DEVELOPMENT_BUDGET_POST]}; f={client,developmentId,code,auth}; });
test.after(async()=>{await pool.end();});
test('new CVR adopts live authority, freezes exact submission, and becomes stale without dual-writing budgets',async()=>{
 await budget.postEvent(f.client.id,f.developmentId,{eventType:'opening_budget',effectiveDate:'2026-09-10',reference:'OPEN',reason:'Opening',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'100000.00'}]},f.auth);
 const milestone=await budget.confirmSiteStartBudget(f.client.id,f.developmentId,{approvedEffectiveDate:'2026-09-10',reference:'SSB-1',approvalReason:'Approved at site commencement'},f.auth);assert.equal(milestone.status,201);
 const readiness=await require('../services/developmentCommercialReadiness').loadDevelopmentCommercialReadiness(f.client.id,f.developmentId); assert.equal(readiness.readiness.canCreateFirstCvr,true); assert.equal(readiness.readiness.overallState,'needs_attention'); assert.equal(readiness.readiness.items.find(x=>x.key==='revenue').state,'needs_attention'); assert.doesNotMatch(readiness.readiness.items.find(x=>x.key==='revenue').reason,/revenue-settings-missing/);
 const created=await cvr.createCvrPeriod(f.client.id,f.developmentId,{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-09-01'},{actor:'QS',currentDate:FIXED_CURRENT_DATE}); assert.equal(created.period.budgetSourceMode,'development_budget'); assert.equal(created.period.budgetSource.document.currentBudgetPence,10000000);assert.equal(created.period.budgetSource.document.siteStartBudget.totalPence,10000000);assert.equal(created.period.budgetSource.document.siteStartBudget.milestoneId,milestone.milestoneId);
 const inputs=await cvr.listCostCodeInputs(f.client.id,f.developmentId,created.period.id); assert.deepEqual(inputs.inputs,[]);
 const submitted=await cvr.submitCvrPeriod(f.client.id,f.developmentId,created.period.id,{}, {actor:'QS'}); assert.equal(submitted.ok,true); assert.equal(submitted.period.budgetSource.stale,false); assert.equal(submitted.period.budgetSource.document.positions[0].currentPence,10000000);assert.equal(submitted.period.budgetSource.document.siteStartBudget.evidenceSha256,milestone.authority.siteStartBudget.evidenceSha256);
 await budget.postEvent(f.client.id,f.developmentId,{eventType:'addition',effectiveDate:'2026-09-10',reference:'ADD',reason:'Add',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'1.00'}]},f.auth);
 const compared=await snapshots.compare(pool,{clientId:f.client.id,developmentId:f.developmentId,periodId:created.period.id}); assert.equal(compared.stale,true); assert.deepEqual(compared.reasons,['development_budget_changed']); assert.equal(compared.submitted.source_snapshot.positions[0].currentPence,10000000); assert.equal(compared.live.positions[0].currentPence,10000100);
 const locked=await cvr.approveCvrPeriod(f.client.id,f.developmentId,created.period.id,{version:submitted.period.version},{actor:'Commercial Director'}); assert.equal(locked.ok,false); assert.equal(locked.status,409); assert.match(locked.message,/Development Budget changed/);
 const snapshotsAfter=(await pool.query('SELECT COUNT(*)::int count FROM cvr_period_snapshots WHERE client_id=$1 AND period_id=$2',[f.client.id,created.period.id])).rows[0]; assert.equal(snapshotsAfter.count,0);
});
test('genuinely new Development without Budget Authority cannot create P01',async()=>{
 const developmentId=`dev-${randomUUID()}`; await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'NO-BUDGET','No Budget','live','{}')",[developmentId,f.client.id]);
 const result=await cvr.createCvrPeriod(f.client.id,developmentId,{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-09-01'},{actor:'QS',currentDate:FIXED_CURRENT_DATE});
 assert.equal(result.status,409); assert.equal(result.blockers.some(x=>x.key==='development_budget'),true);
});
test('established legacy CVR development can continue without retrospective Budget enforcement',async()=>{
 const developmentId=`dev-${randomUUID()}`; await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'LEGACY-CONTINUE','Legacy Continue','live','{}')",[developmentId,f.client.id]);
 await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source,submitted_at,submitted_by,approved_at,approved_by) VALUES($1,$2,'P01','P01','locked','{}',1,'legacy_cvr',NOW(),'legacy-test',NOW(),'legacy-test')",[f.client.id,developmentId]);
 const result=await cvr.createCvrPeriod(f.client.id,developmentId,{periodKey:'P02',periodLabel:'P02',reportingMonth:'2026-10-01'},{actor:'QS',currentDate:FIXED_CURRENT_DATE});
 assert.equal(result.ok,true,result.message); assert.equal(result.period.budgetSourceMode,'legacy_cvr');
 const forbidden=await cvr.patchCvrPeriod(f.client.id,developmentId,result.period.id,{version:result.period.version,reportingMonth:'2027-02'},{actor:'QS'});
 assert.equal(forbidden.status,400); assert.match(forbidden.message,/cannot be changed after/i);
 const commentary=await cvr.patchCvrPeriod(f.client.id,developmentId,result.period.id,{version:result.period.version,commentary:{keyCommercialIssues:'Still editable'}},{actor:'QS'});
 assert.equal(commentary.ok,true,commentary.message); assert.equal(commentary.period.reportingMonth,'2026-10-01');
});
test('CVR creation permits only a closed Reporting Period with a deterministic server clock',async()=>{
 const currentDate=new Date('2026-10-08T12:00:00.000Z');
 async function legacyDevelopment(label){const developmentId=`dev-${randomUUID()}`;await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$3,'live','{}')",[developmentId,f.client.id,label]);await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source,submitted_at,submitted_by,approved_at,approved_by) VALUES($1,$2,'P00','P00','locked','{}',1,'legacy_cvr',NOW(),'legacy-test',NOW(),'legacy-test')",[f.client.id,developmentId]);return developmentId;}
 const closedDevelopment=await legacyDevelopment('CLOSED-PERIOD');
 const closed=await cvr.createCvrPeriod(f.client.id,closedDevelopment,{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-09'},{actor:'QS',currentDate});
 assert.equal(closed.ok,true,closed.message);
 const current=await cvr.createCvrPeriod(f.client.id,await legacyDevelopment('CURRENT-PERIOD'),{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-10'},{actor:'QS',currentDate});
 assert.equal(current.status,409); assert.equal(current.code,'CVR_REPORTING_PERIOD_NOT_CLOSED'); assert.equal(current.reportingPeriodState,'current');
 const future=await cvr.createCvrPeriod(f.client.id,await legacyDevelopment('FUTURE-PERIOD'),{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-11'},{actor:'QS',currentDate});
 assert.equal(future.status,409); assert.equal(future.code,'CVR_REPORTING_PERIOD_NOT_CLOSED'); assert.equal(future.reportingPeriodState,'future');
});
test('existing Draft retains its baseline until explicit adoption, then rejects CVR budget edits',async()=>{
 const developmentId=`dev-${randomUUID()}`; await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'LEGACY','Legacy adoption','live','{}')",[developmentId,f.client.id]);
 await budget.postEvent(f.client.id,developmentId,{eventType:'opening_budget',effectiveDate:'2026-09-10',reference:'OPEN2',reason:'Opening',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'50000.00'}]},f.auth);
 const period=(await pool.query("INSERT INTO cvr_periods(client_id,development_id,period_key,period_label,status,commentary,version,budget_source) VALUES($1,$2,'P01','P01','draft','{}',1,'legacy_cvr') RETURNING *",[f.client.id,developmentId])).rows[0];
 const before=await cvr.getCvrPeriod(f.client.id,developmentId,period.id); assert.equal(before.period.budgetSource.adoptionAvailable,true); assert.equal(before.period.budgetSource.adopted,false);
 const adopted=await cvr.adoptDevelopmentBudget(f.client.id,developmentId,period.id,{reason:'Use authority'},{actor:'QS'}); assert.equal(adopted.ok,true); assert.equal(adopted.period.budgetSource.document.currentBudgetPence,5000000);
 const create=await cvr.createCostCodeInput(f.client.id,developmentId,period.id,{costCodeKey:'4120',costCodeLabel:'4120',originalBudget:1,currentBudget:1},{actor:'QS'}); assert.equal(create.status,409); assert.match(create.message,/Development Budget/);
});
test('development-budget Draft accepts sparse commercial adjustment patch and retains unrelated facts',async()=>{
 const developmentId=`dev-${randomUUID()}`; await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'SPARSE-PATCH','Sparse Patch','live','{}')",[developmentId,f.client.id]);
 await budget.postEvent(f.client.id,developmentId,{eventType:'opening_budget',effectiveDate:'2026-09-10',reference:'OPEN3',reason:'Opening',idempotencyKey:randomUUID(),lines:[{costCodeId:f.code.id,amount:'50000.00'}]},f.auth);
 const created=await cvr.createCvrPeriod(f.client.id,developmentId,{periodKey:'P01',periodLabel:'P01',reportingMonth:'2026-09-01'},{actor:'QS',currentDate:FIXED_CURRENT_DATE}); assert.equal(created.period.budgetSourceMode,'development_budget');
 const inserted=await cvr.createCostCodeInput(f.client.id,developmentId,created.period.id,{costCodeKey:'4120',costCodeLabel:'4120 — Brickwork',commercialHead:'House Build',commercialFamily:'Structure',trade:'Brickwork',commercialAdjustment:8000,adjustmentReason:'Existing adjustment',manualAccrual:125,notes:'Retain this note'},{actor:'QS'}); assert.equal(inserted.ok,true,inserted.message);
 const patched=await cvr.patchCostCodeInput(f.client.id,developmentId,created.period.id,inserted.input.id,{version:inserted.input.version,commercialAdjustment:9000,adjustmentReason:'UAT movement change to test explanation staleness.'},{actor:'QS'}); assert.equal(patched.ok,true,patched.message);
 assert.equal(patched.input.version,inserted.input.version+1); assert.equal(patched.input.commercialAdjustment,9000); assert.equal(patched.input.adjustmentReason,'UAT movement change to test explanation staleness.'); assert.equal(patched.input.manualAccrual,125); assert.equal(patched.input.notes,'Retain this note'); assert.equal(patched.input.commercialHead,'House Build'); assert.equal(patched.input.commercialFamily,'Structure'); assert.equal(patched.input.trade,'Brickwork');
 const forbidden=await cvr.patchCostCodeInput(f.client.id,developmentId,created.period.id,inserted.input.id,{version:patched.input.version,currentBudget:50001,commercialAdjustment:9100,adjustmentReason:'Must reject atomically'},{actor:'QS'}); assert.equal(forbidden.status,409); assert.match(forbidden.message,/Development Budget/);
 const after=await cvr.listCostCodeInputs(f.client.id,developmentId,created.period.id); const stored=after.inputs.find((input)=>input.id===inserted.input.id); assert.equal(stored.version,patched.input.version); assert.equal(stored.commercialAdjustment,9000); assert.equal(stored.adjustmentReason,'UAT movement change to test explanation staleness.'); assert.equal(stored.manualAccrual,125); assert.equal(stored.notes,'Retain this note');
 const authority=await cvr.getCvrPeriod(f.client.id,developmentId,created.period.id); assert.equal(authority.period.budgetSource.document.originalBudgetPence,5000000); assert.equal(authority.period.budgetSource.document.currentBudgetPence,5000000);
});
