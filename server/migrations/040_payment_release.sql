-- VA-4B: immutable full Payment Release to Accounts.
-- Additive only. Creates no historic releases and changes no commercial authority.

CREATE TABLE payment_release_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  batch_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'released' CHECK(status='released'),
  item_count INTEGER NOT NULL CHECK(item_count>0),
  signed_total_released NUMERIC(14,2) NOT NULL CHECK(signed_total_released<>0),
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  idempotency_key TEXT NOT NULL,
  source_snapshot JSONB NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_hash_scheme TEXT NOT NULL CHECK(source_snapshot_hash_scheme='canonical_json_sha256_v1'),
  released_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  released_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  released_by_provider_user_id TEXT NOT NULL,
  released_by_display_name TEXT NOT NULL,
  released_role_key TEXT NOT NULL,
  released_permission_key TEXT NOT NULL CHECK(released_permission_key='payment_release.execute'),
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,batch_reference),
  UNIQUE(client_id,idempotency_key)
);

CREATE TABLE payment_release_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES payment_release_batches(id) ON DELETE RESTRICT,
  payment_authority_decision_id UUID NOT NULL REFERENCES payment_authority_decisions(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  supplier_id TEXT NOT NULL,
  supplier_label TEXT NOT NULL,
  signed_authorised_cash NUMERIC(14,2) NOT NULL CHECK(signed_authorised_cash<>0),
  signed_previously_released NUMERIC(14,2) NOT NULL DEFAULT 0,
  signed_released_cash NUMERIC(14,2) NOT NULL CHECK(signed_released_cash<>0),
  final_payment_date DATE,
  intended_payment_decision_id UUID REFERENCES package_intended_payment_decisions(id) ON DELETE RESTRICT,
  intended_payment_decision_version INTEGER,
  payment_notice_snapshot_id UUID REFERENCES package_payment_notice_snapshots(id) ON DELETE RESTRICT,
  pay_less_snapshot_id UUID REFERENCES package_payment_notice_snapshots(id) ON DELETE RESTRICT,
  deadline_snapshot_id UUID REFERENCES package_payment_certificate_deadline_snapshots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'released' CHECK(status='released'),
  external_status TEXT NOT NULL DEFAULT 'not_exported' CHECK(external_status='not_exported'),
  reverses_release_item_id UUID REFERENCES payment_release_items(id) ON DELETE RESTRICT,
  source_snapshot JSONB NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_hash_scheme TEXT NOT NULL CHECK(source_snapshot_hash_scheme='canonical_json_sha256_v1'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK((reverses_release_item_id IS NULL AND signed_released_cash=signed_authorised_cash)
    OR (reverses_release_item_id IS NOT NULL AND sign(signed_released_cash)=-sign(signed_authorised_cash)))
);
CREATE UNIQUE INDEX uq_payment_release_active_authority
  ON payment_release_items(client_id,payment_authority_decision_id)
  WHERE reverses_release_item_id IS NULL;
CREATE INDEX idx_payment_release_items_certificate
  ON payment_release_items(client_id,certificate_id,created_at,id);

CREATE TABLE payment_release_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  batch_id UUID NOT NULL REFERENCES payment_release_batches(id) ON DELETE RESTRICT,
  item_id UUID REFERENCES payment_release_items(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN('batch_released','item_released')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL CHECK(permission_key='payment_release.execute'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION protect_payment_release_immutable() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Payment Release history is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_release_batches_immutable BEFORE UPDATE OR DELETE ON payment_release_batches FOR EACH ROW EXECUTE FUNCTION protect_payment_release_immutable();
CREATE TRIGGER trg_payment_release_items_immutable BEFORE UPDATE OR DELETE ON payment_release_items FOR EACH ROW EXECUTE FUNCTION protect_payment_release_immutable();
CREATE TRIGGER trg_payment_release_audit_immutable BEFORE UPDATE OR DELETE ON payment_release_audit FOR EACH ROW EXECUTE FUNCTION protect_payment_release_immutable();

CREATE OR REPLACE FUNCTION validate_payment_release_batch_actor() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM client_user_memberships m
    JOIN role_permissions rp ON rp.role_id=m.role_id AND rp.permission_key='payment_release.execute'
    WHERE m.id=NEW.released_by_membership_id AND m.client_id=NEW.client_id AND m.user_id=NEW.released_by_user_id
      AND m.is_active=true
  ) THEN RAISE EXCEPTION 'Payment Release requires an active membership with payment_release.execute'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_release_batch_actor BEFORE INSERT ON payment_release_batches FOR EACH ROW EXECUTE FUNCTION validate_payment_release_batch_actor();

CREATE OR REPLACE FUNCTION validate_payment_release_item_boundary() RETURNS trigger AS $$
DECLARE authority payment_authority_decisions%ROWTYPE; reversal_total NUMERIC(14,2); prior_total NUMERIC(14,2);
BEGIN
  SELECT * INTO authority FROM payment_authority_decisions
    WHERE id=NEW.payment_authority_decision_id AND client_id=NEW.client_id AND decision_kind='authority' FOR UPDATE;
  IF NOT FOUND OR authority.package_id<>NEW.package_id OR authority.certificate_id<>NEW.certificate_id OR authority.development_id<>NEW.development_id THEN
    RAISE EXCEPTION 'Payment Release requires its canonical Payment Authority boundary';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM payment_release_batches b WHERE b.id=NEW.batch_id AND b.client_id=NEW.client_id) THEN
    RAISE EXCEPTION 'Payment Release batch tenant boundary is invalid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM packages p WHERE p.id=NEW.package_id AND p.client_id=NEW.client_id AND p.supplier_id=NEW.supplier_id) THEN
    RAISE EXCEPTION 'Payment Release beneficiary boundary is invalid';
  END IF;
  SELECT COALESCE(SUM(signed_cash_amount),0) INTO reversal_total FROM payment_authority_decisions
    WHERE client_id=NEW.client_id AND reverses_decision_id=authority.id;
  IF reversal_total<>0 THEN RAISE EXCEPTION 'Changed Payment Authority requires explicit reapproval before Release'; END IF;
  SELECT COALESCE(SUM(signed_released_cash),0) INTO prior_total FROM payment_release_items
    WHERE client_id=NEW.client_id AND payment_authority_decision_id=authority.id;
  IF prior_total<>0 OR NEW.signed_previously_released<>0 THEN RAISE EXCEPTION 'Payment Authority cash has already been released'; END IF;
  IF NEW.signed_authorised_cash<>authority.signed_cash_amount OR NEW.signed_released_cash<>authority.signed_cash_amount THEN
    RAISE EXCEPTION 'Pilot Payment Release must equal the full authorised cash amount';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_release_item_boundary BEFORE INSERT ON payment_release_items FOR EACH ROW EXECUTE FUNCTION validate_payment_release_item_boundary();

CREATE OR REPLACE FUNCTION validate_payment_release_batch_totals() RETURNS trigger AS $$
DECLARE target_batch UUID; expected_count INTEGER; expected_total NUMERIC(14,2); actual_count INTEGER; actual_total NUMERIC(14,2);
BEGIN
  IF TG_TABLE_NAME='payment_release_batches' THEN
    target_batch := NEW.id;
  ELSE
    target_batch := NEW.batch_id;
  END IF;
  SELECT item_count,signed_total_released INTO expected_count,expected_total FROM payment_release_batches WHERE id=target_batch;
  SELECT COUNT(*)::INTEGER,COALESCE(SUM(signed_released_cash),0) INTO actual_count,actual_total FROM payment_release_items WHERE batch_id=target_batch;
  IF expected_count<>actual_count OR expected_total<>actual_total THEN RAISE EXCEPTION 'Payment Release batch totals do not reconcile'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_payment_release_batch_totals
  AFTER INSERT ON payment_release_batches DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_payment_release_batch_totals();
CREATE CONSTRAINT TRIGGER trg_payment_release_item_totals
  AFTER INSERT ON payment_release_items DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION validate_payment_release_batch_totals();

INSERT INTO roles(key,name,description) VALUES
  ('finance','Finance','Operational release of authorised payments to Accounts')
ON CONFLICT(key) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,'payment_release.execute' FROM roles r WHERE r.key='finance'
ON CONFLICT DO NOTHING;
