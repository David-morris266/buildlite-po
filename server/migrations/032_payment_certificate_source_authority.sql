-- PAR-0: payment-discovered facts and certificate source-authority provenance.
-- Additive only. Historic certificates are not backfilled or reinterpreted.

CREATE TABLE IF NOT EXISTS package_payment_discovered_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  cost_code TEXT NOT NULL,
  description TEXT NOT NULL,
  signed_amount NUMERIC(14,2) NOT NULL CHECK (signed_amount <> 0),
  basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked','withdrawn')),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  CHECK ((status IN ('draft','withdrawn') AND locked_at IS NULL AND locked_by_user_id IS NULL) OR
         (status='locked' AND locked_at IS NOT NULL AND locked_by_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_payment_discovered_certificate
  ON package_payment_discovered_items(client_id,package_id,certificate_id,created_at,id);

CREATE TABLE IF NOT EXISTS package_payment_discovered_regularisation_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  payment_discovered_item_id UUID NOT NULL REFERENCES package_payment_discovered_items(id) ON DELETE RESTRICT,
  authority_type TEXT NOT NULL CHECK (authority_type IN ('commercial_event','variation_order')),
  commercial_event_id TEXT,
  variation_order_id UUID REFERENCES variation_orders(id) ON DELETE RESTRICT,
  linked_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  linked_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  comment TEXT NOT NULL DEFAULT '',
  CHECK ((authority_type='commercial_event' AND commercial_event_id IS NOT NULL AND variation_order_id IS NULL) OR
         (authority_type='variation_order' AND variation_order_id IS NOT NULL AND commercial_event_id IS NULL)),
  UNIQUE(client_id,payment_discovered_item_id,authority_type,commercial_event_id,variation_order_id)
);
CREATE INDEX IF NOT EXISTS idx_payment_discovered_regularisation
  ON package_payment_discovered_regularisation_links(client_id,payment_discovered_item_id,linked_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_discovered_ce_regularisation
  ON package_payment_discovered_regularisation_links(client_id,payment_discovered_item_id,commercial_event_id)
  WHERE authority_type='commercial_event';
CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_discovered_vo_regularisation
  ON package_payment_discovered_regularisation_links(client_id,payment_discovered_item_id,variation_order_id)
  WHERE authority_type='variation_order';

CREATE TABLE IF NOT EXISTS package_payment_discovered_item_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  item_id UUID NOT NULL REFERENCES package_payment_discovered_items(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('created','withdrawn','locked','regularisation_linked')),
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_display_name TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION protect_payment_discovered_locked_fact() RETURNS trigger AS $$
BEGIN
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'non-draft payment-discovered item is immutable'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment-discovered identity is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR
     NEW.package_id<>OLD.package_id OR NEW.certificate_id<>OLD.certificate_id OR NEW.cost_code<>OLD.cost_code OR
     NEW.description<>OLD.description OR NEW.signed_amount<>OLD.signed_amount OR NEW.basis<>OLD.basis OR
     NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR
     NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR
     NEW.created_at<>OLD.created_at THEN
    RAISE EXCEPTION 'payment-discovered fact fields are immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_discovered_locked_fact ON package_payment_discovered_items;
CREATE TRIGGER trg_payment_discovered_locked_fact BEFORE UPDATE OR DELETE ON package_payment_discovered_items
FOR EACH ROW EXECUTE FUNCTION protect_payment_discovered_locked_fact();

CREATE OR REPLACE FUNCTION protect_payment_discovered_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'payment-discovered provenance is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_discovered_links_immutable ON package_payment_discovered_regularisation_links;
CREATE TRIGGER trg_payment_discovered_links_immutable BEFORE UPDATE OR DELETE ON package_payment_discovered_regularisation_links
FOR EACH ROW EXECUTE FUNCTION protect_payment_discovered_append_only();
DROP TRIGGER IF EXISTS trg_payment_discovered_audit_immutable ON package_payment_discovered_item_audit;
CREATE TRIGGER trg_payment_discovered_audit_immutable BEFORE UPDATE OR DELETE ON package_payment_discovered_item_audit
FOR EACH ROW EXECUTE FUNCTION protect_payment_discovered_append_only();
