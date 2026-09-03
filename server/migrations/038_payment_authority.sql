-- VA-4A / PAR-1: immutable Payment Approval Run and Payment Authority.
-- Additive only. No historic backfill, Payment Release or CVR integration.

CREATE TABLE payment_authority_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  run_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','completed','completed_with_exceptions')),
  idempotency_key TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(client_id,run_reference), UNIQUE(client_id,idempotency_key),
  CHECK((status='draft' AND completed_at IS NULL) OR (status<>'draft' AND completed_at IS NOT NULL))
);

CREATE TABLE payment_authority_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  run_id UUID NOT NULL REFERENCES payment_authority_runs(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  certificate_version INTEGER NOT NULL CHECK(certificate_version>0),
  decision_kind TEXT NOT NULL DEFAULT 'authority' CHECK(decision_kind IN('authority','reversal')),
  reverses_decision_id UUID REFERENCES payment_authority_decisions(id) ON DELETE RESTRICT,
  signed_cash_amount NUMERIC(14,2) NOT NULL,
  certified_gross NUMERIC(14,2) NOT NULL, retention NUMERIC(14,2) NOT NULL,
  recoveries NUMERIC(14,2) NOT NULL, vat NUMERIC(14,2) NOT NULL, certificate_net NUMERIC(14,2) NOT NULL,
  notified_sum NUMERIC(14,2), intended_payment NUMERIC(14,2), pay_less_reduction NUMERIC(14,2),
  final_payment_date DATE,
  intended_payment_decision_id UUID REFERENCES package_intended_payment_decisions(id) ON DELETE RESTRICT,
  intended_payment_decision_version INTEGER,
  payment_notice_snapshot_id UUID REFERENCES package_payment_notice_snapshots(id) ON DELETE RESTRICT,
  pay_less_snapshot_id UUID REFERENCES package_payment_notice_snapshots(id) ON DELETE RESTRICT,
  deadline_snapshot_id UUID REFERENCES package_payment_certificate_deadline_snapshots(id) ON DELETE RESTRICT,
  notice_mode TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(btrim(reason)<>''),
  source_snapshot JSONB NOT NULL, source_snapshot_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  approved_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  approved_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  approved_by_provider_user_id TEXT NOT NULL, approved_by_display_name TEXT NOT NULL,
  approved_role_key TEXT NOT NULL, approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,idempotency_key),
  CHECK((decision_kind='authority' AND reverses_decision_id IS NULL) OR (decision_kind='reversal' AND reverses_decision_id IS NOT NULL))
);
CREATE INDEX idx_payment_authority_decisions_certificate ON payment_authority_decisions(client_id,certificate_id,approved_at,id);

CREATE TABLE payment_authority_decision_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  decision_id UUID NOT NULL REFERENCES payment_authority_decisions(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  assessment_id UUID NOT NULL REFERENCES package_variation_account_certificate_assessments(id) ON DELETE RESTRICT,
  signed_assessment NUMERIC(14,2) NOT NULL,
  signed_unapproved_at_lock NUMERIC(14,2) NOT NULL,
  signed_existing_support NUMERIC(14,2) NOT NULL DEFAULT 0,
  signed_unresolved_amount NUMERIC(14,2) NOT NULL,
  signed_new_commercial_authority NUMERIC(14,2) NOT NULL DEFAULT 0,
  basis TEXT NOT NULL CHECK(btrim(basis)<>''), source_snapshot JSONB NOT NULL,
  UNIQUE(client_id,decision_id,assessment_id)
);
CREATE INDEX idx_payment_authority_lines_assessment ON payment_authority_decision_lines(client_id,assessment_id);

