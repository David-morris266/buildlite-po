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
  await pool.query(`INSERT INTO package_payment_certificates(id,client_id,package_id,development_id,order_key,certificate_number,status,certificate_date,contractual_valuation_date,payload,version,submitted_by,submitted_at,updated_by) VALUES($1,$2,$3,$4,$5,1,'submitted','2026-09-29','2026-09-28',$6,2,'Authenticated QS',NOW(),'Authenticated QS')`,[ids.certificate,ids.client,ids.package,ids.development,orderKey,JSON.stringify({progress,commercialLines:[],submissionApplicationSnapshot:null,submissionGoverningTermsSnapshot:warnings?{}:completeTerms})]);
  await pool.query(`INSERT INTO package_payment_certificate_deadline_snapshots(client_id,certificate_id,package_id,development_id,stage,attempt_number,certificate_version,readiness,calculation_status,calculation_version,rules_schema_version,anchor_type,anchor_value,contractual_valuation_date,due_date,payment_notice_deadline,final_date_for_payment,pay_less_notice_deadline,governing_terms_snapshot,cycle_inputs,reasons,captured_by) VALUES($1,$2,$3,$4,'submission',1,2,$5,$6,'payment-deadlines-v1',$7,'contractual_valuation_date','2026-09-28','2026-09-28',$8,$9,$10,$11,$12,'{}',$13,'Authenticated QS')`,[ids.client,ids.certificate,ids.package,ids.development,warnings?'unavailable':'ready',warnings?'unavailable':'calculated',warnings?null:2,warnings?null:'2026-10-05',warnings?null:'2026-10-10',warnings?null:'2026-10-19',warnings?null:'2026-10-14',JSON.stringify(warnings?{}:completeTerms),JSON.stringify(warnings?['Payment rules unavailable.']:[])]);
  await pool.query(`INSERT INTO buildlite_users(id,auth_provider,provider_user_id,email_snapshot,display_name,status) VALUES($1,'clerk',$2,'approver@test.invalid','Authenticated Approver','active')`,[ids.user,providerUserId]);
  const role=(await pool.query(`SELECT id FROM roles WHERE key='commercial_director'`)).rows[0];
  await pool.query(`INSERT INTO client_user_memberships(id,client_id,user_id,role_id,is_active) VALUES($1,$2,$3,$4,true)`,[ids.membership,ids.client,ids.user,role.id]);
  const auth={userId:ids.user,membershipId:ids.membership,providerUserId,displayName:'Authenticated Approver',roleKey:'commercial_director',permissions:[PERMISSIONS.CERTIFICATE_LOCK,PERMISSIONS.PAYMENT_AUTHORITY_APPROVE,PERMISSIONS.PAYMENT_APPROVAL_RUN_VIEW]};
  return {ids,auth};
}

async function addVaAssessment(fixture, amount=200, reference='VA-COMB-1') {
  const va=randomUUID(),assessment=randomUUID();
  await pool.query(`INSERT INTO package_variation_account_items(id,client_id,development_id,package_id,cost_code,variation_reference,description,status,current_contractor_value,current_qs_forecast,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name) VALUES($1,$2,$3,$4,'4330',$5,'Combined approval variation','active',$6,$6,$7,$8,$9,'Authenticated Approver')`,[va,fixture.ids.client,fixture.ids.development,fixture.ids.package,reference,amount,fixture.ids.user,fixture.ids.membership,fixture.auth.providerUserId]);
  await pool.query(`INSERT INTO package_variation_account_certificate_assessments(id,client_id,development_id,package_id,certificate_id,variation_account_item_id,signed_current_assessment,assessment_basis,status,created_by_user_id,created_by_membership_id,created_by_provider_user_id,created_by_display_name,updated_by_user_id,updated_by_membership_id,updated_by_provider_user_id,updated_by_display_name) VALUES($1,$2,$3,$4,$5,$6,$7,'Combined approval assessment','draft',$8,$9,$10,'Authenticated Approver',$8,$9,$10,'Authenticated Approver')`,[assessment,fixture.ids.client,fixture.ids.development,fixture.ids.package,fixture.ids.certificate,va,amount,fixture.ids.user,fixture.ids.membership,fixture.auth.providerUserId]);
  return {va,assessment};
}

function body(fixture, overrides={}) { return { packageId:fixture.ids.package,certificateId:fixture.ids.certificate,certificateVersion:2,cashAmount:1140,reason:'Payment authorisation',idempotencyKey:`combined-${randomUUID()}`,lines:[],warningAcknowledgements:[],...(fixture.noticePreparationDisclosureHash?{noticePreparationDisclosureHash:fixture.noticePreparationDisclosureHash}:{}),...overrides }; }

async function counts(certificateId) {
  const certificate=(await pool.query(`SELECT status,version,gross_value,net_value,approved_by FROM package_payment_certificates WHERE id=$1`,[certificateId])).rows[0];
  const decisions=Number((await pool.query(`SELECT count(*) n FROM payment_authority_decisions WHERE certificate_id=$1`,[certificateId])).rows[0].n);
  const approvedAudits=Number((await pool.query(`SELECT count(*) n FROM package_payment_certificate_audit WHERE certificate_id=$1 AND action='approved'`,[certificateId])).rows[0].n);
  return {certificate,decisions,approvedAudits};
}

