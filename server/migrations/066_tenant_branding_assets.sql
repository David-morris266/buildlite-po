-- Tenant-owned company-logo assets and current-branding authority.
-- Additive only: no legacy logo paths/URLs are imported and no tenant receives a logo.

CREATE TABLE tenant_brand_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL CHECK (asset_type = 'company_logo'),
  lifecycle_status TEXT NOT NULL DEFAULT 'stored' CHECK (lifecycle_status IN ('stored')),
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png','image/jpeg','image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 4096),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 4096),
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_provider TEXT NOT NULL DEFAULT 'postgres' CHECK (storage_provider IN ('postgres','object')),
  binary_data BYTEA,
  storage_key TEXT,
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id,id),
  CHECK (
    (storage_provider='postgres' AND binary_data IS NOT NULL AND storage_key IS NULL)
    OR (storage_provider='object' AND binary_data IS NULL AND storage_key IS NOT NULL)
  )
);

CREATE INDEX idx_tenant_brand_assets_client_created
  ON tenant_brand_assets(client_id,asset_type,created_at DESC);

CREATE TABLE tenant_branding (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  active_logo_asset_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  updated_by_provider_user_id TEXT,
  updated_by_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_id,active_logo_asset_id)
    REFERENCES tenant_brand_assets(client_id,id) ON DELETE RESTRICT
);

CREATE TABLE tenant_branding_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('logo_uploaded','logo_replaced','logo_removed')),
  previous_logo_asset_id UUID,
  next_logo_asset_id UUID,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_role_key TEXT,
  actor_permission_key TEXT NOT NULL CHECK (actor_permission_key='company_settings.manage'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (client_id,previous_logo_asset_id)
    REFERENCES tenant_brand_assets(client_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (client_id,next_logo_asset_id)
    REFERENCES tenant_brand_assets(client_id,id) ON DELETE RESTRICT
);

CREATE INDEX idx_tenant_branding_audit_client
  ON tenant_branding_audit(client_id,occurred_at DESC,id DESC);

CREATE OR REPLACE FUNCTION protect_tenant_brand_asset() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tenant brand assets are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_brand_asset_immutable
BEFORE UPDATE OR DELETE ON tenant_brand_assets
FOR EACH ROW EXECUTE FUNCTION protect_tenant_brand_asset();

CREATE OR REPLACE FUNCTION protect_tenant_branding_audit() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tenant branding audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_branding_audit_immutable
BEFORE UPDATE OR DELETE ON tenant_branding_audit
FOR EACH ROW EXECUTE FUNCTION protect_tenant_branding_audit();
