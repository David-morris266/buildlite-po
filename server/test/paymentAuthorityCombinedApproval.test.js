const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pool, isDbConfigured } = require('../db');
const { prepareIntegrationTestDatabase } = require('./integrationTestSetup');
const { buildCellId } = require('../services/paymentCertificateCellIdentity');
const repository = require('../services/paymentAuthorityRepository');
const { PERMISSIONS } = require('../auth/permissions');

const clients = [];
const completeTerms = { rulesSchemaVersion: 2, paymentRules: { configurationState: 'complete', ruleType: 'uk_subcontract_payment_cycle', jurisdiction: 'england_wales', timezone: 'Europe/London', anchor: { type: 'contractual_valuation_date' }, dueDate: { relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar' }, paymentNoticeDeadline: { relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar' }, finalDateForPayment: { relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar' }, payLessNoticeDeadline: { relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar' }, notice: { paymentNoticeMode:'certificate_as_payment_notice',paymentNoticeDocumentIdentity:'combined_certificate_payment_notice',certificateDocumentConstitutesNotice:true,paymentNoticeIssuer:'company',payLessIssuer:'company',payLessWorkflowSupported:true,basisOfCalculationRequired:true } } };

async function seed(label, { warnings = false } = {}) {
  const ids = { client: randomUUID(), user: randomUUID(), membership: randomUUID(), development: `dev-combined-${randomUUID()}`, package: randomUUID(), certificate: randomUUID() };
  const orderKey = `subcontract:${randomUUID()}`;
  const poNumber = `S-COMB-${randomUUID().slice(0, 8)}`;
  const providerUserId = `provider-${randomUUID()}`;
  await pool.query(`INSERT INTO clients(id,code,name,is_active) VALUES($1,$2,$3,false)`, [ids.client, `COMB_${randomUUID().slice(0, 6)}`, `Combined ${label}`]);
  clients.push({ ...ids, poNumber });
  await pool.query(`INSERT INTO developments(id,client_id,job_number,development_name,status,payload) VALUES($1,$2,$3,$4,'live','{}')`, [ids.development,ids.client,label,`Combined ${label}`]);
  const po = { poNumber, type:'S', supplierId:'combined-supplier', supplierSnapshot:{name:'Combined Supplier'}, developmentId:ids.development, developmentNumber:label, developmentName:`Combined ${label}`, costRef:{developmentId:ids.development,costCode:'4330'}, items:[{description:'Works',qty:1,rate:1000,amount:1000,costCode:'4330'}], subtotal:1000, totals:{net:1000,vat:200,gross:1200}, vatRateDefault:.2, retentionRateDefault:.05, approval:{status:'Approved',history:[]}, status:'Approved', archived:false };
  await pool.query(`INSERT INTO purchase_orders(po_number,payload,client_id) VALUES($1,$2,$3)`,[poNumber,JSON.stringify(po),ids.client]);
  await pool.query(`INSERT INTO packages(id,client_id,development_id,supplier_id,cost_code,order_key,supplier_label,development_name,payload) VALUES($1,$2,$3,'combined-supplier','4330',$4,'Combined Supplier',$5,$6)`,[ids.package,ids.client,ids.development,orderKey,`Combined ${label}`,JSON.stringify({description:'Works'})]);
  await pool.query(`INSERT INTO package_purchase_orders(package_id,client_id,po_number) VALUES($1,$2,$3)`,[ids.package,ids.client,poNumber]);
  await pool.query(`INSERT INTO package_order_matrices(client_id,package_id,development_id,order_key,layout,committed_value,payload,created_by) VALUES($1,$2,$3,$4,'plot-stage',1000,$5,'QS')`,[ids.client,ids.package,ids.development,orderKey,JSON.stringify({stages:['Works'],plots:[{id:'plot-1',label:'Plot 1',values:[1000]}]})]);
  const progress = { [buildCellId('plot-1','Works')]: { plotId:'plot-1',stageKey:'Works',thisCertificatePct:100 } };
  await pool.query(`INSERT INTO package_payment_certificates(id,client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,contractual_valuation_date,payload,version,submitted_by,submitted_at,updated_by) VALUES($1,$2,$3,$4,$5,1,'submitted','2026-09-01','2026-09-01',$6,2,'Authenticated QS',NOW(),'Authenticated QS')`,[ids.certificate,ids.client,ids.package,ids.development,orderKey,JSON.stringify({progress,commercialLines:[],submissionApplicationSnapshot:null,submissionGoverningTermsSnapshot:warnings?{}:completeTerms})]);
  await pool.query(`INSERT INTO package_payment_certificate_deadline_snapshots(client_id,certificate_id,package_id,development_id,stage,attempt_number,certificate_version,readiness,calculation_status,calculation_version,rules_schema_version,anchor_type,anchor_value,contractual_valuation_date,due_date,payment_notice_deadline,final_date_for_payment,pay_less_notice_deadline,governing_terms_snapshot,cycle_inputs,reasons,captured_by) VALUES($1,$2,$3,$4,'submission',1,2,$5,$6,'payment-deadlines-v1',$7,'contractual_valuation_date','2026-09-01','2026-09-01',$8,$9,$10,$11,$12,'{}',$13,'Authenticated QS')`,[ids.client,ids.certificate,ids.package,ids.development,warnings?'unavailable':'ready',warnings?'unavailable':'calculated',warnings?null:2,warnings?null:'2026-09-08',warnings?null:'2026-09-13',warnings?null:'2026-10-06',warnings?null:'2026-09-29',JSON.stringify(warnings?{}:completeTerms),JSON.stringify(warnings?['Payment rules unavailable.']:[])]);
  await pool.query(`INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'approver@test.invalid','Authenticated Approver','active')`,[ids.user,providerUserId]);
  const role=(await pool.query(`SELECT id FROM roles WHERE key='commercial_director'`)).rows[0];
  await pool.query(`INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)`,[ids.membership,ids.client,ids.user,role.id]);
  const auth={userId:ids.user,membershipId:ids.membership,providerUserId,displayName:'Authenticated Approver',roleKey:'commercial_director',permissions:[PERMISSIONS.CERTIFICATE_LOCK,PERMISSIONS.PAYMENT_AUTHORITY_APPROVE,PERMISSIONS.PAYMENT_APPROVAL_RUN_VIEW]};
  return {ids,auth};
}