test.before(async()=>{if(isDbConfigured()){await prepareIntegrationTestDatabase(pool);if(!(await pool.query("SELECT to_regclass('payment_notice_instructions') name")).rows[0].name)await pool.query(require('fs').readFileSync(require('path').join(__dirname,'../migrations/072_payment_notice_preparation.sql'),'utf8'));}});
test.after(async()=>{
  if(!isDbConfigured())return;
  for(const fixture of clients.reverse()){
    await pool.query('DELETE FROM payment_notice_preparation_jobs WHERE client_id=$1',[fixture.client]);
    await pool.query('DELETE FROM commercial_document_audit WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE commercial_documents DISABLE TRIGGER USER');
    await pool.query('DELETE FROM commercial_documents WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE commercial_documents ENABLE TRIGGER USER');
    await pool.query('ALTER TABLE payment_notice_instructions DISABLE TRIGGER USER');
    await pool.query('DELETE FROM payment_notice_instructions WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE payment_notice_instructions ENABLE TRIGGER USER');
    for(const table of ['payment_authority_audit','payment_authority_support_usages','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions']) await pool.query(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
    await pool.query(`DELETE FROM payment_authority_audit WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_support_usages WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM package_variation_account_authority_allocations WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_decision_lines WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_decisions WHERE client_id=$1`,[fixture.client]);
    await pool.query(`DELETE FROM payment_authority_runs WHERE client_id=$1`,[fixture.client]);
    for(const table of ['payment_authority_audit','payment_authority_support_usages','package_variation_account_authority_allocations','payment_authority_decision_lines','payment_authority_decisions']) await pool.query(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
    await pool.query('ALTER TABLE package_payment_notice_snapshots DISABLE TRIGGER USER');
    await pool.query('DELETE FROM package_payment_notice_snapshots WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE package_payment_notice_snapshots ENABLE TRIGGER USER');
    await pool.query('DELETE FROM package_payment_notice_audit WHERE client_id=$1',[fixture.client]);
    await pool.query("DELETE FROM package_payment_notices WHERE client_id=$1 AND notice_type='pay_less_notice'",[fixture.client]);
    await pool.query('DELETE FROM package_payment_notices WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE package_intended_payment_decisions DISABLE TRIGGER USER');
    await pool.query('DELETE FROM package_intended_payment_decisions WHERE client_id=$1',[fixture.client]);
    await pool.query('ALTER TABLE package_intended_payment_decisions ENABLE TRIGGER USER');
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
    await pool.query('DELETE FROM subcontract_terms_versions WHERE client_id=$1',[fixture.client]);
    await pool.query('DELETE FROM subcontract_terms_families WHERE client_id=$1',[fixture.client]);
    await pool.query(`DELETE FROM clients WHERE id=$1`,[fixture.client]);
  }
});

test('combined approval atomically locks ordered work and creates canonical Payment Authority once',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('NORMAL');const input=body(fixture);
  const awaiting=await repository.listQueue(fixture.ids.client,fixture.auth);assert.equal(awaiting.length,1);assert.equal(awaiting[0].workflowState,'awaiting_approval');assert.equal(awaiting[0].packageId,fixture.ids.package);assert.equal(awaiting[0].orderedWorks,1000);assert.equal(awaiting[0].variations,0);assert.equal(awaiting[0].unapprovedAtLock,0);assert.equal(awaiting[0].intendedPayment,1140);assert.deepEqual({due:awaiting[0].dueDate,notice:awaiting[0].paymentNoticeDeadline,payLess:awaiting[0].payLessDeadline,final:awaiting[0].finalPaymentDate},{due:'2026-10-05',notice:'2026-10-10',payLess:'2026-10-14',final:'2026-10-19'});assert.equal(awaiting[0].gross,1000);assert.equal(awaiting[0].retention,50);assert.equal(awaiting[0].vat,190);assert.equal(awaiting[0].net,1140);assert.equal(awaiting[0].appliedPriorAuthority,0);
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
  const input=body(fixture,{cashAmount:1368,lines:[{assessmentId:va.assessment,exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'Work verified; formal instruction outstanding.',newCommercialAuthority:201,basis:'Payment Authority for locked QS assessment',supportUsages:[]}]});
  const excessive=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(excessive.ok,false);assert.match(excessive.message,/exceeds the locked unapproved assessment/);assert.equal((await counts(fixture.ids.certificate)).certificate.status,'submitted');
  assert.equal((await pool.query('SELECT status FROM package_variation_account_certificate_assessments WHERE id=$1',[va.assessment])).rows[0].status,'draft');
  input.lines[0].newCommercialAuthority=200;
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(result.ok,true,result.message);
  const assessment=(await pool.query('SELECT * FROM package_variation_account_certificate_assessments WHERE id=$1',[va.assessment])).rows[0];assert.equal(assessment.status,'locked');assert.equal(Number(assessment.source_authority_snapshot.unapprovedAmount),200);
  const line=(await pool.query('SELECT * FROM payment_authority_decision_lines WHERE decision_id=$1',[result.decisionId])).rows[0];assert.equal(line.assessment_id,va.assessment);assert.equal(Number(line.signed_assessment),200);assert.equal(Number(line.signed_unapproved_at_lock),200);assert.equal(Number(line.signed_new_commercial_authority),200);
  assert.equal(line.basis,'Work verified; formal instruction outstanding.');
  const decision=(await pool.query('SELECT source_snapshot FROM payment_authority_decisions WHERE id=$1',[result.decisionId])).rows[0];assert.equal(decision.source_snapshot.lines[0].exceptionalAuthorityDecision,'approve');assert.equal(decision.source_snapshot.lines[0].exceptionalAuthorityReason,'Work verified; formal instruction outstanding.');
  const allocation=(await pool.query('SELECT * FROM package_variation_account_authority_allocations WHERE payment_authority_decision_line_id=$1',[line.id])).rows[0];assert.equal(allocation.variation_account_item_id,va.va);assert.equal(Number(allocation.signed_allocated_amount),200);
  const history=(await repository.listQueue(fixture.ids.client,fixture.auth))[0];assert.equal(history.workflowState,'authorised');assert.equal(history.paymentAuthority.decisionId,result.decisionId);assert.equal(history.paymentAuthority.authorisedCash,1368);assert.equal(history.paymentAuthority.approvedBy.displayName,'Authenticated Approver');const historicalLine=history.lines.find(item=>item.assessmentId===va.assessment);assert.equal(historicalLine.unapprovedAtLock,200);assert.deepEqual(historicalLine.exceptionalAuthorityDecisions.map(item=>({granted:item.authorityGranted,active:item.activeAuthority,status:item.status,reason:item.reason,source:item.sourceType})),[{granted:200,active:200,status:'active',reason:'Work verified; formal instruction outstanding.',source:'payment_authority'}]);
});

test('unsupported assessment requires an explicit decision and human reason, while partial authority remains exact',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('EXPLICIT-VA');const va=await addVaAssessment(fixture,300);
  const withoutDecision=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{cashAmount:1482,lines:[{assessmentId:va.assessment,newCommercialAuthority:300,basis:'System default',supportUsages:[]}]}),fixture.auth);
  assert.equal(withoutDecision.ok,false);assert.match(withoutDecision.message,/explicit exceptional-authority decision/i);
  const blankReason=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{cashAmount:1482,lines:[{assessmentId:va.assessment,exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'   ',newCommercialAuthority:300,basis:'System default',supportUsages:[]}]}),fixture.auth);
  assert.equal(blankReason.ok,false);assert.match(blankReason.message,/human commercial reason/i);
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{cashAmount:1482,lines:[{assessmentId:va.assessment,exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'Verified portion only.',newCommercialAuthority:200,basis:'System default',supportUsages:[]}]}),fixture.auth);
  assert.equal(result.ok,true,result.message);
  const line=(await pool.query('SELECT signed_new_commercial_authority,basis FROM payment_authority_decision_lines WHERE decision_id=$1',[result.decisionId])).rows[0];assert.equal(Number(line.signed_new_commercial_authority),200);assert.equal(line.basis,'Verified portion only.');
  const allocation=(await pool.query('SELECT signed_allocated_amount FROM package_variation_account_authority_allocations WHERE payment_authority_decision_line_id IN (SELECT id FROM payment_authority_decision_lines WHERE decision_id=$1)',[result.decisionId])).rows[0];assert.equal(Number(allocation.signed_allocated_amount),200);
  const history=(await repository.listQueue(fixture.ids.client,fixture.auth))[0];const evidence=history.lines.find(item=>item.assessmentId===va.assessment).exceptionalAuthorityDecisions[0];assert.equal(evidence.unsupportedAtSubmission,300);assert.equal(evidence.authorityGranted,200);assert.equal(evidence.activeAuthority,200);
});

