const test=require('node:test');
const assert=require('node:assert/strict');
const {validatePaymentRulesV1,calculatePaymentDeadlines,CALCULATION_VERSION}=require('../services/paymentRulesV1');

const complete=(overrides={})=>({configurationState:'complete',ruleType:'uk_subcontract_payment_cycle',jurisdiction:'england_wales',timezone:'Europe/London',anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:7,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'due_date',direction:'after',days:5,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:28,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:7,dayBasis:'calendar'},...overrides});
const snapshot=(rules=complete())=>({rulesSchemaVersion:1,paymentRules:rules});

test('validates complete and incomplete rules without fabricating defaults',()=>{
  assert.equal(validatePaymentRulesV1(complete(),1).valid,true);
  assert.deepEqual(validatePaymentRulesV1({configurationState:'incomplete'},1),{valid:true,complete:false,errors:[],code:null});
  assert.match(validatePaymentRulesV1({configurationState:'incomplete',dueDate:{days:-1}},1).errors.join(' '),/non-negative/);
  for(const [rules,pattern] of [
    [complete({anchor:null}),/anchor/],[complete({dueDate:null}),/dueDate/],
    [complete({dueDate:{relativeTo:'anchor',direction:'after',days:-1,dayBasis:'calendar'}}),/non-negative/],
    [complete({jurisdiction:'scotland'}),/jurisdiction/],[complete({timezone:'UTC'}),/timezone/],
    [complete({dueDate:{relativeTo:'anchor',direction:'after',days:1,dayBasis:'working'}}),/calendar/],
    [complete({finalDateForPayment:{relativeTo:'anchor',direction:'after',days:1,dayBasis:'calendar'}}),/relativeTo/],
  ]) assert.match(validatePaymentRulesV1(rules,1).errors.join(' '),pattern);
  assert.equal(validatePaymentRulesV1(complete(),2).code,'unsupported_rule_schema');
});

test('calculates every anchor type and supported dependency deterministically',()=>{
  const cases=[
    ['application_received_date',{applicationReceivedAt:'2026-03-29T23:30:00Z'},'2026-03-30'],
    ['application_valuation_date',{applicationValuationDate:'2026-12-25'},'2026-12-25'],
    ['certificate_date',{certificateDate:'2028-02-29'},'2028-02-29'],
    ['contractual_valuation_date',{contractualValuationDate:'2026-12-31'},'2026-12-31'],
  ];
  for(const [type,inputs,anchor] of cases){const result=calculatePaymentDeadlines({rulesSnapshot:snapshot(complete({anchor:{type}})),cycleInputs:inputs});assert.equal(result.readiness,'ready');assert.equal(result.resolvedAnchor.value,anchor);assert.equal(result.calculationVersion,CALCULATION_VERSION);assert.equal(result.provenance.timezone,'Europe/London');}
  const result=calculatePaymentDeadlines({rulesSnapshot:snapshot(complete({anchor:{type:'contractual_valuation_date'},dueDate:{relativeTo:'anchor',direction:'after',days:0,dayBasis:'calendar'},paymentNoticeDeadline:{relativeTo:'anchor',direction:'after',days:0,dayBasis:'calendar'},finalDateForPayment:{relativeTo:'due_date',direction:'after',days:1,dayBasis:'calendar'},payLessNoticeDeadline:{relativeTo:'final_date_for_payment',direction:'before',days:0,dayBasis:'calendar'}})),cycleInputs:{contractualValuationDate:'2026-12-31'}});
  assert.deepEqual(result.dates,{dueDate:'2026-12-31',paymentNoticeDeadline:'2026-12-31',finalDateForPayment:'2027-01-01',payLessNoticeDeadline:'2027-01-01'});
});

test('preserves date-only facts and converts receipt timestamps in Europe/London at GMT/BST edges',()=>{
  const received=rules=>calculatePaymentDeadlines({rulesSnapshot:snapshot(complete({anchor:{type:'application_received_date'}})),cycleInputs:{applicationReceivedAt:rules}}).resolvedAnchor.value;
  assert.equal(received('2026-03-29T00:30:00Z'),'2026-03-29');
  assert.equal(received('2026-03-29T23:30:00Z'),'2026-03-30');
  assert.equal(received('2026-10-25T00:30:00Z'),'2026-10-25');
  const leap=calculatePaymentDeadlines({rulesSnapshot:snapshot(),cycleInputs:{contractualValuationDate:'2028-02-29'}});assert.equal(leap.dates.dueDate,'2028-03-07');
});

test('returns explicit readiness states and never infers money or notice requirements',()=>{
  assert.equal(calculatePaymentDeadlines({rulesSnapshot:snapshot({configurationState:'incomplete'})}).readiness,'incomplete_configuration');
  assert.equal(calculatePaymentDeadlines({rulesSnapshot:{rulesSchemaVersion:99,paymentRules:complete()}}).readiness,'unsupported_rule_schema');
  assert.equal(calculatePaymentDeadlines({rulesSnapshot:snapshot(complete({dueDate:{relativeTo:'anchor',direction:'after',days:1,dayBasis:'working'}}))}).readiness,'unsupported_day_basis');
  assert.equal(calculatePaymentDeadlines({rulesSnapshot:snapshot(),cycleInputs:{}}).readiness,'missing_anchor_date');
  assert.equal(calculatePaymentDeadlines({rulesSnapshot:{state:'mixed'}}).readiness,'review_required');
  const result=calculatePaymentDeadlines({rulesSnapshot:snapshot(complete({anchor:{type:'certificate_date'}})),cycleInputs:{certificateDate:'2026-08-30'}});
  for(const forbidden of ['applicationAmount','assessmentAmount','notifiedSum','intendedPayment','payLessRequired','noticeStatus'])assert.equal(forbidden in result,false);
});