CREATE TABLE payment_authority_support_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  decision_line_id UUID NOT NULL REFERENCES payment_authority_decision_lines(id) ON DELETE RESTRICT,
  authority_allocation_id UUID NOT NULL REFERENCES package_variation_account_authority_allocations(id) ON DELETE RESTRICT,
  signed_applied_amount NUMERIC(14,2) NOT NULL CHECK(signed_applied_amount<>0),
  source_snapshot JSONB NOT NULL,
  UNIQUE(client_id,decision_line_id,authority_allocation_id)
);
CREATE INDEX idx_payment_authority_support_allocation ON payment_authority_support_usages(client_id,authority_allocation_id);

ALTER TABLE package_variation_account_authority_allocations
  ADD COLUMN payment_authority_decision_line_id UUID REFERENCES payment_authority_decision_lines(id) ON DELETE RESTRICT;
ALTER TABLE package_variation_account_authority_allocations
  ADD CONSTRAINT chk_va_payment_authority_source_fk CHECK(
    (source_type='payment_authority' AND payment_authority_decision_line_id IS NOT NULL AND future_source_id IS NOT NULL)
    OR (source_type<>'payment_authority' AND payment_authority_decision_line_id IS NULL)
  );
CREATE UNIQUE INDEX uq_va_payment_authority_line_allocation
  ON package_variation_account_authority_allocations(client_id,payment_authority_decision_line_id)
  WHERE source_type='payment_authority' AND allocation_kind='authority';

CREATE TABLE payment_authority_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  run_id UUID REFERENCES payment_authority_runs(id) ON DELETE RESTRICT,
  decision_id UUID REFERENCES payment_authority_decisions(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK(action IN('run_created','approved','reversed','row_failed','run_completed')),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id), actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id),
  actor_provider_user_id TEXT NOT NULL, actor_display_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(run_id IS NOT NULL OR decision_id IS NOT NULL)
);

CREATE OR REPLACE FUNCTION protect_payment_authority_immutable() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Payment Authority history is append-only';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_authority_decisions_immutable BEFORE UPDATE OR DELETE ON payment_authority_decisions FOR EACH ROW EXECUTE FUNCTION protect_payment_authority_immutable();
CREATE TRIGGER trg_payment_authority_lines_immutable BEFORE UPDATE OR DELETE ON payment_authority_decision_lines FOR EACH ROW EXECUTE FUNCTION protect_payment_authority_immutable();
CREATE TRIGGER trg_payment_authority_support_immutable BEFORE UPDATE OR DELETE ON payment_authority_support_usages FOR EACH ROW EXECUTE FUNCTION protect_payment_authority_immutable();
CREATE TRIGGER trg_payment_authority_audit_immutable BEFORE UPDATE OR DELETE ON payment_authority_audit FOR EACH ROW EXECUTE FUNCTION protect_payment_authority_immutable();

CREATE OR REPLACE FUNCTION validate_payment_authority_decision_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM package_payment_certificates c JOIN packages p ON p.id=c.package_id AND p.client_id=c.client_id
    WHERE c.id=NEW.certificate_id AND c.client_id=NEW.client_id AND c.package_id=NEW.package_id
      AND c.development_id=NEW.development_id AND c.status='locked'
  ) THEN RAISE EXCEPTION 'Payment Authority requires the canonical Locked certificate boundary'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_authority_decision_boundary BEFORE INSERT ON payment_authority_decisions FOR EACH ROW EXECUTE FUNCTION validate_payment_authority_decision_boundary();

CREATE OR REPLACE FUNCTION validate_payment_authority_line_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM package_variation_account_certificate_assessments a
    WHERE a.id=NEW.assessment_id AND a.client_id=NEW.client_id AND a.package_id=NEW.package_id
      AND a.certificate_id=NEW.certificate_id AND a.variation_account_item_id=NEW.variation_account_item_id AND a.status='locked'
  ) THEN RAISE EXCEPTION 'Payment Authority line requires its canonical Locked VA assessment'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_authority_line_boundary BEFORE INSERT ON payment_authority_decision_lines FOR EACH ROW EXECUTE FUNCTION validate_payment_authority_line_boundary();