test('each unsupported VA requires its own explicit decision and persists its own reason',async t=>{
  if(!isDbConfigured())return t.skip();const fixture=await seed('MULTI-VA');const one=await addVaAssessment(fixture,100,'VA-A');const two=await addVaAssessment(fixture,150,'VA-B');
  const first={assessmentId:one.assessment,exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'Reason A',newCommercialAuthority:100,basis:'System provenance',supportUsages:[]};
  const denied=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{cashAmount:1425,lines:[first,{assessmentId:two.assessment,newCommercialAuthority:150,basis:'System provenance',supportUsages:[]}]}),fixture.auth);
  assert.equal(denied.ok,false);assert.match(denied.message,/explicit exceptional-authority decision/i);
  const second={assessmentId:two.assessment,exceptionalAuthorityDecision:'approve',exceptionalAuthorityReason:'Reason B',newCommercialAuthority:125,basis:'System provenance',supportUsages:[]};
  const result=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{cashAmount:1425,lines:[first,second]}),fixture.auth);assert.equal(result.ok,true,result.message);
  const lines=(await pool.query('SELECT signed_new_commercial_authority,basis FROM payment_authority_decision_lines WHERE decision_id=$1 ORDER BY signed_new_commercial_authority',[result.decisionId])).rows;
  assert.deepEqual(lines.map(row=>[Number(row.signed_new_commercial_authority),row.basis]),[[100,'Reason A'],[125,'Reason B']]);
  const history=(await repository.listQueue(fixture.ids.client,fixture.auth))[0];assert.deepEqual(history.lines.map(line=>line.exceptionalAuthorityDecisions.map(decision=>decision.reason)).filter(reasons=>reasons.length).sort(),[['Reason A'],['Reason B']]);
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


