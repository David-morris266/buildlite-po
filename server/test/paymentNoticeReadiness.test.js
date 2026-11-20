const test=require('node:test');
const assert=require('node:assert/strict');
const {buildNoticeReadiness,londonDate}=require('../services/paymentNoticeReadiness');
const {PERMISSIONS:P}=require('../auth/permissions');
const rules={configurationState:'complete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'},notice:{paymentNoticeMode:'separate_payment_notice',paymentNoticeIssuer:'company',payLessIssuer:'company',paymentNoticeDocumentIdentity:'payment_notice',certificateDocumentConstitutesNotice:false,basisOfCalculationRequired:true,payLessWorkflowSupported:true}};
const terms={familyName:'Company terms',versionLabel:'2026',revisionNumber:2,termsVersionId:'terms-2',rulesSchemaVersion:2,paymentRules:rules};
const timetable={state:'locked',governingTermsSnapshot:terms,dates:{paymentNoticeDeadline:'2026-11-13',payLessNoticeDeadline:'2026-11-29',finalDateForPayment:'2026-12-06'}};
const auth={userId:'same-user',clientId:'tenant-a',membershipId:'member-a',roleKey:'qs',permissions:[P.COMMERCIAL_READ,P.PAYMENT_NOTICE_PREPARE,P.PAYMENT_NOTICE_ISSUE,P.PAY_LESS_PREPARE,P.PAY_LESS_ISSUE,P.INTENDED_PAYMENT_PROPOSE]};
const args=()=>({clientId:'tenant-a',certificate:{id:'cert',status:'locked'},timetable:structuredClone(timetable),notices:[],auth,now:new Date('2026-11-20T12:00:00Z')});

test('server London date classifies upcoming, today, overdue and missing dates including BST midnight',()=>{
  const input=args(),r=buildNoticeReadiness(input);
  assert.equal(r.asOfDate,'2026-11-20');assert.equal(r.paymentNotice.deadline.state,'overdue');assert.equal(r.payLess.deadline.state,'upcoming');
  input.now=new Date('2026-11-13T12:00:00Z');assert.equal(buildNoticeReadiness(input).paymentNotice.deadline.state,'today');
  input.timetable.dates={};assert.equal(buildNoticeReadiness(input).paymentNotice.deadline.state,'not_captured');
  assert.equal(londonDate('2026-07-01T23:30:00Z'),'2026-07-02');assert.equal(londonDate('2026-12-01T23:30:00Z'),'2026-12-01');
});
test('readiness before approval is provisional/submitted evidence, never permission to write pre-approval notices',()=>{
  for(const status of ['draft','submitted']){const input=args();input.certificate.status=status;input.timetable.state=status==='draft'?'live':'submission';const r=buildNoticeReadiness(input);assert.equal(r.terms.frozen,status==='submitted');assert.equal(r.permissions.preparePaymentNotice.allowed,false);assert.equal(r.preApprovalAuthority.authoriseNotifiedSum,false);assert(r.warnings.some(w=>w.code==='pre_approval_authority_unavailable'));}
});
test('effective tenant permissions, not role names, control current actions; no hard-coded segregation is added',()=>{
  const r=buildNoticeReadiness(args());assert.equal(r.permissions.preparePaymentNotice.allowed,true);assert.equal(r.permissions.issuePaymentNotice.allowed,true);
  const input=args();input.auth={...auth,roleKey:'commercial_director',permissions:[P.COMMERCIAL_READ,P.PAYMENT_NOTICE_PREPARE]};const limited=buildNoticeReadiness(input);assert.equal(limited.permissions.issuePaymentNotice.allowed,false);
  input.auth={...auth,clientId:'tenant-b'};assert(Object.values(buildNoticeReadiness(input).permissions).every(p=>!p.granted));
});
test('missing configuration and legacy terms fail closed without manufacturing current defaults',()=>{
  const input=args();input.timetable=null;const unknown=buildNoticeReadiness(input);assert.equal(unknown.configuration.state,'configuration_unavailable');assert(Object.values(unknown.permissions).every(p=>!p.allowed));assert.equal(unknown.terms.termsVersionId,null);
  input.timetable=structuredClone(timetable);input.timetable.governingTermsSnapshot.rulesSchemaVersion=1;assert.match(buildNoticeReadiness(input).configuration.reasons[0],/V1/);
});
test('proposal permission is independent of confirmation and leaves other notice permissions unchanged',()=>{
  const input=args();const proposal=buildNoticeReadiness(input);
  assert.equal(proposal.permissions.proposeIntendedPayment.permission,P.INTENDED_PAYMENT_PROPOSE);assert.equal(proposal.permissions.proposeIntendedPayment.allowed,true);
  assert.equal(proposal.permissions.confirmIntendedPayment.permission,P.INTENDED_PAYMENT_CONFIRM);assert.equal(proposal.permissions.confirmIntendedPayment.allowed,false);
  input.auth={...auth,permissions:auth.permissions.filter(p=>p!==P.INTENDED_PAYMENT_PROPOSE).concat(P.INTENDED_PAYMENT_CONFIRM)};
  const confirmation=buildNoticeReadiness(input);assert.equal(confirmation.permissions.proposeIntendedPayment.allowed,false);
  assert.equal(confirmation.permissions.confirmIntendedPayment.allowed,true);
  input.auth={...auth,permissions:[P.INTENDED_PAYMENT_PROPOSE,P.INTENDED_PAYMENT_CONFIRM]};const both=buildNoticeReadiness(input);assert.equal(both.permissions.proposeIntendedPayment.allowed,true);assert.equal(both.permissions.confirmIntendedPayment.allowed,true);
  input.auth={...auth,permissions:[]};const neither=buildNoticeReadiness(input);assert.equal(neither.permissions.proposeIntendedPayment.allowed,false);assert.equal(neither.permissions.confirmIntendedPayment.allowed,false);
  for(const key of ['preparePaymentNotice','issuePaymentNotice','preparePayLess','issuePayLess'])assert.deepEqual(confirmation.permissions[key],proposal.permissions[key]);
});
test('prepared and internally issued states never assert service or hide a late internal issue',()=>{
  const input=args();input.notices=[{type:'payment_notice',status:'prepared',reference:'PN-1'}];assert.equal(buildNoticeReadiness(input).paymentNotice.state,'prepared');
  input.notices[0]={type:'payment_notice',status:'issued',reference:'PN-1',issuedSnapshot:{capturedAt:'2026-11-14T10:00:00Z',paymentNoticeDeadline:'2026-11-13',servedAt:'invented'}};
  const r=buildNoticeReadiness(input);assert.equal(r.paymentNotice.state,'issued');assert.equal(r.paymentNotice.serviceState,'unverified');assert.equal(r.paymentNotice.internalIssueTiming,'late');assert(r.warnings.some(w=>w.code==='late_internal_issue'));
  const before=JSON.stringify(input);buildNoticeReadiness(input);assert.equal(JSON.stringify(input),before);
});

