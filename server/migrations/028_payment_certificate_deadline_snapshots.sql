-- Certificate payment-cycle input and immutable timetable evidence.
-- Additive only: no existing certificate is backfilled or recalculated.

ALTER TABLE package_payment_certificates
  ADD COLUMN IF NOT EXISTS contractual_valuation_date DATE;

CREATE TABLE IF NOT EXISTS package_payment_certificate_deadline_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  stage TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  certificate_version INTEGER NOT NULL,
  readiness TEXT NOT NULL,
  calculation_status TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  rules_schema_version INTEGER,
  terms_version_id UUID REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT,
  -- Identity is frozen as provenance; no FK so later test-data/application cleanup cannot rewrite evidence.
  application_id UUID,
  application_revision_number INTEGER,
  anchor_type TEXT,
  anchor_value DATE,
  contractual_valuation_date DATE,
  due_date DATE,
  payment_notice_deadline DATE,
  final_date_for_payment DATE,
  pay_less_notice_deadline DATE,
  governing_terms_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  application_snapshot JSONB,
  cycle_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  captured_by TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_certificate_deadline_stage CHECK (stage IN ('submission','locked')),
  CONSTRAINT chk_certificate_deadline_attempt CHECK (attempt_number > 0),
  CONSTRAINT chk_certificate_deadline_version CHECK (certificate_version > 0),
  CONSTRAINT chk_certificate_deadline_terms_json CHECK (jsonb_typeof(governing_terms_snapshot) = 'object'),
  CONSTRAINT chk_certificate_deadline_application_json CHECK (application_snapshot IS NULL OR jsonb_typeof(application_snapshot) = 'object'),
  CONSTRAINT chk_certificate_deadline_inputs_json CHECK (jsonb_typeof(cycle_inputs) = 'object'),
  CONSTRAINT chk_certificate_deadline_reasons_json CHECK (jsonb_typeof(reasons) = 'array'),
  UNIQUE (client_id, certificate_id, stage, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_certificate_deadline_snapshots_certificate
  ON package_payment_certificate_deadline_snapshots(client_id, certificate_id, captured_at, id);
CREATE INDEX IF NOT EXISTS idx_certificate_deadline_snapshots_package
  ON package_payment_certificate_deadline_snapshots(client_id, package_id, certificate_id);

CREATE OR REPLACE FUNCTION prevent_certificate_deadline_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Payment certificate timetable snapshots are immutable';
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_certificate_deadline_snapshot_immutable
  ON package_payment_certificate_deadline_snapshots;
CREATE TRIGGER trg_certificate_deadline_snapshot_immutable
  BEFORE UPDATE OR DELETE ON package_payment_certificate_deadline_snapshots
  FOR EACH ROW EXECUTE FUNCTION prevent_certificate_deadline_snapshot_mutation();