test('Slice 1 queue exposes frozen deadlines without creating notice or financial facts',async t=>{
 if(!isDbConfigured())return t.skip();const fixture=await seed('NOTICE-DISCLOSURE');
 const financialBefore=await counts(fixture.ids.certificate);
 const noticeCount=async()=>Number((await pool.query('SELECT count(*) n FROM package_payment_notices WHERE client_id=$1',[fixture.ids.client])).rows[0].n);
 const before=await noticeCount();const rows=await repository.listQueue(fixture.ids.client,fixture.auth);
 assert.equal(rows.length,1);const row=rows[0];assert.equal(row.eligible,true);
 assert.equal(row.noticeEvaluation.terms.rulesSchemaVersion,2);assert.equal(row.noticeEvaluation.mode,'certificate_as_payment_notice');
 assert.equal(row.noticeEvaluation.deadline.date,'2026-10-10');assert.equal(row.noticeEvaluation.clockSource,'server');assert.equal(row.noticeEvaluation.timezone,'Europe/London');
 assert.equal(row.noticeEvaluation.notifiedSum,row.net);assert.equal(row.noticeEvaluation.automationActive,false);assert.equal(row.noticeEvaluation.serviceState,'unverified');
 assert.equal(await noticeCount(),before);assert.deepEqual(await counts(fixture.ids.certificate),financialBefore);
});

const preparation=require('../services/paymentNoticePreparation');
async function enabledFixture(label,work){
 const fixture=await seed(label);const prior=process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;
 try{
  process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='true';
  fixture.auth.permissions.push(PERMISSIONS.PAYMENT_NOTICE_PREPARE,PERMISSIONS.DOCUMENT_GENERATE);
  const family=randomUUID(),version=randomUUID(),rules=structuredClone(completeTerms.paymentRules);
  if(['LOCKED','ISSUED'].includes(label))Object.assign(rules.notice,{paymentNoticeMode:'separate_payment_notice',paymentNoticeDocumentIdentity:'payment_notice',certificateDocumentConstitutesNotice:false});
  await pool.query("INSERT INTO subcontract_terms_families(id,client_id,name) VALUES($1,$2,$3)",[family,fixture.ids.client,'Preparation '+label]);
  await pool.query("INSERT INTO subcontract_terms_versions(id,client_id,family_id,revision_number,version_label,status,rules_schema_version,payment_rules) VALUES($1,$2,$3,2,'Rev 2','published',2,$4)",[version,fixture.ids.client,family,JSON.stringify(rules)]);
  const terms={...structuredClone(completeTerms),termsVersionId:version,paymentRules:rules,familyName:'Frozen terms',versionLabel:'Rev 2'};
  await pool.query("UPDATE package_payment_certificates SET payload=jsonb_set(payload,'{submissionGoverningTermsSnapshot}',$2::jsonb) WHERE id=$1",[fixture.ids.certificate,JSON.stringify(terms)]);
  await pool.query('ALTER TABLE package_payment_certificate_deadline_snapshots DISABLE TRIGGER USER');
  try{await pool.query("UPDATE package_payment_certificate_deadline_snapshots SET governing_terms_snapshot=$2,payment_notice_deadline='2099-11-30' WHERE certificate_id=$1",[fixture.ids.certificate,JSON.stringify(terms)]);}finally{await pool.query('ALTER TABLE package_payment_certificate_deadline_snapshots ENABLE TRIGGER USER');}
  const queue=await repository.listQueue(fixture.ids.client,fixture.auth);fixture.noticePreparationDisclosureHash=queue[0].noticePreparationOffer.disclosureHash;assert.equal(queue[0].noticePreparationOffer.outcome,'prepare');
  await work(fixture);
 }finally{if(prior===undefined)delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;else process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED=prior;}
}
const fakePdf=async()=>Buffer.from('%PDF-1.4 /Type /Page test');
test('Slice 2 combined approval freezes one instruction/job; replay and concurrent claims generate one unissued PDF',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('PREPARE',async fixture=>{
  const input=body(fixture,{confirmNoticePreparation:true});
  const [first,replay]=await Promise.all([repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth),repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth)]);
  assert.equal(first.ok,true,first.message);assert.equal(replay.ok,true,replay.message);assert.equal(first.decisionId,replay.decisionId);
  const original=await preparation.resultForDecision(pool,fixture.ids.client,first.decisionId);assert.equal(original.outcome,'prepare');assert(original.jobId);
  const again=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(again.noticePreparation.instructionId,original.instructionId);
  let renders=0;const render=async(...args)=>{renders++;return fakePdf(...args);};await Promise.all([preparation.processOne({clientId:fixture.ids.client,render}),preparation.processOne({clientId:fixture.ids.client,render})]);
  assert.equal(renders,1);const result=await preparation.resultForDecision(pool,fixture.ids.client,first.decisionId);assert.equal(result.status,'completed');
  const doc=(await pool.query('SELECT * FROM commercial_documents WHERE id=$1',[result.documentId])).rows[0];assert.equal(doc.status,'generated');assert.equal(doc.issued_at,null);assert.equal(doc.render_payload.notice.notifiedSum,1140);assert.match(doc.render_payload.notice.basisOfCalculation,/Gross GBP 1000.00/);assert.equal(doc.source_authority_id,original.instructionId);
  assert.equal(Number((await pool.query('SELECT count(*) n FROM package_payment_notices WHERE client_id=$1',[fixture.ids.client])).rows[0].n),0);
  await assert.rejects(pool.query("UPDATE payment_notice_instructions SET basis='rewritten' WHERE id=$1",[original.instructionId]),/immutable/);
  const issued=await require('../services/commercialDocumentRepository').issueDocument(fixture.ids.client,doc.id,{}, {auth:{...fixture.auth,permissions:[PERMISSIONS.DOCUMENT_ISSUE]}});assert.equal(issued.ok,false);assert.match(issued.message,/cannot be Issued/);
  const other=await preparation.resultForDecision(pool,randomUUID(),first.decisionId);assert.equal(other,null);
 });
});
test('Slice 2 failed rendering is owned, retried safely, recovers an expired lease and fences stale completion',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('RECOVER',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  await preparation.processOne({clientId:fixture.ids.client,render:async()=>{throw new Error('Renderer unavailable');}});
  let result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'pending');assert.match(result.failures[0].reason,/Renderer unavailable/);assert.equal(result.owner.userId,fixture.auth.userId);
  await pool.query("UPDATE payment_notice_preparation_jobs SET status='running',lease_token=gen_random_uuid(),lease_until=NOW()-INTERVAL '1 second',attempts=2 WHERE id=$1",[result.jobId]);
  await preparation.processOne({clientId:fixture.ids.client,render:fakePdf});result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'completed');assert(result.failures.some(f=>/lease expired/.test(f.reason)));
 });
});
test('Slice 2 unsupported authority creates an immutable exception while existing combined approval remains permitted',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('EXCEPTION',async fixture=>{
  fixture.auth.permissions=fixture.auth.permissions.filter(p=>p!==PERMISSIONS.PAYMENT_NOTICE_PREPARE);
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);assert.equal(approved.noticePreparation.outcome,'exception');assert.equal(approved.noticePreparation.jobId,null);
  assert(approved.noticePreparation.reasons.some(r=>/permissions/.test(r)));assert.equal(await preparation.processOne({clientId:fixture.ids.client,render:fakePdf}),false);
 });
});
test('Slice 2 already-Locked approval bypasses only the initial issued-notice prerequisite and retains cash limits',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('LOCKED',async fixture=>{
  const locked=await require('../services/paymentCertificateRepository').approveCertificateForPackage(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{version:2},{auth:fixture.auth,actor:fixture.auth.displayName});
  assert.equal(locked.ok,true,locked.message);
  const c=(await pool.query('SELECT version FROM package_payment_certificates WHERE id=$1',[fixture.ids.certificate])).rows[0];
  const input={...body(fixture,{confirmNoticePreparation:true}),certificateVersion:Number(c.version)};
  const unconfirmed=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[{...input,confirmNoticePreparation:false}]},fixture.auth);assert.equal(unconfirmed.results[0].ok,false);assert.match(unconfirmed.results[0].message,/Issued Payment Notice/);
  const excessive=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[{...input,idempotencyKey:randomUUID(),cashAmount:2000}]},fixture.auth);assert.equal(excessive.results[0].ok,false);assert.match(excessive.results[0].message,/exceeds/);
  const run=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[input]},fixture.auth);assert.equal(run.results[0].ok,true,run.results[0].message);assert.equal(run.results[0].noticePreparation.outcome,'prepare');
 });
});