// Production repository and HTTP path, backed exclusively by an in-memory SELECT adapter.
let currentAdapter;
const db={query:(...a)=>currentAdapter.query(...a),pool:{query:(...a)=>currentAdapter.query(...a),connect:async()=>({query:(...a)=>currentAdapter.query(...a),release(){}})}};
const id=require.resolve('../db');require.cache[id]={id,filename:id,loaded:true,exports:db};
const activeId=require.resolve('../services/activeClient');require.cache[activeId]={id:activeId,filename:activeId,loaded:true,exports:{getActiveClient:async()=>({id:'tenant-a'})}};
const repo=require('../services/paymentNoticeRepository');
function adapter(status='locked',{missingLocked=false,version=2}={}){
  const calls=[],snapshot={id:'deadline',stage:status==='submitted'?'submission':'locked',attempt_number:1,certificate_version:2,readiness:'ready',calculation_status:'calculated',rules_schema_version:version,governing_terms_snapshot:{...terms,rulesSchemaVersion:version},payment_notice_deadline:'2026-11-13',pay_less_notice_deadline:'2026-11-29',final_date_for_payment:'2026-12-06',due_date:'2026-11-08'};
  return {calls,query:async(sql,params=[])=>{
    calls.push({sql,params});if(['BEGIN','ROLLBACK'].includes(sql))return {rows:[]};assert.match(sql.trim(),/^SELECT/,'Readiness and rejected creation must never write');assert.equal(params[0],'tenant-a');
    if(sql.includes('FROM package_payment_certificates c'))return {rows:params[1]==='pkg'&&params[2]==='cert'?[{id:'cert',status,certificate_number:1,contractual_valuation_date:'2026-11-01',development_id:'dev',net_value:5890}]:[]};
    if(sql.includes('FROM package_payment_certificate_deadline_snapshots'))return {rows:sql.includes("stage='locked'")?(status==='locked'&&!missingLocked?[snapshot]:[]):[snapshot]};
    if(sql.includes('FROM package_payment_notices')||sql.includes('FROM package_intended_payment_decisions')||sql.includes('FROM subcontract_payment_applications'))return {rows:[]};
    if(sql.includes('SELECT po_number FROM package_purchase_orders'))return {rows:[{po_number:'S1'}]};
    if(sql.includes('FROM purchase_order_terms_bindings'))return {rows:[{id:'binding',terms_version_id:'terms-2',resolved_source:'order_override'}]};
    if(sql.includes('FROM subcontract_terms_versions v'))return {rows:[{id:'terms-2',family_name:'Company terms',revision_number:2,status:'published',rules_schema_version:2,payment_rules:rules}]};
    throw Error('Unexpected query '+sql);
  }};
}
test('production read route rejects client as-of dates, enforces permissions and isolates tenants',async()=>{
  const express=require('express'),request=require('supertest'),router=require('../routes/paymentNoticeRoutes');
  let principal=auth;const app=express();app.use((req,res,next)=>{req.buildliteAuth=principal;next();});app.use('/api',router);
  currentAdapter=adapter();let response=await request(app).get('/api/packages/pkg/certificates/cert/payment-authority?asOfDate=1900-01-01');
  assert.equal(response.status,200);assert.equal(response.body.readiness.asOfDate,londonDate(new Date()));assert.equal(response.body.readiness.clockSource,'server');
  principal={...auth,permissions:[]};response=await request(app).get('/api/packages/pkg/certificates/cert/payment-authority');assert.equal(response.status,403);
  principal={...auth,clientId:'tenant-b'};const before=currentAdapter.calls.length;response=await request(app).get('/api/packages/pkg/certificates/cert/payment-authority');assert.equal(response.status,404);assert.equal(currentAdapter.calls.length,before);
  principal=auth;response=await request(app).get('/api/packages/other/certificates/cert/payment-authority');assert.equal(response.status,404);
});
test('production repository uses live Draft / frozen Submitted / frozen Locked timetable without changing terms',async()=>{
  for(const status of ['draft','submitted','locked']){const a=adapter(status),r=await repo.getWorkspace('tenant-a','pkg','cert',a,'2026-11-20',{auth,now:new Date('2026-11-20T12:00:00Z')});assert.equal(r.ok,true);assert.equal(r.readiness.terms.evidenceState,status==='draft'?'live':status==='submitted'?'submission':'locked');assert(a.calls.every(c=>c.sql.trim().startsWith('SELECT')));}
  const a=adapter('locked',{missingLocked:true});const result=await repo.getWorkspace('tenant-a','pkg','cert',a,null,{auth});assert.equal(result.readiness.configuration.state,'configuration_unavailable');assert(!a.calls.some(c=>c.sql.includes('FROM subcontract_terms_versions')));
});
test('existing locked-certificate and missing-config creation guards remain intact',async()=>{
  currentAdapter=adapter('draft');let r=await repo.createPaymentNotice('tenant-a','pkg','cert',{}, {auth});assert.equal(r.status,409);assert.match(r.message,/Locked/);
  currentAdapter=adapter('locked',{version:1});r=await repo.createPaymentNotice('tenant-a','pkg','cert',{}, {auth});assert.equal(r.status,409);assert.match(r.message,/configuration/);assert(!currentAdapter.calls.some(c=>c.sql.includes('INSERT')));
});
test('existing HTTP permission enforcement persists proposals and confirmations only for their respective grants',async()=>{
  const express=require('express'),request=require('supertest'),router=require('../routes/paymentNoticeRoutes');
  const writes=[],base=adapter();
  currentAdapter={query:async(sql,params=[])=>{
    if(sql.includes('INSERT INTO authorization_action_audit')||sql==='COMMIT')return {rows:[]};
    if(sql.includes('SELECT COALESCE(MAX(decision_version)'))return {rows:[{n:writes.length+1}]};
    if(sql.includes('INSERT INTO package_intended_payment_decisions')){assert.equal(params[0],'tenant-a');writes.push(params);return {rows:[{id:`decision-${writes.length}`,state:params[5]}]};}
    return base.query(sql,params);
  }};
  let principal={...auth,displayName:'QS proposer',permissions:[P.INTENDED_PAYMENT_PROPOSE]};
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.buildliteAuth=principal;next();});app.use('/api',router);
  const url='/api/packages/pkg/certificates/cert/intended-payments';
  let response=await request(app).post(url).send({intendedAmount:5890,confirm:false,actor:'Untrusted browser name'});
  assert.equal(response.status,201);assert.equal(response.body.decision.state,'proposed');assert.equal(writes[0][5],'proposed');assert.equal(writes[0][9],'QS proposer');
  response=await request(app).post(url).send({intendedAmount:5890,confirm:true});assert.equal(response.status,403);assert.equal(writes.length,1);
  principal={...principal,permissions:[P.INTENDED_PAYMENT_CONFIRM]};
  response=await request(app).post(url).send({intendedAmount:5890,confirm:false});assert.equal(response.status,403);assert.equal(writes.length,1);
  response=await request(app).post(url).send({intendedAmount:5890,confirm:true});assert.equal(response.status,201);assert.equal(response.body.decision.state,'confirmed');assert.equal(writes[1][5],'confirmed');
});
test('production intended-payment decisions enable Pay Less review and preparation only after confirmation',async()=>{
  const decisions=[],base=adapter();let payLess=null;
  const payment={id:'pn',client_id:'tenant-a',package_id:'pkg',certificate_id:'cert',development_id:'dev',notice_type:'payment_notice',notice_reference:'PN-1',status:'issued',version:3};
  currentAdapter={query:async(sql,params=[])=>{
    if(sql==='COMMIT')return {rows:[]};
    if(sql.includes('SELECT COALESCE(MAX(decision_version)'))return {rows:[{n:decisions.length+1}]};
    if(sql.includes('INSERT INTO package_intended_payment_decisions')){const row={id:`decision-${decisions.length+1}`,decision_version:params[4],state:params[5],intended_amount:params[6],source:params[7],basis:params[8],actor:params[9]};decisions.unshift(row);return {rows:[row]};}
    if(sql.includes('FROM package_intended_payment_decisions'))return {rows:sql.includes("state='confirmed'")?decisions.filter(d=>d.state==='confirmed').slice(0,1):decisions};
    if(sql.includes('SELECT n.id,s.notified_sum,s.pay_less_deadline'))return {rows:[{id:'pn',notified_sum:5890,pay_less_deadline:'2026-11-29'}]};
    if(sql.includes('SELECT * FROM package_payment_notices'))return {rows:payLess?[payment,payLess]:[payment]};
    if(sql.includes('FROM package_payment_notice_snapshots'))return {rows:params[1]==='pn'?[{id:'pn-issued',stage:'issued',attempt_number:1,notice_reference:'PN-1',notified_sum:5890,pay_less_deadline:'2026-11-29'}]:[]};
    if(sql.includes('INSERT INTO package_payment_notices')){payLess={id:'pl',client_id:params[0],development_id:params[1],package_id:params[2],certificate_id:params[3],notice_type:'pay_less_notice',notice_reference:params[4],source_notice_id:params[5],draft_data:JSON.parse(params[6]),status:'draft',version:1};return {rows:[payLess]};}
    if(sql.includes('package_payment_notice_audit'))return {rows:[]};
    return base.query(sql,params);
  }};
  const proposer={...auth,displayName:'QS',permissions:[P.INTENDED_PAYMENT_PROPOSE,P.PAY_LESS_PREPARE]};
  let result=await repo.createDecision('tenant-a','pkg','cert',{intendedAmount:5000,confirm:false,actor:'QS'},{auth:proposer});assert.equal(result.decision.state,'proposed');
  let workspace=await repo.getWorkspace('tenant-a','pkg','cert',null,'2026-11-20');assert.equal(workspace.payLess.state,'no_intended_payment');assert.equal(workspace.payLess.intendedPayment,null);
  assert.equal((await repo.createPayLess('tenant-a','pkg','cert',{}, {auth:proposer})).status,409);assert.equal(payLess,null);
  const confirmer={...auth,displayName:'Commercial Manager',permissions:[P.INTENDED_PAYMENT_CONFIRM,P.PAY_LESS_PREPARE]};
  result=await repo.createDecision('tenant-a','pkg','cert',{intendedAmount:5000,confirm:true,actor:'Commercial Manager'},{auth:confirmer});assert.equal(result.decision.state,'confirmed');
  workspace=await repo.getWorkspace('tenant-a','pkg','cert',null,'2026-11-20');assert.equal(workspace.payLess.state,'review_required');assert.equal(workspace.payLess.reduction,890);assert.equal(workspace.payLess.intendedPayment,5000);
  result=await repo.createPayLess('tenant-a','pkg','cert',{actor:'Commercial Manager'},{auth:confirmer});assert.equal(result.ok,true);assert.equal(result.notice.status,'draft');assert.equal(result.notice.draft.intendedPaymentDecisionId,'decision-2');
  assert.deepEqual(decisions.map(d=>d.state),['confirmed','proposed']);
});
