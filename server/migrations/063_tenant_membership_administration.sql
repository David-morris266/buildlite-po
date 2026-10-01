-- GP pre-pilot: tenant-owned membership administration and bounded capabilities.
-- Existing operational roles remain unchanged. No Commercial Director capability is inferred.

ALTER TABLE client_user_memberships
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE client_user_memberships
  ADD CONSTRAINT uq_client_user_memberships_client_id_id UNIQUE(client_id,id);

CREATE TABLE membership_capabilities (
  key TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE membership_capability_permissions (
  capability_key TEXT NOT NULL REFERENCES membership_capabilities(key) ON DELETE RESTRICT,
  permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE RESTRICT,
  PRIMARY KEY(capability_key,permission_key)
);

INSERT INTO membership_capabilities(key,label,description) VALUES
  ('company_administration','Company Administration','Manage tenant users, memberships, roles and bounded capabilities.'),
  ('finance_operations','Finance Operations','Accept authorised payments into the Accounts process.')
ON CONFLICT(key) DO UPDATE SET label=EXCLUDED.label,description=EXCLUDED.description;

INSERT INTO membership_capability_permissions(capability_key,permission_key) VALUES
  ('company_administration','users.manage'),
  ('company_administration','roles.manage'),
  ('finance_operations','payment_release.execute')
ON CONFLICT DO NOTHING;

CREATE TABLE client_user_membership_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL,
  capability_key TEXT NOT NULL REFERENCES membership_capabilities(key) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  risk_acknowledgement JSONB,
  granted_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  granted_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  granted_by_provider_user_id TEXT,
  granted_by_display_name TEXT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  revoked_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  revoked_by_provider_user_id TEXT,
  revoked_by_display_name TEXT,
  revoked_at TIMESTAMPTZ,
  UNIQUE(client_id,membership_id,capability_key),
  FOREIGN KEY(client_id,membership_id) REFERENCES client_user_memberships(client_id,id) ON DELETE RESTRICT,
  CHECK((is_active AND revoked_at IS NULL) OR (NOT is_active AND revoked_at IS NOT NULL))
);
CREATE INDEX idx_membership_capabilities_active ON client_user_membership_capabilities(client_id,membership_id,is_active);

CREATE TABLE tenant_membership_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  normalized_email TEXT NOT NULL CHECK(normalized_email=lower(btrim(normalized_email)) AND normalized_email LIKE '%@%'),
  intended_role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  intended_capability_keys TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','cancelled','expired')),
  token_sha256 TEXT NOT NULL UNIQUE CHECK(token_sha256 ~ '^[0-9a-f]{64}$'),
  provider_invitation_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  accepted_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  accepted_at TIMESTAMPTZ,
  cancelled_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  cancelled_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  cancelled_at TIMESTAMPTZ,
  CHECK((status='accepted')=(accepted_at IS NOT NULL)),
  CHECK((status='cancelled')=(cancelled_at IS NOT NULL))
);
CREATE UNIQUE INDEX uq_pending_tenant_invitation_email ON tenant_membership_invitations(client_id,normalized_email) WHERE status='pending';

CREATE TABLE tenant_membership_authority_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  target_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  invitation_id UUID REFERENCES tenant_membership_invitations(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK(operation IN('bootstrap_admin_established','invitation_created','invitation_accepted','membership_activated','primary_role_changed','capability_granted','capability_revoked','membership_deactivated','membership_reactivated')),
  before_document JSONB,
  after_document JSONB,
  reason TEXT,
  acknowledgement JSONB,
  actor_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT,
  actor_display_name TEXT,
  actor_role_key TEXT,
  actor_permission_key TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE FUNCTION protect_tenant_membership_authority_audit() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Tenant membership authority audit is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_membership_authority_audit_immutable BEFORE UPDATE OR DELETE ON tenant_membership_authority_audit FOR EACH ROW EXECUTE FUNCTION protect_tenant_membership_authority_audit();

-- Existing dedicated Admin memberships retain their exact authority through the
-- explicit Company Administration capability. No other role is inferred.
INSERT INTO client_user_membership_capabilities(client_id,membership_id,capability_key,granted_by_display_name)
SELECT m.client_id,m.id,'company_administration','Migration 063'
FROM client_user_memberships m JOIN roles r ON r.id=m.role_id
WHERE r.key='admin'
ON CONFLICT(client_id,membership_id,capability_key) DO NOTHING;
INSERT INTO tenant_membership_authority_audit(client_id,target_membership_id,operation,after_document,actor_display_name)
SELECT m.client_id,m.id,'bootstrap_admin_established',jsonb_build_object('capabilityKey','company_administration','source','existing_admin_role'),'Migration 063'
FROM client_user_memberships m JOIN roles r ON r.id=m.role_id
WHERE r.key='admin';

-- Finance Operations capability is valid database authority for Accounts release.
CREATE OR REPLACE FUNCTION validate_payment_release_batch_actor() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM client_user_memberships m
    WHERE m.id=NEW.released_by_membership_id AND m.client_id=NEW.client_id AND m.user_id=NEW.released_by_user_id AND m.is_active=true
      AND (
        EXISTS(SELECT 1 FROM role_permissions rp WHERE rp.role_id=m.role_id AND rp.permission_key='payment_release.execute')
        OR EXISTS(
          SELECT 1 FROM client_user_membership_capabilities mc
          JOIN membership_capability_permissions cp ON cp.capability_key=mc.capability_key AND cp.permission_key='payment_release.execute'
          WHERE mc.client_id=m.client_id AND mc.membership_id=m.id AND mc.is_active=true
        )
      )
  ) THEN RAISE EXCEPTION 'Payment Release requires an active membership with payment_release.execute'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
