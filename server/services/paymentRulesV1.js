const RULES_SCHEMA_VERSION = 1;
const CALCULATION_VERSION = 'payment-deadlines-v1';

const ANCHORS = new Set(['application_received_date','application_valuation_date','certificate_date','contractual_valuation_date']);
const DEPENDENCIES = {
  dueDate: new Set(['anchor']),
  paymentNoticeDeadline: new Set(['anchor','due_date']),
  finalDateForPayment: new Set(['due_date']),
  payLessNoticeDeadline: new Set(['final_date_for_payment']),
};

function validateOffset(value, key, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors.push(`${key} is required.`);
  if (!DEPENDENCIES[key].has(value.relativeTo)) errors.push(`${key}.relativeTo is unsupported.`);
  const expectedDirection = key === 'payLessNoticeDeadline' ? 'before' : 'after';
  if (value.direction !== expectedDirection) errors.push(`${key}.direction must be ${expectedDirection}.`);
  if (!Number.isInteger(value.days) || value.days < 0) errors.push(`${key}.days must be a non-negative whole number.`);
  if (value.dayBasis !== 'calendar') errors.push(`${key}.dayBasis is unsupported; V1 supports calendar days only.`);
}

function validatePaymentRulesV1(paymentRules, rulesSchemaVersion = RULES_SCHEMA_VERSION) {
  const errors = [];
  if (Number(rulesSchemaVersion) !== RULES_SCHEMA_VERSION) return { valid:false, complete:false, errors:['Unsupported payment rules schema version.'], code:'unsupported_rule_schema' };
  if (!paymentRules || typeof paymentRules !== 'object' || Array.isArray(paymentRules)) return {valid:false,complete:false,errors:['paymentRules must be an object.'],code:'malformed_rules'};
  const state = paymentRules.configurationState;
  if (!['incomplete','complete'].includes(state)) errors.push('configurationState must be incomplete or complete.');
  if (state === 'incomplete') {
    if (paymentRules.ruleType != null && paymentRules.ruleType !== 'uk_subcontract_payment_cycle') errors.push('ruleType is unsupported.');
    if (paymentRules.jurisdiction != null && paymentRules.jurisdiction !== 'england_wales') errors.push('jurisdiction is unsupported; V1 supports England & Wales only.');
    if (paymentRules.timezone != null && paymentRules.timezone !== 'Europe/London') errors.push('timezone is unsupported; V1 supports Europe/London only.');
    if (paymentRules.anchor != null && (typeof paymentRules.anchor !== 'object' || !ANCHORS.has(paymentRules.anchor.type))) errors.push('anchor.type is malformed or unsupported.');
    for (const key of Object.keys(DEPENDENCIES)) {
      const value=paymentRules[key]; if(value==null)continue;
      if(typeof value!=='object'||Array.isArray(value)){errors.push(`${key} is malformed.`);continue;}
      if(value.relativeTo!=null&&!DEPENDENCIES[key].has(value.relativeTo))errors.push(`${key}.relativeTo is unsupported.`);
      const direction=key==='payLessNoticeDeadline'?'before':'after';
      if(value.direction!=null&&value.direction!==direction)errors.push(`${key}.direction must be ${direction}.`);
      if(value.days!=null&&(!Number.isInteger(value.days)||value.days<0))errors.push(`${key}.days must be a non-negative whole number.`);
      if(value.dayBasis!=null&&value.dayBasis!=='calendar')errors.push(`${key}.dayBasis is unsupported; V1 supports calendar days only.`);
    }
    return {valid:errors.length===0,complete:false,errors,code:errors.length?'malformed_rules':null};
  }
  if (paymentRules.ruleType !== 'uk_subcontract_payment_cycle') errors.push('ruleType is unsupported.');
  if (paymentRules.jurisdiction !== 'england_wales') errors.push('jurisdiction is unsupported; V1 supports England & Wales only.');
  if (paymentRules.timezone !== 'Europe/London') errors.push('timezone is unsupported; V1 supports Europe/London only.');
  if (!paymentRules.anchor || !ANCHORS.has(paymentRules.anchor.type)) errors.push('anchor.type is missing or unsupported.');
  Object.keys(DEPENDENCIES).forEach(key => validateOffset(paymentRules[key],key,errors));
  return {valid:errors.length===0,complete:true,errors,code:errors.length?'invalid_rule_graph':null};
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0,10) !== value ? null : value;
}
function londonDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part = type => parts.find(item=>item.type===type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}
function unavailable(readiness,reasons,rulesSchemaVersion=RULES_SCHEMA_VERSION) {
  return {readiness,status:'unavailable',calculationVersion:CALCULATION_VERSION,rulesSchemaVersion,resolvedAnchor:null,dates:null,provenance:null,reasons};
}