async function addVaAssessment(fixture, amount=200) {
  const va=randomUUID(),assessment=randomUUID();
  await pool.query(`INSERT INTO package_variation_account_items(id,client_id,development_id,package_id,cost_code,variation_reference,description,status,current_contractor_value,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,'4330','VA-COMB-1','Combined approval variation','active',$5,$5,$6,$7,$8,'Authenticated Approver')`,[va,fixture.ids.client,fixture.ids.development,fixture.ids.package,amount,fixture.ids.user,fixture.ids.membership,fixture.auth.providerUserId]);
  await pool.query(`INSERT INTO package_variation_account_certificate_assessments(id,client_id,development_id,package_id,certificate_id,variation_account_item_id,signed_current_assessment,assessment_basis,status,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,'Combined approval assessment','draft',$8,$9,$10,'Authenticated Approver',$8,$9,$10,'Authenticated Approver')`,[assessment,fixture.ids.client,fixture.ids.development,fixture.ids.package,fixture.ids.certificate,va,amount,fixture.ids.user,fixture.ids.membership,fixture.auth.providerUserId]);
  return {va,assessment};
}

function body(fixture, overrides={}) { return { packageId:fixture.ids.package,certificateId:fixture.ids.certificate,certificateVersion:2,cashAmount:1140,reason:'Payment authorisation',idempotencyKey:`combined-${randomUUID()}`,lines:[],warningAcknowledgements:[],...overrides }; }

