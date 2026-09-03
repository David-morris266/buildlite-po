const PERMISSIONS = Object.freeze({
  COMMERCIAL_READ: 'commercial.read', CERTIFICATE_EDIT: 'certificate.edit', PO_APPROVE: 'po.approve', CE_APPROVE: 'ce.approve',
  CE_CLOSE: 'ce.close', CE_RECOVERY_WRITE_OFF: 'ce.recovery_write_off', VO_APPROVE: 'vo.approve', VO_ISSUE: 'vo.issue',
  CVR_LOCK: 'cvr.lock', CERTIFICATE_LOCK: 'certificate.lock', INTENDED_PAYMENT_CONFIRM: 'intended_payment.confirm',
  PAYMENT_NOTICE_ISSUE: 'payment_notice.issue', PAY_LESS_ISSUE: 'pay_less.issue', DOCUMENT_GENERATE: 'document.generate',
  DOCUMENT_ISSUE: 'document.issue', DOCUMENT_VIEW: 'document.view', TERMS_PUBLISH: 'terms.publish',
  TERMS_ASSIGN_DEFAULT: 'terms.assign_default', TERMS_ASSIGN_OVERRIDE: 'terms.assign_override', TENANT_CONFIGURE: 'tenant.configure',
  USERS_MANAGE: 'users.manage', ROLES_MANAGE: 'roles.manage', PAYMENT_RELEASE_APPROVE: 'payment_release.approve',
  VARIATION_ACCOUNT_VIEW: 'variation_account.view', VARIATION_ACCOUNT_CREATE: 'variation_account.create',
  VARIATION_ACCOUNT_FORECAST_EDIT: 'variation_account.forecast_edit', VARIATION_ACCOUNT_RESOLVE: 'variation_account.resolve',
  VARIATION_ACCOUNT_ASSESS: 'variation_account.assess',
  VARIATION_ACCOUNT_AUTHORITY_ALLOCATE: 'variation_account.authority_allocate',
});

module.exports = { PERMISSIONS };
