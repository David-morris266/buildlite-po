// Read-only presentation of existing authority. This does not authorise notice writes.
const { noticeReadiness } = require('./paymentRulesV2');
const { PERMISSIONS: P } = require('../auth/permissions');

function londonDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function deadline(value, today) {
  // Timetable dates are calendar facts; never interpret a missing date as today.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  return {date,state:!date?'not_captured':date<today?'overdue':date===today?'today':'upcoming'};
}
function noticeState(notices, type, date, today) {
  const notice = notices.filter(item => item.type === type && !['superseded','voided'].includes(item.status)).at(-1);
  const issued = notice?.status === 'issued' ? notice.issuedSnapshot : null;
  const issuedDate = issued?.capturedAt ? londonDate(issued.capturedAt) : null;
  const issuedDeadline = issued?.[type === 'payment_notice' ? 'paymentNoticeDeadline' : 'payLessDeadline'] || date;
  return {state:notice?.status || 'missing',reference:notice?.reference || null,
    deadline:deadline(date,today),serviceState:'unverified',
    issuedAt:issued?.capturedAt || null,
    internalIssueTiming:!issued?'not_issued':!issuedDate||!issuedDeadline?'unknown':issuedDate>issuedDeadline?'late':'by_configured_date'};
}

function buildNoticeReadiness({clientId,certificate,timetable,notices=[],auth,now=new Date()}) {
  const asOfDate = londonDate(now);
  if (!asOfDate) throw new Error('Server notice-readiness clock is unavailable.');
  const terms = timetable?.governingTermsSnapshot || {};
  const configuration = terms.paymentRules ? noticeReadiness(terms) : {state:'configuration_unavailable',mode:null,reasons:['Governing notice terms were not captured or are unavailable. Review the governing terms; timetable dates alone do not grant notice authority.']};
  const dates = timetable?.dates || {};
  const locked = certificate.status === 'locked';
  const currentTenant = Boolean(auth?.userId && String(auth.clientId) === String(clientId));
  const permitted = permission => currentTenant && auth.permissions?.includes(permission) === true;
  const noticeEnabled = locked && configuration.state === 'ready' && configuration.mode !== 'certificate_only';
  const permissions = Object.fromEntries([
    ['preparePaymentNotice',P.PAYMENT_NOTICE_PREPARE],['issuePaymentNotice',P.PAYMENT_NOTICE_ISSUE],
    ['proposeIntendedPayment',P.INTENDED_PAYMENT_PROPOSE],['confirmIntendedPayment',P.INTENDED_PAYMENT_CONFIRM],
    ['preparePayLess',P.PAY_LESS_PREPARE],['issuePayLess',P.PAY_LESS_ISSUE],
  ].map(([action,permission])=>[action,{permission,granted:permitted(permission),allowed:noticeEnabled && permitted(permission) && (!action.includes('PayLess') || configuration.configuration?.payLessWorkflowSupported===true)}]));
  const paymentNotice = noticeState(notices,'payment_notice',dates.paymentNoticeDeadline,asOfDate);
  const payLess = noticeState(notices,'pay_less_notice',dates.payLessNoticeDeadline,asOfDate);
  const warnings = [];
  if (configuration.state !== 'ready') warnings.push({code:'configuration_unavailable',message:configuration.reasons.join(' ')});
  if (!dates.paymentNoticeDeadline || !dates.payLessNoticeDeadline || !dates.finalDateForPayment) warnings.push({code:'deadline_evidence_unavailable',message:`Notice deadline evidence is incomplete. ${timetable?.reasons?.join(' ') || 'Review the governing terms and recorded payment-cycle/application dates; missing historical dates must not be invented.'}`});
  if (!locked) warnings.push({code:'pre_approval_authority_unavailable',message:'Notice deadlines apply before internal approval. Pre-approval notice authority is not configured; existing notice creation still requires a Locked certificate. Escalate before the configured deadline.'});
  if (paymentNotice.state === 'missing' && configuration.mode !== 'certificate_only') warnings.push({code:'payment_notice_missing',message:paymentNotice.deadline.state==='overdue'?'No active Payment Notice is recorded and the configured deadline is overdue. Verify actual service evidence and escalate.':'No active Payment Notice is recorded. Review the governing notice configuration, responsible permissions and deadline.'});
  for (const [name,item] of [['Payment Notice',paymentNotice],['Pay Less Notice',payLess]]) {
    if (item.deadline.state === 'overdue') warnings.push({code:name==='Payment Notice'?'payment_notice_deadline_passed':'pay_less_deadline_passed',message:`Configured ${name} deadline has passed. Internal Issue is not evidence of timely service.`});
    if (item.internalIssueTiming === 'late') warnings.push({code:'late_internal_issue',message:`${name} was recorded as internally issued after its configured deadline; it must not be represented as timely.`});
  }
  return {asOfDate,clockSource:'server',timezone:'Europe/London',
    terms:{familyName:terms.familyName||null,versionLabel:terms.versionLabel||null,revisionNumber:terms.revisionNumber||null,
      termsVersionId:terms.termsVersionId||null,rulesSchemaVersion:terms.rulesSchemaVersion||null,
      evidenceState:timetable?.state||'not_captured',frozen:['submission','locked'].includes(timetable?.state)},
    configuration,paymentNotice,payLess,finalPayment:deadline(dates.finalDateForPayment,asOfDate),permissions,warnings,
    preApprovalAuthority:{state:'not_configured',authoriseNotifiedSum:false,recordServiceEvidence:false},
    serviceMessage:'Service is unverified. Internal notice Issue and document Issue do not prove dispatch, delivery or service.'};
}
module.exports = {buildNoticeReadiness,londonDate};