test('Slice 2 bounds retries, retains failures and restricts retry to the correct tenant and permissions',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('RETRIES',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);const instruction=approved.noticePreparation.instructionId;
  for(let n=0;n<3;n++){await pool.query("UPDATE payment_notice_preparation_jobs SET available_at=NOW() WHERE client_id=$1 AND instruction_id=$2",[fixture.ids.client,instruction]);await preparation.processOne({clientId:fixture.ids.client,render:async()=>{throw new Error('Known render failure');}});}
  let result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'failed');assert.equal(result.attempts,3);assert.equal(await preparation.processOne({clientId:fixture.ids.client,render:fakePdf}),false);
  assert.equal((await preparation.retry(randomUUID(),instruction,fixture.auth)).ok,false);
  await assert.rejects(preparation.retry(fixture.ids.client,instruction,{...fixture.auth,permissions:[]}),/Permission required/);
  assert.equal((await preparation.retry(fixture.ids.client,instruction,fixture.auth)).ok,true);
  await preparation.processOne({clientId:fixture.ids.client,render:fakePdf});result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'completed');assert.equal(result.failures.length,4);
 });
});
test('Slice 2 instruction failure rolls back certificate, financial decision and preparation atomically',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('ATOMIC',async fixture=>{
  const original=preparation.persist;preparation.persist=async()=>{throw new Error('Instruction persistence failed');};
  try{await assert.rejects(repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth),/Instruction persistence failed/);}finally{preparation.persist=original;}
  const state=await counts(fixture.ids.certificate);assert.equal(state.certificate.status,'submitted');assert.equal(state.decisions,0);assert.equal(Number((await pool.query('SELECT count(*) n FROM payment_notice_instructions WHERE certificate_id=$1',[fixture.ids.certificate])).rows[0].n),0);
 });
});
test('Slice 2 expired final lease becomes an owned failure; stale worker cannot publish its PDF',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('FENCING',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);
  await preparation.processOne({clientId:fixture.ids.client,render:async()=>{await pool.query("UPDATE payment_notice_preparation_jobs SET lease_until=NOW()-INTERVAL '1 second',attempts=3 WHERE instruction_id=$1",[approved.noticePreparation.instructionId]);return fakePdf();}});
  assert.equal((await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId)).documentId,null);
  await preparation.processOne({clientId:fixture.ids.client,render:fakePdf});const result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'failed');assert.equal(result.documentId,null);
 });
});
test('Slice 2 opt-in never backfills an existing historical approval',async t=>{
 if(!isDbConfigured())return t.skip();const fixture=await seed('HISTORIC'),input=body(fixture);const approved=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(approved.ok,true);
 const previous=process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;try{process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='true';const replay=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(replay.noticePreparation,null);assert.equal(await preparation.processOne({clientId:fixture.ids.client,render:fakePdf}),false);}finally{if(previous===undefined)delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;else process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED=previous;}
});
test('Slice 2 runner is opt-in, serial and aborts its active task on shutdown',async t=>{
 if(!isDbConfigured())return t.skip();const {startPreparationRunner}=require('../services/paymentNoticePreparationRunner');
 const previous=process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;let calls=0;
 try{delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;const off=await startPreparationRunner({processOne:async()=>{calls++;}});await off.stop();assert.equal(calls,0);
 process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='true';const runner=await startPreparationRunner({intervalMs:1,processOne:({signal})=>{calls++;return new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));}});await new Promise(resolve=>setTimeout(resolve,15));assert.equal(calls,1);await runner.stop();assert.equal(calls,1);
 }finally{if(previous===undefined)delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;else process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED=previous;}
});

