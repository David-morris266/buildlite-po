const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {pool,isDbConfigured}=require('../db');
const {prepareIntegrationTestDatabase}=require('./integrationTestSetup');
const repo=require('../services/applicationVariationRepository');
const va=require('../services/variationAccountRepository');

const sql=name=>fs.readFileSync(path.join(__dirname,'..','migrations',name),'utf8');
let fixture,auth,adminAuth;

test.before(async()=>{
  if(!isDbConfigured())return;
  await prepareIntegrationTestDatabase(pool);
  for(const name of ['004_developments.sql','005_packages.sql','008_package_payment_certificates.sql','026_subcontract_payment_applications.sql','031_rbac_identity_foundation.sql','033_package_variation_account.sql','034_application_variation_lines.sql'])await pool.query(sql(name));
  const client=(await pool.query('INSERT INTO clients(code,name,is_active) VALUES($1,$2,false) RETURNING *',[`VA1_${randomUUID().slice(0,8)}`,'VA-1 Test'])).rows[0];
  const development=`dev-va1-${randomUUID()}`;await pool.query("INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,'VA1','VA-1','live','{}')",[development,client.id]);
  const pkg=(await pool.query("INSERT INTO packages(client_id,development_id,supplier_id,cost_code,order_key) VALUES($1,$2,'va1-supplier','4330',$3) RETURNING *",[client.id,development,`va1:${randomUUID()}`])).rows[0];
  const cert=(await pool.query("INSERT INTO package_payment_certificates(client_id,package_id,development_id,order_key,certificate_number,status,payload) VALUES($1,$2,$3,$4,1,'draft','{}') RETURNING *",[client.id,pkg.id,development,pkg.order_key])).rows[0];
  const application=(await pool.query(`INSERT INTO subcontract_payment_applications(client_id,development_id,package_id,certificate_id,application_reference,received_at,application_basis,current_period_gross_claimed) VALUES($1,$2,$3,$4,'APP-VA1',NOW(),'current_period_gross',15000) RETURNING *`,[client.id,development,pkg.id,cert.id])).rows[0];
  const user=(await pool.query("INSERT INTO buildlite_users(auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES('clerk',$1,'va1@example.test','VA One','active') RETURNING *",[`provider-${randomUUID()}`])).rows[0];
  const role=(await pool.query("SELECT id FROM roles WHERE key='qs'")).rows[0],membership=(await pool.query('INSERT INTO client_user_memberships(client_id,user_id,role_id,is_active) VALUES($1,$2,$3,true) RETURNING *',[client.id,user.id,role.id])).rows[0];
  const permissions=(await pool.query('SELECT permission_key FROM role_permissions WHERE role_id=$1',[role.id])).rows.map(r=>r.permission_key);
  auth={clientId:client.id,userId:user.id,membershipId:membership.id,providerUserId:user.provider_user_id,displayName:user.display_name,permissions};
  adminAuth={...auth,permissions:['variation_account.view']};fixture={client,development,pkg,cert,application,user};
});
test.after(async()=>{if(!fixture)return;for(const table of ['subcontract_payment_application_variation_audit','subcontract_payment_application_variation_lines','package_variation_account_forecast_history','package_variation_account_contractor_positions','package_variation_account_lifecycle_audit','package_variation_account_items'])await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);await pool.query('DELETE FROM subcontract_payment_application_variation_audit WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM subcontract_payment_application_variation_lines WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM package_variation_account_forecast_history WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM package_variation_account_contractor_positions WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM package_variation_account_lifecycle_audit WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM package_variation_account_items WHERE client_id=$1',[fixture.client.id]);await pool.query('DELETE FROM clients WHERE id=$1',[fixture.client.id]);await pool.query('DELETE FROM buildlite_users WHERE id=$1',[fixture.user.id]);});

test('Migration 034 is additive and creates no invented historic lines',async t=>{if(!fixture)return t.skip();assert.equal(Number((await pool.query('SELECT count(*) n FROM subcontract_payment_application_variation_lines WHERE client_id=$1',[fixture.client.id])).rows[0].n),0);assert.doesNotMatch(sql('034_application_variation_lines.sql'),/INSERT INTO subcontract_payment_application_variation_lines\s+SELECT/i);});

test('signed contractor evidence retains £20k value and £10k claim with arithmetic validation',async t=>{if(!fixture)return t.skip();const bad=await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Bad',contractorValue:1,previousClaim:0,currentClaim:10,cumulativeClaim:9},auth);assert.equal(bad.status,400);
  const result=await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{contractorReference:'GW-01',description:'Drainage design changes',contractorValue:20000,previousClaim:0,currentClaim:10000,cumulativeClaim:10000},auth);assert.equal(result.ok,true,result.message);assert.equal(result.line.contractorValue,20000);assert.equal(result.line.currentClaim,10000);fixture.line=result.line;
  const credit=await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Omission credit',contractorValue:-3000,previousClaim:0,currentClaim:-1500,cumulativeClaim:-1500},auth);assert.equal(credit.line.currentClaim,-1500);
});