function calculatePaymentDeadlines({rulesSnapshot,cycleInputs={}}={}) {
  if (!rulesSnapshot || rulesSnapshot.readiness === 'unavailable' || ['mixed','unconfigured','legacy'].includes(rulesSnapshot.state)) {
    return unavailable('review_required',['Governing payment-rule authority is unavailable or requires review.'],rulesSnapshot?.rulesSchemaVersion);
  }
  const rulesSchemaVersion=Number(rulesSnapshot.rulesSchemaVersion ?? rulesSnapshot.rules_schema_version ?? 1);
  const rules=rulesSnapshot.paymentRules ?? rulesSnapshot.payment_rules ?? rulesSnapshot;
  const validation=validatePaymentRulesV1(rules,rulesSchemaVersion);
  if (validation.code === 'unsupported_rule_schema') return unavailable('unsupported_rule_schema',validation.errors,rulesSchemaVersion);
  if (rules?.configurationState === 'incomplete') return unavailable('incomplete_configuration',validation.errors.length?validation.errors:['Payment timetable configuration is incomplete.'],rulesSchemaVersion);
  if (!validation.valid) {
    const dayBasis = Object.keys(DEPENDENCIES).some(key=>rules?.[key]?.dayBasis && rules[key].dayBasis!=='calendar');
    return unavailable(dayBasis?'unsupported_day_basis':'invalid_rule_graph',validation.errors,rulesSchemaVersion);
  }
  const anchorType=rules.anchor.type;
  const raw={
    application_received_date:cycleInputs.applicationReceivedAt ?? cycleInputs.application_received_at,
    application_valuation_date:cycleInputs.applicationValuationDate ?? cycleInputs.application_valuation_date,
    certificate_date:cycleInputs.certificateDate ?? cycleInputs.certificate_date,
    contractual_valuation_date:cycleInputs.contractualValuationDate ?? cycleInputs.contractual_valuation_date,
  }[anchorType];
  const anchorValue=anchorType==='application_received_date'?londonDate(raw):dateOnly(raw);
  if(!anchorValue)return unavailable('missing_anchor_date',[`Required ${anchorType} is unavailable.`],rulesSchemaVersion);
  const dueDate=addDays(anchorValue,rules.dueDate.days);
  const paymentBase=rules.paymentNoticeDeadline.relativeTo==='anchor'?anchorValue:dueDate;
  const paymentNoticeDeadline=addDays(paymentBase,rules.paymentNoticeDeadline.days);
  const finalDateForPayment=addDays(dueDate,rules.finalDateForPayment.days);
  const payLessNoticeDeadline=addDays(finalDateForPayment,-rules.payLessNoticeDeadline.days);
  return {
    readiness:'ready',status:'calculated',calculationVersion:CALCULATION_VERSION,rulesSchemaVersion,
    resolvedAnchor:{type:anchorType,value:anchorValue,sourceField:anchorType},
    dates:{dueDate,paymentNoticeDeadline,finalDateForPayment,payLessNoticeDeadline},
    provenance:{jurisdiction:rules.jurisdiction,timezone:rules.timezone,ruleType:rules.ruleType,
      dependencies:{dueDate:rules.dueDate,paymentNoticeDeadline:rules.paymentNoticeDeadline,finalDateForPayment:rules.finalDateForPayment,payLessNoticeDeadline:rules.payLessNoticeDeadline}},
    reasons:[],
  };
}

module.exports={RULES_SCHEMA_VERSION,CALCULATION_VERSION,ANCHORS,validatePaymentRulesV1,calculatePaymentDeadlines};