test('Slice 2 real Chromium PDF prepares without issue while the API event loop responds',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('CHROMIUM',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  const http=require('node:http'),puppeteer=require('puppeteer');
  const server=http.createServer((req,res)=>res.end('responsive'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;let done=false,requests=0,maxLatency=0;const start=Date.now();
  const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform==='win32'&&require('fs').existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
  const render=require('../services/commercialDocumentRenderer').renderCommercialDocumentPdf;
  const working=preparation.processOne({clientId:fixture.ids.client,render:(type,payload,options)=>render(type,payload,{...options,executablePath})}).finally(()=>{done=true;});
  try{while(!done){const at=Date.now();const response=await fetch(url,{signal:AbortSignal.timeout(2000)});assert.equal(await response.text(),'responsive');maxLatency=Math.max(maxLatency,Date.now()-at);requests++;await new Promise(resolve=>setTimeout(resolve,10));}await working;
   const result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'completed',JSON.stringify(result.failures));const doc=(await pool.query('SELECT binary_data,status,sha256 FROM commercial_documents WHERE id=$1',[result.documentId])).rows[0];assert.equal(doc.binary_data.subarray(0,4).toString(),'%PDF');assert.equal(doc.status,'generated');assert(requests>0);t.diagnostic(JSON.stringify({renderMs:Date.now()-start,healthRequests:requests,maxHealthLatencyMs:maxLatency,nodeRssMiB:Math.round(process.memoryUsage().rss/1048576)}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 });
});

test('Slice 2 existing issued history prevents duplicate initial preparation and retains Pay Less prerequisites',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('ISSUED',async fixture=>{
  const locked=await require('../services/paymentCertificateRepository').approveCertificateForPackage(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{version:2},{auth:fixture.auth,actor:fixture.auth.displayName});assert.equal(locked.ok,true);
  const pn=randomUUID(),pl=randomUUID();
  const addNotice=async(id,type,source)=>{await pool.query("INSERT INTO package_payment_notices(id,client_id,development_id,package_id,certificate_id,notice_type,notice_reference,status,source_notice_id) VALUES($1,$2,$3,$4,$5,$6,$7,'issued',$8)",[id,fixture.ids.client,fixture.ids.development,fixture.ids.package,fixture.ids.certificate,type,'NOTICE-'+id,source]);await pool.query("INSERT INTO package_payment_notice_snapshots(client_id,notice_id,development_id,package_id,certificate_id,notice_type,stage,attempt_number,notice_reference,notified_sum,source_notice_id) VALUES($1,$2,$3,$4,$5,$6,'issued',1,$7,1140,$8)",[fixture.ids.client,id,fixture.ids.development,fixture.ids.package,fixture.ids.certificate,type,'NOTICE-'+id,source]);};
  await addNotice(pn,'payment_notice',null);
  await pool.query("INSERT INTO package_intended_payment_decisions(client_id,development_id,package_id,certificate_id,decision_version,state,intended_amount,basis) VALUES($1,$2,$3,$4,1,'confirmed',1000,'Later confirmed reduction')",[fixture.ids.client,fixture.ids.development,fixture.ids.package,fixture.ids.certificate]);
  const c=(await pool.query('SELECT version FROM package_payment_certificates WHERE id=$1',[fixture.ids.certificate])).rows[0];
  const input=body(fixture,{certificateVersion:Number(c.version),cashAmount:1000,confirmNoticePreparation:true});
  const blocked=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[input]},fixture.auth);assert.equal(blocked.results[0].ok,false);assert.match(blocked.results[0].message,/Pay Less/);
  await addNotice(pl,'pay_less_notice',pn);
  const approved=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[input]},fixture.auth);assert.equal(approved.results[0].ok,true,approved.results[0].message);assert.equal(approved.results[0].noticePreparation.outcome,'existing_notice');assert.equal(approved.results[0].noticePreparation.jobId,null);
 });
});

