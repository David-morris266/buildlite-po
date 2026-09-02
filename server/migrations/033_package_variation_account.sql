-- VA-0: package-scoped Variation Account identity and immutable histories.
-- Additive foundation only. No financial integration and no historic backfill.

CREATE TABLE IF NOT EXISTS package_variation_account_sequences (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  next_number INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (client_id, package_id)
);

CREATE TABLE IF NOT EXISTS package_variation_account_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  cost_code TEXT NOT NULL,
  variation_reference TEXT NOT NULL,
  contractor_reference TEXT,
  description TEXT NOT NULL,
  current_contractor_value NUMERIC(14,2),
  current_qs_forecast NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','withdrawn')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, package_id, variation_reference)
);
CREATE INDEX IF NOT EXISTS idx_variation_account_package
  ON package_variation_account_items(client_id,package_id,status,created_at,id);

CREATE TABLE IF NOT EXISTS package_variation_account_forecast_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  prior_qs_forecast NUMERIC(14,2),
  new_qs_forecast NUMERIC(14,2) NOT NULL,
  reason TEXT NOT NULL,
  item_version INTEGER NOT NULL CHECK (item_version > 0),
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variation_account_forecast_history
  ON package_variation_account_forecast_history(client_id,variation_account_item_id,created_at,id);

CREATE TABLE IF NOT EXISTS package_variation_account_contractor_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  contractor_value NUMERIC(14,2) NOT NULL,
  contractor_reference TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual_reconciliation'
    CHECK (source_type IN ('manual_reconciliation','application_line')),
  source_id TEXT,
  reason TEXT NOT NULL,
  item_version INTEGER NOT NULL CHECK (item_version > 0),
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variation_account_contractor_positions
  ON package_variation_account_contractor_positions(client_id,variation_account_item_id,created_at,id);

CREATE TABLE IF NOT EXISTS package_variation_account_lifecycle_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created','resolved','reopened','withdrawn')),
  prior_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  item_version INTEGER NOT NULL CHECK (item_version > 0),
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_variation_account_lifecycle
  ON package_variation_account_lifecycle_audit(client_id,variation_account_item_id,created_at,id);

-- Compatibility bridge only. Existing Migration 032 facts are not backfilled or reinterpreted.
CREATE TABLE IF NOT EXISTS package_variation_account_payment_discovered_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  payment_discovered_item_id UUID NOT NULL REFERENCES package_payment_discovered_items(id) ON DELETE RESTRICT,
  linked_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  linked_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,payment_discovered_item_id)
);

CREATE OR REPLACE FUNCTION protect_variation_account_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'variation account history is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variation_account_forecast_immutable ON package_variation_account_forecast_history;
CREATE TRIGGER trg_variation_account_forecast_immutable BEFORE UPDATE OR DELETE ON package_variation_account_forecast_history
FOR EACH ROW EXECUTE FUNCTION protect_variation_account_append_only();
DROP TRIGGER IF EXISTS trg_variation_account_contractor_immutable ON package_variation_account_contractor_positions;
CREATE TRIGGER trg_variation_account_contractor_immutable BEFORE UPDATE OR DELETE ON package_variation_account_contractor_positions
FOR EACH ROW EXECUTE FUNCTION protect_variation_account_append_only();
DROP TRIGGER IF EXISTS trg_variation_account_lifecycle_immutable ON package_variation_account_lifecycle_audit;
CREATE TRIGGER trg_variation_account_lifecycle_immutable BEFORE UPDATE OR DELETE ON package_variation_account_lifecycle_audit
FOR EACH ROW EXECUTE FUNCTION protect_variation_account_append_only();
DROP TRIGGER IF EXISTS trg_variation_account_pd_links_immutable ON package_variation_account_payment_discovered_links;
CREATE TRIGGER trg_variation_account_pd_links_immutable BEFORE UPDATE OR DELETE ON package_variation_account_payment_discovered_links
FOR EACH ROW EXECUTE FUNCTION protect_variation_account_append_only();

CREATE OR REPLACE FUNCTION protect_variation_account_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'variation account identity is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR
     NEW.package_id<>OLD.package_id OR NEW.cost_code<>OLD.cost_code OR NEW.variation_reference<>OLD.variation_reference OR
     NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR
     NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR
     NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'variation account identity is immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variation_account_identity ON package_variation_account_items;
CREATE TRIGGER trg_variation_account_identity BEFORE UPDATE OR DELETE ON package_variation_account_items
FOR EACH ROW EXECUTE FUNCTION protect_variation_account_identity();

INSERT INTO permissions(key,description) VALUES
 ('variation_account.view','View package Variation Account'),
 ('variation_account.create','Create package Variation Account items'),
 ('variation_account.forecast_edit','Edit QS Variation Account forecast and reconcile contractor positions'),
 ('variation_account.resolve','Resolve, reopen or withdraw Variation Account items')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;

WITH grants(role_key,permission_key) AS (VALUES
 ('qs','variation_account.view'),('qs','variation_account.create'),('qs','variation_account.forecast_edit'),('qs','variation_account.resolve'),
 ('commercial_manager','variation_account.view'),('commercial_manager','variation_account.create'),('commercial_manager','variation_account.forecast_edit'),('commercial_manager','variation_account.resolve'),
 ('commercial_director','variation_account.view'),('commercial_director','variation_account.create'),('commercial_director','variation_account.forecast_edit'),('commercial_director','variation_account.resolve'),
 ('admin','variation_account.view')
)
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,g.permission_key FROM grants g JOIN roles r ON r.key=g.role_key
ON CONFLICT DO NOTHING;
