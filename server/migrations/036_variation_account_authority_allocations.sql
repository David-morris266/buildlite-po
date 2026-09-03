-- VA-3: explicit CE/Issued-VO-line authority allocation to canonical VA items.
-- Additive only. No backfill and no change to package/CVR contract authority.
CREATE TABLE IF NOT EXISTS package_variation_account_authority_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK(source_type IN('commercial_event','variation_order_line','payment_authority')),
  commercial_event_id TEXT REFERENCES commercial_events(id) ON DELETE RESTRICT,
  variation_order_line_id UUID REFERENCES variation_order_lines(id) ON DELETE RESTRICT,
  future_source_id TEXT,
  signed_allocated_amount NUMERIC(14,2) NOT NULL CHECK(signed_allocated_amount<>0),
  allocation_kind TEXT NOT NULL DEFAULT 'authority' CHECK(allocation_kind IN('authority','reversal')),
  reverses_allocation_id UUID REFERENCES package_variation_account_authority_allocations(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  source_status_snapshot TEXT NOT NULL,
  source_value_snapshot NUMERIC(14,2) NOT NULL,
  source_reference_snapshot TEXT NOT NULL,
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((source_type='commercial_event' AND commercial_event_id IS NOT NULL AND variation_order_line_id IS NULL AND future_source_id IS NULL) OR
        (source_type='variation_order_line' AND variation_order_line_id IS NOT NULL AND commercial_event_id IS NULL AND future_source_id IS NULL) OR
        (source_type='payment_authority' AND future_source_id IS NOT NULL AND commercial_event_id IS NULL AND variation_order_line_id IS NULL)),
  CHECK((allocation_kind='authority' AND reverses_allocation_id IS NULL) OR
        (allocation_kind='reversal' AND reverses_allocation_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_va_authority_allocations_item ON package_variation_account_authority_allocations(client_id,package_id,variation_account_item_id,created_at,id);
CREATE INDEX IF NOT EXISTS idx_va_authority_allocations_ce ON package_variation_account_authority_allocations(client_id,commercial_event_id) WHERE commercial_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_va_authority_allocations_vo_line ON package_variation_account_authority_allocations(client_id,variation_order_line_id) WHERE variation_order_line_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_va_authority_allocation_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM package_variation_account_items va WHERE va.id=NEW.variation_account_item_id AND va.client_id=NEW.client_id AND va.package_id=NEW.package_id AND va.development_id=NEW.development_id) THEN
    RAISE EXCEPTION 'VA authority allocation tenant/package/item boundary is invalid';
  END IF;
  IF NEW.source_type='commercial_event' AND NOT EXISTS (SELECT 1 FROM commercial_events ce WHERE ce.id=NEW.commercial_event_id AND ce.client_id=NEW.client_id AND ce.package_id=NEW.package_id AND ce.development_id=NEW.development_id) THEN
    RAISE EXCEPTION 'VA authority CE boundary is invalid';
  END IF;
  IF NEW.source_type='variation_order_line' AND NOT EXISTS (SELECT 1 FROM variation_order_lines line JOIN variation_orders vo ON vo.id=line.variation_order_id AND vo.client_id=line.client_id WHERE line.id=NEW.variation_order_line_id AND line.client_id=NEW.client_id AND vo.package_id=NEW.package_id AND vo.development_id=NEW.development_id) THEN
    RAISE EXCEPTION 'VA authority VO-line boundary is invalid';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_va_authority_allocation_boundary ON package_variation_account_authority_allocations;
CREATE TRIGGER trg_va_authority_allocation_boundary BEFORE INSERT ON package_variation_account_authority_allocations FOR EACH ROW EXECUTE FUNCTION validate_va_authority_allocation_boundary();

CREATE TABLE IF NOT EXISTS package_variation_account_authority_substitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  successor_allocation_id UUID NOT NULL REFERENCES package_variation_account_authority_allocations(id) ON DELETE RESTRICT,
  predecessor_allocation_id UUID NOT NULL REFERENCES package_variation_account_authority_allocations(id) ON DELETE RESTRICT,
  signed_substituted_amount NUMERIC(14,2) NOT NULL CHECK(signed_substituted_amount<>0),
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(successor_allocation_id<>predecessor_allocation_id),
  UNIQUE(client_id,successor_allocation_id,predecessor_allocation_id)
);
CREATE INDEX IF NOT EXISTS idx_va_authority_substitutions_item ON package_variation_account_authority_substitutions(client_id,package_id,variation_account_item_id,created_at,id);

CREATE OR REPLACE FUNCTION validate_va_authority_substitution_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM package_variation_account_authority_allocations a WHERE a.id=NEW.successor_allocation_id AND a.client_id=NEW.client_id AND a.package_id=NEW.package_id AND a.variation_account_item_id=NEW.variation_account_item_id) OR
     NOT EXISTS (SELECT 1 FROM package_variation_account_authority_allocations a WHERE a.id=NEW.predecessor_allocation_id AND a.client_id=NEW.client_id AND a.package_id=NEW.package_id AND a.variation_account_item_id=NEW.variation_account_item_id) THEN
    RAISE EXCEPTION 'VA authority substitution boundary is invalid';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_va_authority_substitution_boundary ON package_variation_account_authority_substitutions;
CREATE TRIGGER trg_va_authority_substitution_boundary BEFORE INSERT ON package_variation_account_authority_substitutions FOR EACH ROW EXECUTE FUNCTION validate_va_authority_substitution_boundary();

CREATE TABLE IF NOT EXISTS package_variation_account_authority_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  allocation_id UUID REFERENCES package_variation_account_authority_allocations(id) ON DELETE RESTRICT,
  substitution_id UUID REFERENCES package_variation_account_authority_substitutions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN('allocated','substituted','reversed')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((allocation_id IS NOT NULL)::int + (substitution_id IS NOT NULL)::int = 1)
);
CREATE INDEX IF NOT EXISTS idx_va_authority_audit_item ON package_variation_account_authority_audit(client_id,variation_account_item_id,created_at,id);

CREATE OR REPLACE FUNCTION protect_va_authority_append_only() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Variation Account authority provenance is append-only';
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_va_authority_allocations_immutable ON package_variation_account_authority_allocations;
CREATE TRIGGER trg_va_authority_allocations_immutable BEFORE UPDATE OR DELETE ON package_variation_account_authority_allocations FOR EACH ROW EXECUTE FUNCTION protect_va_authority_append_only();
DROP TRIGGER IF EXISTS trg_va_authority_substitutions_immutable ON package_variation_account_authority_substitutions;
CREATE TRIGGER trg_va_authority_substitutions_immutable BEFORE UPDATE OR DELETE ON package_variation_account_authority_substitutions FOR EACH ROW EXECUTE FUNCTION protect_va_authority_append_only();
DROP TRIGGER IF EXISTS trg_va_authority_audit_immutable ON package_variation_account_authority_audit;
CREATE TRIGGER trg_va_authority_audit_immutable BEFORE UPDATE OR DELETE ON package_variation_account_authority_audit FOR EACH ROW EXECUTE FUNCTION protect_va_authority_append_only();

INSERT INTO permissions(key,description) VALUES
 ('variation_account.authority_allocate','Allocate approved CE and Issued VO authority to Variation Account items')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
WITH grants(role_key,permission_key) AS (VALUES
 ('qs','variation_account.authority_allocate'),
 ('commercial_manager','variation_account.authority_allocate'),
 ('commercial_director','variation_account.authority_allocate'))
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,g.permission_key FROM grants g JOIN roles r ON r.key=g.role_key ON CONFLICT DO NOTHING;