test('Slice 2 binds approval to its disclosed notice content and keeps jobs invisible before commit',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('DISCLOSURE',async fixture=>{
  const input=body(fixture,{confirmNoticePreparation:true});
  const stale=await repository.approveSubmittedCertificate(fixture.ids.client,{...input,noticePreparationDisclosureHash:'changed'},fixture.auth);assert.equal(stale.ok,false);assert.match(stale.message,/disclosure changed/);assert.equal((await counts(fixture.ids.certificate)).certificate.status,'submitted');
  const persist=preparation.persist;let invisible=false;
  preparation.persist=async(db,...args)=>{const result=await persist(db,...args);assert.equal(await preparation.claim(pool,fixture.ids.client),null);invisible=true;return result;};
  try{const approved=await repository.approveSubmittedCertificate(fixture.ids.client,input,fixture.auth);assert.equal(approved.ok,true,approved.message);assert.equal(invisible,true);assert(approved.noticePreparation.jobId);}finally{preparation.persist=persist;}
 });
});

const noticeRepository=require('../services/paymentNoticeRepository');
const manualNotice=fixture=>noticeRepository.createPaymentNotice(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{reference:'REC-'+randomUUID(),basisOfCalculation:'Manual recovery of certificate valuation',actor:fixture.auth.displayName},{auth:fixture.auth});
async function reversePreparation(fixture,approved){return repository.reverseDecision(fixture.ids.client,approved.decisionId,{idempotencyKey:randomUUID(),reason:'Reviewed reversal for manual notice recovery'},{...fixture.auth,permissions:[...fixture.auth.permissions,PERMISSIONS.PAYMENT_AUTHORITY_REVERSE]});}

test('review correction: failed preparation permits authorised manual recovery, preserves immutable evidence and permanently blocks automation',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('MANUAL-FAILED',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  const original=(await pool.query('SELECT * FROM payment_notice_instructions WHERE id=$1',[approved.noticePreparation.instructionId])).rows[0];
  await pool.query('UPDATE payment_notice_preparation_jobs SET attempts=2 WHERE instruction_id=$1',[original.id]);
  await preparation.processOne({clientId:fixture.ids.client,render:async()=>{throw Error('Definitive renderer failure');}});
  assert.equal((await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId)).status,'failed');
  process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='false';
  await assert.rejects(noticeRepository.createPaymentNotice(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{}, {auth:{...fixture.auth,permissions:[]}}),/Permission required/);
  const [manual,claim]=await Promise.all([manualNotice(fixture),preparation.claim(pool,fixture.ids.client)]);assert.equal(manual.ok,true,manual.message);assert.equal(claim,null);assert.equal(manual.notice.status,'draft');
  assert.equal((await manualNotice(fixture)).ok,false);assert.equal((await preparation.retry(fixture.ids.client,original.id,fixture.auth)).ok,false);
  const audit=(await pool.query("SELECT * FROM package_payment_notice_audit WHERE notice_id=$1 AND action='manual_preparation_recovery'",[manual.notice.id])).rows[0];assert.equal(audit.detail.instructionId,original.id);assert.equal(audit.detail.jobStatus,'failed');
  assert.deepEqual((await pool.query('SELECT * FROM payment_notice_instructions WHERE id=$1',[original.id])).rows[0],original);
  await pool.query("UPDATE package_payment_notices SET status='voided' WHERE id=$1",[manual.notice.id]);assert.equal(await preparation.claim(pool,fixture.ids.client),null);assert.equal((await preparation.retry(fixture.ids.client,original.id,fixture.auth)).ok,false);assert.equal(await preparation.processOne({clientId:fixture.ids.client,render:fakePdf}),false);
 });
});

test('review correction: pending, running and successfully completed preparation still block competing manual notices',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('MANUAL-BLOCKED',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  await assert.rejects(manualNotice(fixture),/active or completed/);
  const running=await preparation.claim(pool,fixture.ids.client);assert(running);await assert.rejects(manualNotice(fixture),/active or completed/);
  await pool.query("UPDATE payment_notice_preparation_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",[running.id]);await preparation.processOne({clientId:fixture.ids.client,render:fakePdf});
  assert.equal((await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId)).status,'completed');await assert.rejects(manualNotice(fixture),/active or completed/);
 });
});

test('review correction: reversed approval permits manual recovery from pending and completed jobs without rewriting prepared PDFs',async t=>{
 if(!isDbConfigured())return t.skip();for(const completed of [false,true])await enabledFixture('MANUAL-REVERSED-'+completed,async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  if(completed)await preparation.processOne({clientId:fixture.ids.client,render:fakePdf});const before=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);
  const reversed=await reversePreparation(fixture,approved);assert.equal(reversed.ok,true,reversed.message);
  const manual=await manualNotice(fixture);assert.equal(manual.ok,true,manual.message);const after=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(after.status,completed?'completed':'failed');
  if(completed){assert.equal(after.documentId,before.documentId);const doc=(await pool.query('SELECT status,issued_at FROM commercial_documents WHERE id=$1',[after.documentId])).rows[0];assert.equal(doc.status,'generated');assert.equal(doc.issued_at,null);}
  const audit=(await pool.query("SELECT detail FROM package_payment_notice_audit WHERE notice_id=$1 AND action='manual_preparation_recovery'",[manual.notice.id])).rows[0];assert(audit.detail.reversalIds.includes(reversed.decisionId));assert.equal(await preparation.claim(pool,fixture.ids.client),null);
 });
});