test('match existing retains evidence, creates no duplicate and does not alter QS Forecast',async t=>{if(!fixture)return t.skip();const item=(await va.createItem(fixture.client.id,fixture.pkg.id,{description:'Drainage design changes',contractorValue:20000,qsForecast:17000,reason:'QS view'},auth)).item;const before=Number((await pool.query('SELECT count(*) n FROM package_variation_account_items WHERE client_id=$1',[fixture.client.id])).rows[0].n);
  const matched=await repo.matchLine(fixture.client.id,fixture.pkg.id,fixture.application.id,fixture.line.id,item.id,auth);assert.equal(matched.line.matchedVariation.qsForecast,17000);assert.equal(Number((await pool.query('SELECT count(*) n FROM package_variation_account_items WHERE client_id=$1',[fixture.client.id])).rows[0].n),before);assert.equal((await va.getItem(fixture.client.id,item.id,auth)).qsForecast,17000);fixture.item=item;
});

test('changed contractor evidence only updates confirmed position after explicit confirmation',async t=>{if(!fixture)return t.skip();const changed=await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Drainage revised',contractorValue:24000,previousClaim:10000,currentClaim:5000,cumulativeClaim:15000},auth);await repo.matchLine(fixture.client.id,fixture.pkg.id,fixture.application.id,changed.line.id,fixture.item.id,auth);assert.equal((await va.getItem(fixture.client.id,fixture.item.id,auth)).contractorValue,20000);
  await repo.confirmContractorPosition(fixture.client.id,fixture.pkg.id,fixture.application.id,changed.line.id,{reason:'QS confirmed revised contractor position'},auth);const after=await va.getItem(fixture.client.id,fixture.item.id,auth);assert.equal(after.contractorValue,24000);assert.equal(after.qsForecast,17000);assert.deepEqual(after.contractorPositionHistory.map(x=>x.value),[20000,24000]);
});

test('new variation requires deliberate QS Forecast; frozen evidence and Admin writes are rejected',async t=>{if(!fixture)return t.skip();const line=(await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Additional pumping',contractorValue:6000,previousClaim:0,currentClaim:3000,cumulativeClaim:3000},auth)).line;assert.equal((await repo.createVariation(fixture.client.id,fixture.pkg.id,fixture.application.id,line.id,{reason:'Missing forecast'},auth)).status,400);
  const created=await repo.createVariation(fixture.client.id,fixture.pkg.id,fixture.application.id,line.id,{qsForecast:4500,reason:'Deliberate QS assessment'},auth);const item=await va.getItem(fixture.client.id,created.itemId,auth);assert.equal(item.contractorValue,6000);assert.equal(item.qsForecast,4500);
  await assert.rejects(()=>repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Admin',contractorValue:1,previousClaim:0,currentClaim:1,cumulativeClaim:1},adminAuth),e=>e.status===403);
  await pool.query("UPDATE package_payment_certificates SET status='submitted' WHERE id=$1",[fixture.cert.id]);const frozen=await repo.addLine(fixture.client.id,fixture.pkg.id,fixture.application.id,{description:'Late',contractorValue:1,previousClaim:0,currentClaim:1,cumulativeClaim:1},auth);assert.equal(frozen.status,409);
  await pool.query("UPDATE package_payment_certificates SET status='draft' WHERE id=$1",[fixture.cert.id]);await pool.query("UPDATE subcontract_payment_applications SET status='superseded' WHERE id=$1",[fixture.application.id]);const revision2=(await pool.query(`INSERT INTO subcontract_payment_applications(client_id,development_id,package_id,certificate_id,application_reference,received_at,application_basis,current_period_gross_claimed,revision_number,supersedes_id) VALUES($1,$2,$3,$4,'APP-VA1',NOW(),'current_period_gross',16000,2,$5) RETURNING *`,[fixture.client.id,fixture.development,fixture.pkg.id,fixture.cert.id,fixture.application.id])).rows[0];const revised=await repo.addLine(fixture.client.id,fixture.pkg.id,revision2.id,{description:'Drainage design changes',contractorValue:24000,previousClaim:10000,currentClaim:6000,cumulativeClaim:16000},auth);assert.equal(revised.line.contractorValue,24000);const historic=(await repo.listLines(fixture.client.id,fixture.pkg.id,fixture.application.id,auth)).lines.find(row=>row.id===fixture.line.id);assert.equal(historic.contractorValue,20000);
});
