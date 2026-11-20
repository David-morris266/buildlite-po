const test=require('node:test');
const assert=require('node:assert/strict');
const {evaluateApprovalNotice:evaluate,compareNoticeDeadline}=require('../services/paymentApprovalNoticeEvaluation');
const repo=require('../services/paymentAuthorityRepository');
const rules={configurationState:'complete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'},notice:{paymentNoticeMode:'separate_payment_notice',paymentNoticeIssuer:'company',payLessIssuer:'company',paymentNoticeDocumentIdentity:'payment_notice',certificateDocumentConstitutesNotice:false,basisOfCalculationRequired:true,payLessWorkflowSupported:true}};
const terms={familyName:'Company terms',versionLabel:'2026',revisionNumber:2,termsVersionId:'terms-2',rulesSchemaVersion:2,paymentRules:rules};
const now=new Date('2026-11-20T12:00:00Z');
const facts=()=>({certificate:{status:'locked',net_value:6200},deadline:{governing_terms_snapshot:structuredClone(terms),payment_notice_deadline:'2026-11-23',pay_less_notice_deadline:'2026-12-01',final_date_for_payment:'2026-12-08'},readiness:{state:'ready',mode:'separate_payment_notice'},paymentNotice:null,payLess:null,intended:null,priorCash:0});
test('frozen V2 supports disclosure only; V1 never takes a company default or invents a sum',()=>{
 const f=facts(),r=evaluate(f,undefined,now);assert.equal(r.classification,'future_preparation_supported');assert.equal(r.notifiedSum,6200);assert.equal(r.basis,null);assert.equal(r.terms.termsVersionId,'terms-2');assert.equal(r.automationActive,false);
 f.deadline.governing_terms_snapshot={rulesSchemaVersion:1,revisionNumber:1,termsVersionId:'terms-1'};const legacy=evaluate(f,undefined,now);assert.equal(legacy.classification,'configuration_exception');assert.equal(legacy.notifiedSum,null);assert.equal(legacy.type,null);assert.equal(legacy.deadline.date,'2026-11-23');assert.equal(legacy.terms.termsVersionId,'terms-1');
});
test('server London calendar exposes today, approaching, overdue and absent deadlines before approval',()=>{
 const f=facts();f.certificate.status='submitted';assert.equal(evaluate(f,undefined,now).deadline.state,'approaching');
 f.deadline.payment_notice_deadline='2026-11-20';assert.equal(evaluate(f,undefined,now).deadline.state,'today');
 f.deadline.payment_notice_deadline='2026-11-19';assert.equal(evaluate(f,undefined,now).classification,'contractual_exception');
 f.deadline.payment_notice_deadline=null;assert.equal(evaluate(f,undefined,now).deadline.state,'unavailable');
 f.deadline.payment_notice_deadline='2026-07-02';assert.equal(evaluate(f,undefined,new Date('2026-07-01T23:30:00Z')).deadline.state,'today');
});
test('issued evidence and confirmed later reduction are distinct from application differences',()=>{
 const f=facts();f.application={claim:8500};assert.equal(evaluate(f,undefined,now).type,'payment_notice');
 f.paymentNotice={id:'pn-s',notice_id:'pn',notice_reference:'PN-1',notified_sum:8500,basis_of_calculation:'Frozen basis'};
 assert.equal(evaluate(f,undefined,now).classification,'existing_issued_notice');assert.equal(evaluate(f,undefined,now).basis,'Frozen basis');
 f.intended={intended_amount:6200};assert.equal(evaluate(f,undefined,now).type,'pay_less_notice');
 f.payLess={id:'pl-s',source_notice_id:'wrong'};assert.equal(evaluate(f,undefined,now).payLess,null);
 f.payLess.source_notice_id='pn';assert.equal(evaluate(f,undefined,now).classification,'existing_issued_notice');
});
test('permission disclosure does not change either current approval path or acknowledgements',()=>{
 const f=facts();const before=structuredClone(f);const r=evaluate(f,{permissions:[]},now);assert.equal(r.classification,'authority_exception');assert.deepEqual(f,before);
 assert.equal(repo.eligibility(f).eligible,false);assert.match(repo.eligibility(f).reasons.join(' '),/Issued Payment Notice/);
 const combined=repo.combinedApprovalReadiness(f);assert.equal(combined.eligible,true);assert(combined.warnings.some(w=>w.code==='payment_notice_incomplete'));
 const evidence=repo.approvalIssueEvidence(combined.warnings,[],{warningAcknowledgements:[]},2,3,{});assert.equal(evidence.ok,true);assert(evidence.evidence.every(w=>w.acknowledgementRequired===false));
 assert.equal(repo.approvalIssueEvidence([], [{code:'cash_differs_from_payment_position'}],{warningAcknowledgements:[]},2,3,{}).ok,false);
});
test('pending notice deadlines sort before later and already-issued notices without changing amounts',()=>{
 const row=date=>({noticeEvaluation:{type:'payment_notice',classification:'future_preparation_supported',deadline:{date}},net:6200});
 const rows=[row('2026-12-01'),row('2026-11-19'),{...row('2026-11-01'),noticeEvaluation:{type:'payment_notice',classification:'existing_issued_notice',deadline:{date:'2026-11-01'}}}];rows.sort(compareNoticeDeadline);assert.equal(rows[0].noticeEvaluation.deadline.date,'2026-11-19');assert(rows.every(r=>r.net===6200));
});