test('review correction: manual recovery fences an in-flight worker after reversal and prevents racing job claims',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('MANUAL-RACE',async fixture=>{
  const approved=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture,{confirmNoticePreparation:true}),fixture.auth);assert.equal(approved.ok,true,approved.message);
  let enter,release;const started=new Promise(resolve=>{enter=resolve;}),finish=new Promise(resolve=>{release=resolve;});
  const worker=preparation.processOne({clientId:fixture.ids.client,render:async()=>{enter();await finish;return fakePdf();}});
  try{await started;const reversed=await reversePreparation(fixture,approved);assert.equal(reversed.ok,true,reversed.message);const [manual,claimed]=await Promise.all([manualNotice(fixture),preparation.claim(pool,fixture.ids.client)]);assert.equal(manual.ok,true,manual.message);assert.equal(claimed,null);}finally{release();await worker;}
  const result=await preparation.resultForDecision(pool,fixture.ids.client,approved.decisionId);assert.equal(result.status,'failed');assert.equal(result.documentId,null);assert(result.failures.some(f=>/Manual recovery/.test(f.reason)));assert.equal((await preparation.retry(fixture.ids.client,result.instructionId,fixture.auth)).ok,false);
 });
});

test('review correction: feature disabled preserves both approval paths and creates no instructions or jobs',async t=>{
 if(!isDbConfigured())return t.skip();const previous=process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;try{process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='false';
 for(const path of ['combined','locked']){const fixture=await seed('DISABLED-'+path);let result;if(path==='combined')result=await repository.approveSubmittedCertificate(fixture.ids.client,body(fixture),fixture.auth);else{const locked=await require('../services/paymentCertificateRepository').approveCertificateForPackage(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{version:2},{auth:fixture.auth,actor:fixture.auth.displayName});assert.equal(locked.ok,true);const version=Number((await pool.query('SELECT version FROM package_payment_certificates WHERE id=$1',[fixture.ids.certificate])).rows[0].version);const run=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[body(fixture,{certificateVersion:version})]},fixture.auth);result=run.results[0];}assert.equal(result.ok,true,result.message);assert.equal(Number((await pool.query('SELECT count(*) n FROM payment_notice_instructions WHERE client_id=$1',[fixture.ids.client])).rows[0].n),0);assert.equal(Number((await pool.query('SELECT count(*) n FROM payment_notice_preparation_jobs WHERE client_id=$1',[fixture.ids.client])).rows[0].n),0);}
 }finally{if(previous===undefined)delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;else process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED=previous;}
});

test('review correction: legacy Locked certificate without frozen terms gets an exception plan and retains stale/unsupported approval rejection',async t=>{
 if(!isDbConfigured())return t.skip();await enabledFixture('LEGACY-LOCKED',async fixture=>{
  await pool.query("UPDATE package_payment_certificates SET payload=payload-'submissionGoverningTermsSnapshot' WHERE id=$1",[fixture.ids.certificate]);
  const locked=await require('../services/paymentCertificateRepository').approveCertificateForPackage(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{version:2},{auth:fixture.auth,actor:fixture.auth.displayName});assert.equal(locked.ok,true,locked.message);
  const facts=await repository.loadLockedFacts(pool,fixture.ids.client,fixture.ids.certificate);assert.equal(preparation.evaluatePreparation(facts,fixture.auth,true).outcome,'exception');assert.equal(repository.eligibility(facts).eligible,true);
  const stale=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[body(fixture,{certificateVersion:999,confirmNoticePreparation:true})]},fixture.auth);assert.equal(stale.results[0].ok,false);assert.match(stale.results[0].message,/version changed/);
  const unsupported={...facts,readiness:{state:'configuration_unavailable',mode:null}};assert.equal(repository.eligibility(unsupported).eligible,false);
  const approved=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[body(fixture,{certificateVersion:Number(facts.certificate.version),confirmNoticePreparation:true})]},fixture.auth);assert.equal(approved.results[0].ok,true,approved.results[0].message);assert.equal(approved.results[0].noticePreparation.outcome,'exception');assert.equal(approved.results[0].noticePreparation.jobId,null);
 });
});

test('review correction: unsupported legacy Locked request remains rejected through the real approval path',async t=>{
 if(!isDbConfigured())return t.skip();const previous=process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;try{process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED='true';const fixture=await seed('UNSUPPORTED-LOCKED',{warnings:true});
 const locked=await require('../services/paymentCertificateRepository').approveCertificateForPackage(fixture.ids.client,fixture.ids.package,fixture.ids.certificate,{version:2},{auth:fixture.auth,actor:fixture.auth.displayName});assert.equal(locked.ok,true,locked.message);
 const version=Number((await pool.query('SELECT version FROM package_payment_certificates WHERE id=$1',[fixture.ids.certificate])).rows[0].version);
 const run=await repository.approveRun(fixture.ids.client,{idempotencyKey:randomUUID(),decisions:[body(fixture,{certificateVersion:version,confirmNoticePreparation:true})]},fixture.auth);assert.equal(run.results[0].ok,false);assert.match(run.results[0].message,/authority is unavailable|Issued Payment Notice/);assert.equal((await counts(fixture.ids.certificate)).decisions,0);
 }finally{if(previous===undefined)delete process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED;else process.env.BUILDLITE_NOTICE_PREPARATION_ENABLED=previous;}
});
