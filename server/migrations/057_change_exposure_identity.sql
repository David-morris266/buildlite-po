ALTER TABLE package_variation_account_items
  ADD COLUMN IF NOT EXISTS source_commercial_event_id TEXT;

ALTER TABLE package_variation_account_items
  ADD CONSTRAINT fk_va_source_commercial_event
  FOREIGN KEY (source_commercial_event_id)
  REFERENCES commercial_events(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_va_source_commercial_event
  ON package_variation_account_items(client_id, source_commercial_event_id)
  WHERE source_commercial_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS package_variation_account_change_identity_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id),
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id),
  prior_commercial_event_id TEXT,
  new_commercial_event_id TEXT,
  reason TEXT NOT NULL,
  item_version INTEGER NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id),
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id),
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (prior_commercial_event_id IS DISTINCT FROM new_commercial_event_id)
);

CREATE INDEX IF NOT EXISTS idx_va_change_identity_audit_item
  ON package_variation_account_change_identity_audit(client_id, variation_account_item_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_va_change_identity_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'Variation Account change identity audit is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_va_change_identity_audit_immutable ON package_variation_account_change_identity_audit;
CREATE TRIGGER trg_va_change_identity_audit_immutable
BEFORE UPDATE OR DELETE ON package_variation_account_change_identity_audit
FOR EACH ROW EXECUTE FUNCTION prevent_va_change_identity_audit_mutation();