async function counts(certificateId) {
  const certificate=(await pool.query(`SELECT status,version,gross_value,net_value,approved_by FROM package_payment_certificates WHERE id=$1`,[certificateId])).rows[0];
  const decisions=Number((await pool.query(`SELECT count(*) n FROM payment_authority_decisions WHERE certificate_id=$1`,[certificateId])).rows[0].n);
  const approvedAudits=Number((await pool.query(`SELECT count(*) n FROM package_payment_certificate_audit WHERE certificate_id=$1 AND action='approved'`,[certificateId])).rows[0].n);
  return {certificate,decisions,approvedAudits};
}

test.before(async()=>{if(isDbConfigured())await prepareIntegrationTestDatabase(pool);});
test.after(async()=>{
  if(!isDbConfigured())return;
  for(const fixture of clients.reverse()){
    for(const table of ['payment_authority_audit','payment_authority_support_usages','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions']) await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await pool.query(`DELETE FROM payment_authority_audit WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_support_usages WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM package_variation_account_authority_allocations WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_decision_lines WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_decisions WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_runs WHERE client_id=$1`,[fixture.client]);
    for(const table of ['payment_authority_audit','payment_authority_support_usages','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions']) await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await pool.query(`ALTER TABLE package_payment_certificate_deadline_snapshots DISABLE TRIGGER USER`);
    await pool.query(`DELETE FROM package_payment_certificate_deadline_snapshots WHERE client_id=$1`,[fixture.client]);
    await pool.query(`ALTER TABLE package_payment_certificate_deadline_snapshots ENABLE TRIGGER USER`);
    await pool.query(`DELETE FROM package_payment_certificate_audit WHERE certificate_id=$1`,[fixture.certificate]);
    for(const table of ['package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_items']) await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    for(const table of ['package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_items']) await pool.query(`DELETE FROM ${table} WHERE client_id=$1`,[fixture.client]);
    for(const table of ['package_variation_account_certificate_assessment_audit','package_variation_account_certificate_assessments','package_variation_account_items']) await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await pool.query(`DELETE FROM package_payment_certificates WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM package_order_matrices WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM package_purchase_orders WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM packages WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM purchase_orders WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM client_user_memberships WHERE id=$1`,[fixture.membership]);
    await pool.query(`DELETE FROM buildlite_users WHERE id=$1`,[fixture.user]);
    await pool.query(`DELETE FROM developments WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM clients WHERE id=$1`,[fixture.client]);
  }
});

test('combined approval atomically locks ordered work and creates canonical Payment Authority once',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('NORMAL');const input=body(fixture);
  const awaiting=await repository.listQueue(fixture.ids.client,fixture.auth);assert.equal(awaiting.length,1);assert.equal(awaiting[0].workflowState,'awaiting_approval');assert.equal(awaiting[0].packageId,fixture.ids.package);assert.equal(awaiting[0].orderedWorks,1000);assert.equal(awaiting[0].variations,0);assert.equal(awaiting[0].unapprovedAtLock,0);assert.equal(awaiting[0].intendedPayment,1140);
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);
  assert.equal(result.ok,true,result.message);assert.equal(result.certificateStatus,'locked');assert.equal(result.certificateVersion,3);assert.deepEqual(result.warnings,[]);
  const state=await counts(fixture.ids.certificate);assert.equal(state.certificate.status,'locked');assert.equal(Number(state.certificate.version),3);assert.equal(Number(state.certificate.gross_value),1000);assert.equal(Number(state.certificate.net_value),1140);assert.equal(state.certificate.approved_by,'Authenticated Approver');assert.equal(state.decisions,1);assert.equal(state.approvedAudits,1);
  const decision=(await pool.query(`SELECT * FROM payment_authority_decisions WHERE id=$1`,[result.decisionId])).rows[0];assert.equal(Number(decision.signed_cash_amount),1140);assert.equal(decision.approved_by_user_id,fixture.ids.user);assert.equal(decision.source_snapshot_hash_scheme,'canonical_json_sha256_v1');assert.equal(repository.verifyDecisionSnapshot(decision).valid,true);
  const history=await repository.listQueue(fixture.ids.client,fixture.auth);assert.equal(history.length,1);assert.equal(history[0].workflowState,'authorised');
  const retry=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(retry.idempotent,true);assert.equal(retry.decisionId,result.decisionId);assert.deepEqual(await counts(fixture.ids.certificate),state);
});

