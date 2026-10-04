-- Hosted pilot: audited identity bootstrap for an explicitly allowlisted Clerk platform operator.
-- This does not create a tenant, membership, tenant role or commercial authority.

CREATE TABLE platform_identity_bootstrap_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  auth_provider TEXT NOT NULL CHECK(auth_provider='clerk'),
  provider_user_id TEXT NOT NULL UNIQUE,
  email_snapshot TEXT NOT NULL,
  display_name TEXT NOT NULL,
  authority TEXT NOT NULL CHECK(authority='platform.tenant_provision'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION protect_platform_identity_bootstrap_audit() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Platform identity bootstrap audit is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_platform_identity_bootstrap_audit_immutable
BEFORE UPDATE OR DELETE ON platform_identity_bootstrap_audit
FOR EACH ROW EXECUTE FUNCTION protect_platform_identity_bootstrap_audit();
