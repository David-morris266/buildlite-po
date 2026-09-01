const { validatePaymentRulesV1 } = require('./paymentRulesV1');

const RULES_SCHEMA_VERSION = 2;
const NOTICE_MODES = new Set(['certificate_only','certificate_as_payment_notice','separate_payment_notice']);
const NOTICE_ISSUERS = new Set(['company','specified_person']);
const DOCUMENT_IDENTITIES = new Set(['payment_certificate','combined_certificate_payment_notice','payment_notice']);

function validatePaymentRulesV2(paymentRules, rulesSchemaVersion = RULES_SCHEMA_VERSION) {
  if (Number(rulesSchemaVersion) !== RULES_SCHEMA_VERSION) {
    return { valid:false, complete:false, errors:['Unsupported payment rules schema version.'], code:'unsupported_rule_schema' };
  }
  const timetable = validatePaymentRulesV1(paymentRules, 1);
  const errors = [...timetable.errors];
  const notice = paymentRules?.notice;
  const incomplete = paymentRules?.configurationState === 'incomplete';
  if (paymentRules?.configurationState === 'incomplete' && notice == null) {
    return { valid:errors.length===0, complete:false, errors, code:errors.length?'malformed_rules':null };
  }
  if (!notice || typeof notice !== 'object' || Array.isArray(notice)) errors.push('notice configuration is required.');
  else {
    if ((!incomplete||notice.paymentNoticeMode) && !NOTICE_MODES.has(notice.paymentNoticeMode)) errors.push('notice.paymentNoticeMode is missing or unsupported.');
    if ((!incomplete||notice.paymentNoticeIssuer) && !NOTICE_ISSUERS.has(notice.paymentNoticeIssuer)) errors.push('notice.paymentNoticeIssuer is missing or unsupported.');
    if ((!incomplete||notice.payLessIssuer) && !NOTICE_ISSUERS.has(notice.payLessIssuer)) errors.push('notice.payLessIssuer is missing or unsupported.');
    if ((!incomplete||notice.basisOfCalculationRequired!=null) && typeof notice.basisOfCalculationRequired !== 'boolean') errors.push('notice.basisOfCalculationRequired must be true or false.');
    if ((!incomplete||notice.payLessWorkflowSupported!=null) && typeof notice.payLessWorkflowSupported !== 'boolean') errors.push('notice.payLessWorkflowSupported must be true or false.');
    if ((!incomplete||notice.paymentNoticeDocumentIdentity) && !DOCUMENT_IDENTITIES.has(notice.paymentNoticeDocumentIdentity)) errors.push('notice.paymentNoticeDocumentIdentity is missing or unsupported.');
    if (NOTICE_MODES.has(notice.paymentNoticeMode)) {
      const combined = notice.paymentNoticeMode === 'certificate_as_payment_notice';
      if (notice.certificateDocumentConstitutesNotice !== combined) errors.push('notice.certificateDocumentConstitutesNotice must match paymentNoticeMode.');
      if (notice.paymentNoticeMode === 'certificate_only' && notice.paymentNoticeDocumentIdentity !== 'payment_certificate') errors.push('Certificate-only mode must use payment_certificate identity.');
      if (combined && notice.paymentNoticeDocumentIdentity !== 'combined_certificate_payment_notice') errors.push('Certificate-as-notice mode must use combined_certificate_payment_notice identity.');
      if (notice.paymentNoticeMode === 'separate_payment_notice' && notice.paymentNoticeDocumentIdentity !== 'payment_notice') errors.push('Separate notice mode must use payment_notice identity.');
    }
  }
  const complete = timetable.complete && !!notice && NOTICE_MODES.has(notice.paymentNoticeMode);
  return { valid:errors.length===0, complete, errors, code:errors.length?'invalid_notice_configuration':null };
}

function validatePaymentRules(paymentRules, version) {
  return Number(version) === 2 ? validatePaymentRulesV2(paymentRules, version) : validatePaymentRulesV1(paymentRules, version);
}

function noticeReadiness(rulesSnapshot) {
  const version = Number(rulesSnapshot?.rulesSchemaVersion ?? rulesSnapshot?.rules_schema_version ?? 1);
  if (version < 2) return { state:'configuration_unavailable', mode:null, reasons:['Payment Rules V1 is timetable-capable but has no Payment Notice configuration.'] };
  const rules = rulesSnapshot?.paymentRules ?? rulesSnapshot?.payment_rules;
  const validation = validatePaymentRulesV2(rules, version);
  if (!validation.valid || !validation.complete) return { state:'configuration_unavailable', mode:rules?.notice?.paymentNoticeMode||null, reasons:validation.errors.length?validation.errors:['Payment Notice configuration is incomplete.'] };
  return { state:'ready', mode:rules.notice.paymentNoticeMode, configuration:{...rules.notice}, reasons:[] };
}

module.exports={RULES_SCHEMA_VERSION,NOTICE_MODES,NOTICE_ISSUERS,DOCUMENT_IDENTITIES,validatePaymentRulesV2,validatePaymentRules,noticeReadiness};