test('failure after certificate lock rolls back every combined fact and permits a clean retry',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('ROLLBACK');const input=body(fixture);
  await assert.rejects(()=>repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth,{afterLock:()=>{throw new Error('forced post-lock failure');}}),/forced post-lock failure/);
  let state=await counts(fixture.ids.certificate);assert.equal(state.certificate.status,'submitted');assert.equal(Number(state.certificate.version),2);assert.equal(state.certificate.gross_value,null);assert.equal(state.decisions,0);assert.equal(state.approvedAudits,0);
  assert.equal(Number((await pool.query(`SELECT count(*) n FROM package_payment_certificate_deadline_snapshots WHERE certificate_id=$1 AND stage='locked'`,[fixture.ids.certificate])).rows[0].n),0);
  const retry=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(retry.ok,true,retry.message);state=await counts(fixture.ids.certificate);assert.equal(state.certificate.status,'locked');assert.equal(state.decisions,1);
});

test('combined approval binds new authority to the final Locked VA assessment facts',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('VA');const va=await addVaAssessment(fixture);
  const input=body(fixture,{cashAmount:1368,lines:[{assessmentId:va.assessment,newCommercialAuthority:201,basis:'Payment Authority for locked QS assessment',supportUsages:[]}]});
  const excessive=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(excessive.ok,false);assert.match(excessive.message,/exceeds the locked unapproved assessment/);assert.equal((await counts(fixture.ids.certificate)).certificate.status,'submitted');
  assert.equal((await pool.query('SELECT status FROM package_variation_account_certificate_assessments WHERE id=$1',[va.assessment])).rows[0].status,'draft');
  input.lines[0].newCommercialAuthority=200;
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(result.ok,true,result.message);
  const assessment=(await pool.query('SELECT * FROM package_variation_account_certificate_assessments WHERE id=$1',[va.assessment])).rows[0];assert.equal(assessment.status,'locked');assert.equal(Number(assessment.source_authority_snapshot.unapprovedAmount),200);
  const line=(await pool.query('SELECT * FROM payment_authority_decision_lines WHERE decision_id=$1',[result.decisionId])).rows[0];assert.equal(line.assessment_id,va.assessment);assert.equal(Number(line.signed_assessment),200);assert.equal(Number(line.signed_unapproved_at_lock),200);assert.equal(Number(line.signed_new_commercial_authority),200);
  const allocation=(await pool.query('SELECT * FROM package_variation_account_authority_allocations WHERE payment_authority_decision_line_id=$1',[line.id])).rows[0];assert.equal(allocation.variation_account_item_id,va.va);assert.equal(Number(allocation.signed_allocated_amount),200);
});

test('combined approval requires both existing permissions and ignores browser actor fields',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('RBAC');const input=body(fixture,{actor:'Forged Browser Actor'});
  await assert.rejects(()=>repository.approveSubmittedCertificate(fixture.ids.client,input,{...fixture.auth,permissions:[PERMISSIONS.CERTIFICATE_LOCK]}),error=>error.status===403);
  await assert.rejects(()=>repository.approveSubmittedCertificate(fixture.ids.client,input,{...fixture.auth,permissions:[PERMISSIONS.PAYMENT_AUTHORITY_APPROVE]}),error=>error.status===403);
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(result.ok,true,result.message);
  const decision=(await pool.query(`SELECT approved_by_display_name FROM payment_authority_decisions WHERE id=$1`,[result.decisionId])).rows[0];assert.equal(decision.approved_by_display_name,'Authenticated Approver');assert.notEqual(decision.approved_by_display_name,input.actor);
});

