-- BuildLite RBAC Slice A: provider-neutral authenticated identity and tenant permissions.
-- Additive only. No historic actor or commercial-record backfill.

CREATE TABLE IF NOT EXISTS buildlite_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider TEXT NOT NULL CHECK (auth_provider IN ('clerk')),
  provider_user_id TEXT NOT NULL,
  email_snapshot TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','invited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(auth_provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS permissions (
  key TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(role_id, permission_key)
);

CREATE TABLE IF NOT EXISTS client_user_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES buildlite_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_buildlite_users_provider ON buildlite_users(auth_provider,provider_user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user_active ON client_user_memberships(user_id,is_active);
CREATE INDEX IF NOT EXISTS idx_memberships_client_active ON client_user_memberships(client_id,is_active);

CREATE TABLE IF NOT EXISTS authorization_action_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  provider_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  request_method TEXT NOT NULL,
  request_path TEXT NOT NULL,
  resource_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_authorization_action_audit_tenant_time ON authorization_action_audit(client_id,authorized_at DESC);

CREATE OR REPLACE FUNCTION protect_authorization_action_audit() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'authorization action audit is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_authorization_action_audit_immutable ON authorization_action_audit;
CREATE TRIGGER trg_authorization_action_audit_immutable BEFORE UPDATE OR DELETE ON authorization_action_audit
FOR EACH ROW EXECUTE FUNCTION protect_authorization_action_audit();

INSERT INTO permissions(key,description) VALUES
 ('commercial.read','Read tenant commercial data'),('po.create','Create purchase orders'),('po.edit','Edit Draft purchase orders'),
 ('po.submit','Submit purchase orders'),('po.approve','Approve purchase orders'),('po.issue','Issue approved purchase orders'),('po.delete_draft','Delete Draft purchase orders'),
 ('ce.create','Create Commercial Events'),('ce.edit','Edit Commercial Events'),('ce.submit','Submit Commercial Events'),('ce.approve','Approve Commercial Events'),
 ('ce.close','Close eligible Commercial Events'),('ce.recovery_write_off','Mark recovery not required'),('ce.expected_treatment','Set Expected Liability treatment'),
 ('vo.create','Create Variation Orders'),('vo.edit','Edit Variation Orders'),('vo.submit','Submit Variation Orders'),('vo.approve','Approve Variation Orders'),('vo.issue','Issue Variation Orders'),
 ('cvr.edit','Edit Draft CVR'),('cvr.adopt','Adopt commercial proposals into CVR'),('cvr.submit','Submit CVR'),('cvr.reject','Reject CVR'),('cvr.lock','Approve and lock CVR'),
 ('application.record','Record subcontract applications'),('certificate.create','Create Payment Certificates'),('certificate.edit','Edit Draft Payment Certificates'),
 ('certificate.submit','Submit Payment Certificates'),('certificate.reject','Reject Payment Certificates'),('certificate.lock','Approve and lock Payment Certificates'),
 ('certificate.delete_draft','Delete never-submitted Draft Payment Certificates'),('intended_payment.propose','Propose intended payment'),
 ('intended_payment.confirm','Confirm intended payment'),('payment_notice.prepare','Prepare Payment Notice'),('payment_notice.issue','Issue Payment Notice'),
 ('pay_less.prepare','Prepare Pay Less Notice'),('pay_less.issue','Issue Pay Less Notice'),('payment_release.approve','Approve a payment release'),
 ('document.generate','Generate commercial documents'),('document.issue','Issue commercial documents'),('document.view','View and download commercial documents'),
 ('terms.edit','Edit Draft subcontract terms'),('terms.publish','Publish subcontract terms'),('terms.assign_default','Assign terms defaults'),
 ('terms.assign_override','Assign PO terms overrides'),('tenant.configure','Configure tenant'),('branding.manage','Manage company branding'),
 ('users.manage','Manage tenant users'),('roles.manage','Manage role bundles')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO roles(key,name,description) VALUES
 ('site','Site','Operational site input without financial approval'),('buyer','Buyer','Purchase-order preparation and Issue after approval'),
 ('qs','QS','Commercial assessment and workflow preparation'),('commercial_manager','Commercial Manager','Commercial approval and statutory notice authority'),
 ('commercial_director','Commercial Director','Senior commercial and payment-release authority'),('admin','Admin','Identity and tenant configuration without financial authority')
ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;

-- Role bundles are deliberately explicit. Admin receives no financial approval capability.
WITH grants(role_key,permission_key) AS (VALUES
 ('site','commercial.read'),('site','po.create'),('site','ce.create'),
 ('buyer','commercial.read'),('buyer','po.create'),('buyer','po.edit'),('buyer','po.submit'),('buyer','po.issue'),('buyer','po.delete_draft'),('buyer','document.generate'),('buyer','document.view'),
 ('qs','commercial.read'),('qs','po.create'),('qs','po.edit'),('qs','po.submit'),('qs','ce.create'),('qs','ce.edit'),('qs','ce.submit'),('qs','ce.expected_treatment'),
 ('qs','vo.create'),('qs','vo.edit'),('qs','vo.submit'),('qs','cvr.edit'),('qs','cvr.adopt'),('qs','cvr.submit'),('qs','application.record'),
 ('qs','certificate.create'),('qs','certificate.edit'),('qs','certificate.submit'),('qs','certificate.delete_draft'),('qs','intended_payment.propose'),
 ('qs','payment_notice.prepare'),('qs','pay_less.prepare'),('qs','document.generate'),('qs','document.view'),
 ('commercial_manager','commercial.read'),('commercial_manager','po.create'),('commercial_manager','po.edit'),('commercial_manager','po.submit'),('commercial_manager','po.approve'),('commercial_manager','po.issue'),('commercial_manager','po.delete_draft'),
 ('commercial_manager','ce.create'),('commercial_manager','ce.edit'),('commercial_manager','ce.submit'),('commercial_manager','ce.approve'),('commercial_manager','ce.close'),('commercial_manager','ce.recovery_write_off'),('commercial_manager','ce.expected_treatment'),
 ('commercial_manager','vo.create'),('commercial_manager','vo.edit'),('commercial_manager','vo.submit'),('commercial_manager','vo.approve'),('commercial_manager','vo.issue'),
 ('commercial_manager','cvr.edit'),('commercial_manager','cvr.adopt'),('commercial_manager','cvr.submit'),('commercial_manager','cvr.reject'),('commercial_manager','cvr.lock'),
 ('commercial_manager','application.record'),('commercial_manager','certificate.create'),('commercial_manager','certificate.edit'),('commercial_manager','certificate.submit'),('commercial_manager','certificate.reject'),('commercial_manager','certificate.lock'),('commercial_manager','certificate.delete_draft'),
 ('commercial_manager','intended_payment.propose'),('commercial_manager','intended_payment.confirm'),('commercial_manager','payment_notice.prepare'),('commercial_manager','payment_notice.issue'),('commercial_manager','pay_less.prepare'),('commercial_manager','pay_less.issue'),
 ('commercial_manager','document.generate'),('commercial_manager','document.issue'),('commercial_manager','document.view'),('commercial_manager','terms.edit'),
 ('commercial_director','commercial.read'),('commercial_director','po.create'),('commercial_director','po.edit'),('commercial_director','po.submit'),('commercial_director','po.approve'),('commercial_director','po.issue'),('commercial_director','po.delete_draft'),
 ('commercial_director','ce.create'),('commercial_director','ce.edit'),('commercial_director','ce.submit'),('commercial_director','ce.approve'),('commercial_director','ce.close'),('commercial_director','ce.recovery_write_off'),('commercial_director','ce.expected_treatment'),
 ('commercial_director','vo.create'),('commercial_director','vo.edit'),('commercial_director','vo.submit'),('commercial_director','vo.approve'),('commercial_director','vo.issue'),
 ('commercial_director','cvr.edit'),('commercial_director','cvr.adopt'),('commercial_director','cvr.submit'),('commercial_director','cvr.reject'),('commercial_director','cvr.lock'),
 ('commercial_director','application.record'),('commercial_director','certificate.create'),('commercial_director','certificate.edit'),('commercial_director','certificate.submit'),('commercial_director','certificate.reject'),('commercial_director','certificate.lock'),('commercial_director','certificate.delete_draft'),
 ('commercial_director','intended_payment.propose'),('commercial_director','intended_payment.confirm'),('commercial_director','payment_notice.prepare'),('commercial_director','payment_notice.issue'),('commercial_director','pay_less.prepare'),('commercial_director','pay_less.issue'),('commercial_director','payment_release.approve'),
 ('commercial_director','document.generate'),('commercial_director','document.issue'),('commercial_director','document.view'),('commercial_director','terms.edit'),('commercial_director','terms.publish'),('commercial_director','terms.assign_default'),('commercial_director','terms.assign_override'),
 ('admin','commercial.read'),('admin','document.view'),('admin','terms.edit'),('admin','terms.publish'),('admin','terms.assign_default'),('admin','terms.assign_override'),('admin','tenant.configure'),('admin','branding.manage'),('admin','users.manage'),('admin','roles.manage')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,g.permission_key FROM grants g JOIN roles r ON r.key=g.role_key
ON CONFLICT DO NOTHING;