test('issued Payment Notice and Pay Less retain identity without outstanding deadline escalation',()=>{
 for(const type of ['payment_notice','pay_less_notice']){
  const f=facts();f.deadline.payment_notice_deadline='2026-11-01';f.deadline.pay_less_notice_deadline='2026-11-02';
  f.paymentNotice={id:'pn-s',notice_id:'pn',notice_reference:'PN-1',notified_sum:8500};
  if(type==='pay_less_notice'){f.intended={intended_amount:6200};f.payLess={id:'pl-s',notice_id:'pl',source_notice_id:'pn',notice_reference:'PL-1'};}
  const r=evaluate(f,undefined,now);assert.equal(r.type,type);assert.equal(r.classification,'existing_issued_notice');assert.equal(r.deadline.state,'internally_issued');assert.equal(r.serviceState,'unverified');
  assert.equal(r.paymentNotice.snapshotId,'pn-s');if(type==='pay_less_notice'){assert.equal(r.payLess.snapshotId,'pl-s');assert.equal(r.payLessDeadline.state,'internally_issued');}
  assert(!r.messages.some(message=>/Deadline has passed|Required notice is not issued/.test(message)));
 }
});
test('certificate-as-notice retains Submitted versus Locked safeguards and frozen proposal',()=>{
 for(const status of ['submitted','locked']){
  const f=facts();f.certificate.status=status;f.readiness.mode='certificate_as_payment_notice';
  Object.assign(f.deadline.governing_terms_snapshot.paymentRules.notice,{paymentNoticeMode:'certificate_as_payment_notice',paymentNoticeDocumentIdentity:'combined_certificate_payment_notice',certificateDocumentConstitutesNotice:true});
  const r=evaluate(f,undefined,now);assert.equal(r.mode,'certificate_as_payment_notice');assert.equal(r.notifiedSum,6200);assert.equal(r.automationActive,false);
  assert.equal(repo.eligibility(f).eligible,status==='locked');assert.equal(repo.combinedApprovalReadiness(f).eligible,true);
 }
});
test('approaching window follows London calendar across spring and autumn clock changes',()=>{
 const f=facts();
 for(const [instant,date] of [['2026-03-28T23:30:00Z','2026-03-31'],['2026-10-24T23:30:00Z','2026-10-28']]){
  f.deadline.payment_notice_deadline=date;assert.equal(evaluate(f,undefined,new Date(instant)).deadline.state,'approaching');
 }
});
test('outstanding deadlines lead while issued and not-required use final-payment ordering',()=>{
 const item=(id,classification,deadline,finalPaymentDate)=>({id,finalPaymentDate,noticeEvaluation:{classification,deadline:{date:deadline}}});
 const rows=[item('issued','existing_issued_notice','2026-01-01','2026-12-02'),item('none','not_required',null,'2026-12-01'),item('later','future_preparation_supported','2026-11-23','2026-12-04'),item('overdue','contractual_exception','2026-11-19','2026-12-05')];
 rows.sort((a,b)=>compareNoticeDeadline(a,b)||a.finalPaymentDate.localeCompare(b.finalPaymentDate));assert.deepEqual(rows.map(row=>row.id),['overdue','later','none','issued']);
});
