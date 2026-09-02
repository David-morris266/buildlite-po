-- VA-1: immutable subcontract application variation evidence and reconciliation audit.

CREATE TABLE IF NOT EXISTS subcontract_payment_application_variation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES subcontract_payment_applications(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  variation_account_item_id UUID REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  contractor_reference TEXT,
  contractor_description TEXT NOT NULL,
  contractor_variation_value NUMERIC(14,2) NOT NULL,
  previous_claim NUMERIC(14,2) NOT NULL,
  current_claim NUMERIC(14,2) NOT NULL,
  cumulative_claim NUMERIC(14,2) NOT NULL,
  reconciliation_state TEXT NOT NULL DEFAULT 'unresolved',
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_application_variation_description CHECK (btrim(contractor_description) <> ''),
  CONSTRAINT chk_application_variation_claim_arithmetic CHECK (previous_claim + current_claim = cumulative_claim),
  CONSTRAINT chk_application_variation_reconciliation CHECK (reconciliation_state IN ('unresolved','matched','new')),
  CONSTRAINT chk_application_variation_match_state CHECK (
    (reconciliation_state = 'matched' AND variation_account_item_id IS NOT NULL) OR
    (reconciliation_state IN ('unresolved','new') AND variation_account_item_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_application_variation_lines_application
  ON subcontract_payment_application_variation_lines(client_id, application_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_application_variation_lines_account
  ON subcontract_payment_application_variation_lines(client_id, variation_account_item_id)
  WHERE variation_account_item_id IS NOT NULL;

CREATE OR REPLACE FUNCTION guard_application_variation_line_mutation() RETURNS trigger AS $$
DECLARE app_status TEXT; cert_status TEXT;
BEGIN
  SELECT a.status,c.status INTO app_status,cert_status FROM subcontract_payment_applications a
  LEFT JOIN package_payment_certificates c ON c.id=a.certificate_id AND c.client_id=a.client_id
  WHERE a.id=OLD.application_id;
  IF app_status <> 'recorded' OR (cert_status IS NOT NULL AND cert_status <> 'draft') THEN
    RAISE EXCEPTION 'Frozen application variation evidence is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Application variation evidence cannot be deleted'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_application_variation_line_guard ON subcontract_payment_application_variation_lines;
CREATE TRIGGER trg_application_variation_line_guard BEFORE UPDATE OR DELETE
  ON subcontract_payment_application_variation_lines FOR EACH ROW EXECUTE FUNCTION guard_application_variation_line_mutation();

CREATE TABLE IF NOT EXISTS subcontract_payment_application_variation_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  line_id UUID NOT NULL REFERENCES subcontract_payment_application_variation_lines(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_application_variation_audit_line
  ON subcontract_payment_application_variation_audit(line_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_application_variation_audit_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Application variation audit is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_application_variation_audit_immutable ON subcontract_payment_application_variation_audit;
CREATE TRIGGER trg_application_variation_audit_immutable BEFORE UPDATE OR DELETE
  ON subcontract_payment_application_variation_audit FOR EACH ROW EXECUTE FUNCTION prevent_application_variation_audit_mutation();

-- Existing applications remain valid. No historic lines are invented.
