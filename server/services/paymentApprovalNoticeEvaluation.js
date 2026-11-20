// Read-only disclosure; never use future preparation readiness as approval eligibility.
const { noticeReadiness } = require('./paymentRulesV2');
const { londonDate } = require('./paymentNoticeReadiness');
const { dateOnly } = require('./paymentCertificateTimetable');

function evaluateApprovalNotice(facts, auth, now = new Date()) {
  const terms = facts.deadline?.governing_terms_snapshot || {};
  const configuration = noticeReadiness(terms);
  const today = londonDate(now);
  if (!today) throw new Error('Server notice clock unavailable.');
  const classify = value => {
    const date = dateOnly(value);
    const days = date ? (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000 : null;
    return {date, state:days == null ? 'unavailable' : days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 3 ? 'approaching' : 'upcoming'};
  };
  const pn = facts.paymentNotice, pl = facts.payLess;
  const applicablePayLess = pn && pl && pl.source_notice_id === pn.notice_id ? pl : null;
  const supported = configuration.state === 'ready';
  const required = supported && configuration.mode !== 'certificate_only';
  const notifiedSum = pn?.notified_sum ?? (required ? facts.certificate.net_value : null);
  const reduction = pn && facts.intended && Number(facts.intended.intended_amount) < Number(pn.notified_sum);
  const type = !supported ? null : reduction ? 'pay_less_notice' : required ? 'payment_notice' : null;
  const existing = type === 'pay_less_notice' ? applicablePayLess : type ? pn : null;
  // Frozen V1 dates remain useful even when notice type/authority is indeterminate.
  const deadline = classify(type === 'pay_less_notice' ? facts.deadline?.pay_less_notice_deadline : configuration.mode !== 'certificate_only' ? facts.deadline?.payment_notice_deadline : null);
  if (existing) deadline.state = 'internally_issued';
  const missingPermissions = auth && type ? [`${type === 'pay_less_notice' ? 'pay_less' : 'payment_notice'}.prepare`, `${type === 'pay_less_notice' ? 'pay_less' : 'payment_notice'}.issue`].filter(key => !auth.permissions?.includes(key)) : [];
  let classification = !supported ? 'configuration_exception' : existing ? 'existing_issued_notice' : !type ? 'not_required' : notifiedSum == null ? 'contractual_exception' : 'future_preparation_supported';
  if (!existing && type && ['unavailable','overdue'].includes(deadline.state)) classification = 'contractual_exception';
  else if (!existing && missingPermissions.length) classification = 'authority_exception';
  const issuer = type === 'pay_less_notice' ? configuration.configuration?.payLessIssuer : configuration.configuration?.paymentNoticeIssuer;
  const unsupportedAction = type && (issuer !== 'company' || (type === 'pay_less_notice' && configuration.configuration?.payLessWorkflowSupported !== true));
  if (unsupportedAction) classification = 'contractual_exception';
  const messages = [...(configuration.reasons || [])];
  if (type && !existing) messages.push('Required notice is not issued. Use the existing notice workflow; approval does not prepare or send it.');
  if (deadline.state === 'overdue') messages.push('Deadline has passed. Verify actual service evidence and escalate.');
  if (deadline.state === 'unavailable' && type) messages.push('Deadline evidence is missing. Review the governing terms.');
  if (missingPermissions.length) messages.push('Your notice preparation or issue authority is incomplete. Refer to an authorised commercial user.');
  if (unsupportedAction) messages.push('The governing terms do not support this company notice action. Review contractual authority.');
  if (pl && !applicablePayLess) messages.push('Pay Less evidence is not linked to the applicable issued Payment Notice. Review notice history.');
  return {classification, type, mode:configuration.mode, asOfDate:today, timezone:'Europe/London', clockSource:'server',
    terms:{familyName:terms.familyName || null, versionLabel:terms.versionLabel || null, revisionNumber:terms.revisionNumber ?? null, termsVersionId:terms.termsVersionId || null, rulesSchemaVersion:terms.rulesSchemaVersion ?? null},
    notifiedSum:notifiedSum == null ? null : Number(notifiedSum),
    proposedPayment:type === 'pay_less_notice' ? Number(facts.intended.intended_amount) : null,
    basis:existing?.basis_of_calculation || null,
    basisSource:existing ? 'issued_notice' : type ? 'Certificate valuation is supporting evidence; a notice calculation basis still requires confirmation.' : null,
    paymentNotice:pn ? {snapshotId:pn.id, reference:pn.notice_reference, status:'issued'} : null,
    payLess:applicablePayLess ? {snapshotId:applicablePayLess.id, reference:applicablePayLess.notice_reference, status:'issued'} : null,
    deadline, payLessDeadline:{...classify(facts.deadline?.pay_less_notice_deadline), ...(applicablePayLess ? {state:'internally_issued'} : {})}, finalPayment:classify(facts.deadline?.final_date_for_payment),
    missingPermissions, messages, automationActive:false, serviceState:'unverified'};
}
function compareNoticeDeadline(a,b) {
  const pendingDate = item => item.noticeEvaluation && !['existing_issued_notice','not_required'].includes(item.noticeEvaluation.classification) ? item.noticeEvaluation.deadline.date || '9999' : '9999';
  return pendingDate(a).localeCompare(pendingDate(b));
}
module.exports = {evaluateApprovalNotice, compareNoticeDeadline};