test('combined approval keeps stale versions and tenant boundaries as non-overridable blockers',async t=>{
  if(!isDbConfigured())return t.skip();
  const staleFixture=await seed('STALE');
  const stale=await repository.approveSubmittedCertificate(staleFixture.ids.client,body(staleFixture,{certificateVersion:1,warningAcknowledgements:[{code:'payment_rules_unavailable',acknowledged:true}],warningComment:'Must not override a stale version.'}),staleFixture.auth);
  assert.equal(stale.ok,false);assert.equal(stale.status,409);assert.match(stale.message,/version/i);assert.equal((await counts(staleFixture.ids.certificate)).certificate.status,'submitted');
  const tenantFixture=await seed('TENANT');
  const crossTenant=await repository.approveSubmittedCertificate(randomUUID(),body(tenantFixture,{warningAcknowledgements:[{code:'payment_rules_unavailable',acknowledged:true}],warningComment:'Must not override tenant isolation.'}),tenantFixture.auth);
  assert.equal(crossTenant.ok,false);assert.equal(crossTenant.status,404);assert.equal((await counts(tenantFixture.ids.certificate)).certificate.status,'submitted');
});

test('process warnings are informational and remain immutable canonical evidence',async t=>{
  if(!isDbConfigured())return t.skip();const fixtured=await seed('WARNINGS',{warnings:true});const first=body(fixtured);
  const warningCodes=['payment_rules_unavailable','payment_notice_incomplete','final_payment_date_missing'];
  const result=await repository.approveSubmittedCertificate(fixtured.ids.client,first,fixtured.auth);
  assert.equal(result.ok,true,result.message);assert.deepEqual(result.warnings.map(item=>item.code),warningCodes);const decision=(await pool.query(`SELECT * FROM payment_authority_decisions WHERE id=$1`,[result.decisionId])).rows[0];assert.equal(decision.source_snapshot.approvalWarnings.length,3);assert.equal(decision.source_snapshot.approvalWarnings[0].classification,'process_warning');assert.equal(decision.source_snapshot.approvalWarnings[0].acknowledgementRequired,false);assert.equal(decision.source_snapshot.approvalWarnings[0].acknowledged,undefined);assert.equal(decision.source_snapshot.approvalWarnings[0].approver,undefined);assert.equal(repository.verifyDecisionSnapshot(decision).valid,true);assert.equal(Number((await pool.query(`SELECT count(*) n FROM package_payment_notices WHERE certificate_id=$1`,[fixtured.ids.certificate])).rows[0].n),0);
});

test('exceptional cash authority still requires explicit acknowledgement and reason',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('CASH-EXCEPTION');const input=body(fixture,{cashAmount:1000});
  const denied=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(denied.ok,false);assert.match(denied.message,/commercial authority exception/i);assert.equal((await counts(fixture.ids.certificate)).certificate.status,'submitted');
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,{...input,warningAcknowledgements:[{code:'cash_differs_from_payment_position',acknowledged:true}],warningComment:'Exceptional cash position approved.'},fixture.auth);
  assert.equal(result.ok,true,result.message);const decision=(await pool.query('SELECT * FROM payment_authority_decisions WHERE id=$1',[result.decisionId])).rows[0];const evidence=decision.source_snapshot.approvalWarnings.find(item=>item.code==='cash_differs_from_payment_position');assert.equal(evidence.classification,'commercial_exception');assert.equal(evidence.acknowledged,true);assert.equal(evidence.acknowledgementComment,'Exceptional cash position approved.');assert.equal(evidence.approver.userId,fixture.ids.user);assert.equal(repository.verifyDecisionSnapshot(decision).valid,true);
});