CREATE OR REPLACE FUNCTION validate_payment_authority_support_boundary() RETURNS trigger AS $$
DECLARE allocation package_variation_account_authority_allocations%ROWTYPE; consumed NUMERIC(14,2); substituted NUMERIC(14,2); reversed NUMERIC(14,2);
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM payment_authority_decision_lines l
    JOIN package_variation_account_authority_allocations a ON a.id=NEW.authority_allocation_id
    WHERE l.id=NEW.decision_line_id AND l.client_id=NEW.client_id AND a.client_id=NEW.client_id
      AND a.package_id=l.package_id AND a.variation_account_item_id=l.variation_account_item_id
      AND a.source_type IN('commercial_event','variation_order_line')
  ) THEN RAISE EXCEPTION 'Payment Authority support usage boundary is invalid'; END IF;
  SELECT * INTO allocation FROM package_variation_account_authority_allocations WHERE id=NEW.authority_allocation_id FOR UPDATE;
  IF sign(NEW.signed_applied_amount)<>sign(allocation.signed_allocated_amount) THEN RAISE EXCEPTION 'Payment Authority support sign must match authority'; END IF;
  SELECT COALESCE(SUM(ABS(signed_applied_amount)),0) INTO consumed FROM payment_authority_support_usages WHERE client_id=NEW.client_id AND authority_allocation_id=NEW.authority_allocation_id;
  SELECT COALESCE(SUM(ABS(signed_substituted_amount)),0) INTO substituted FROM package_variation_account_authority_substitutions WHERE client_id=NEW.client_id AND predecessor_allocation_id=NEW.authority_allocation_id;
  SELECT COALESCE(SUM(ABS(signed_allocated_amount)),0) INTO reversed FROM package_variation_account_authority_allocations WHERE client_id=NEW.client_id AND reverses_allocation_id=NEW.authority_allocation_id;
  IF consumed+ABS(NEW.signed_applied_amount)>ABS(allocation.signed_allocated_amount)-substituted-reversed THEN RAISE EXCEPTION 'Payment Authority support exceeds effective available authority'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_authority_support_boundary BEFORE INSERT ON payment_authority_support_usages FOR EACH ROW EXECUTE FUNCTION validate_payment_authority_support_boundary();

CREATE OR REPLACE FUNCTION validate_va_payment_authority_source() RETURNS trigger AS $$
BEGIN
  IF NEW.source_type='payment_authority' AND NOT EXISTS(
    SELECT 1 FROM payment_authority_decision_lines l JOIN payment_authority_decisions d ON d.id=l.decision_id AND d.client_id=l.client_id
    WHERE l.id=NEW.payment_authority_decision_line_id AND l.client_id=NEW.client_id
      AND l.package_id=NEW.package_id AND l.variation_account_item_id=NEW.variation_account_item_id
      AND l.signed_new_commercial_authority=NEW.signed_allocated_amount
  ) THEN RAISE EXCEPTION 'Payment Authority VA allocation must exactly reference its decision line'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_va_payment_authority_source BEFORE INSERT ON package_variation_account_authority_allocations FOR EACH ROW EXECUTE FUNCTION validate_va_payment_authority_source();

INSERT INTO permissions(key,description) VALUES
 ('payment_approval_run.view','View the Payment Approval Run'),
 ('payment_authority.approve','Approve immutable Payment Authority'),
 ('payment_authority.reverse','Reverse Payment Authority append-only'),
 ('payment_release.execute','Execute a future authorised payment release')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
WITH grants(role_key,permission_key) AS (VALUES
 ('commercial_manager','payment_approval_run.view'),
 ('commercial_director','payment_approval_run.view'),
 ('commercial_director','payment_authority.approve'),
 ('commercial_director','payment_authority.reverse'))
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,g.permission_key FROM grants g JOIN roles r ON r.key=g.role_key ON CONFLICT DO NOTHING;
