-- Payment Notice, intended-payment decision and Pay Less authority foundation.
-- Additive only. No historic certificate or notice backfill.

CREATE TABLE IF NOT EXISTS package_payment_notices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('payment_notice','pay_less_notice')),
  notice_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','prepared','issued','voided','superseded')),
  source_notice_id UUID REFERENCES package_payment_notices(id) ON DELETE RESTRICT,
  supersedes_notice_id UUID REFERENCES package_payment_notices(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  draft_data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(draft_data)='object'),
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, notice_reference),
  UNIQUE(client_id, certificate_id, notice_type, supersedes_notice_id)
);

CREATE TABLE IF NOT EXISTS package_intended_payment_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  decision_version INTEGER NOT NULL CHECK (decision_version > 0),
  state TEXT NOT NULL CHECK (state IN ('proposed','confirmed')),
  intended_amount NUMERIC(18,2) NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  basis TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE(client_id, certificate_id, decision_version)
);

CREATE TABLE IF NOT EXISTS package_payment_notice_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  notice_id UUID NOT NULL REFERENCES package_payment_notices(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('payment_notice','pay_less_notice')),
  stage TEXT NOT NULL CHECK (stage IN ('prepared','issued')),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  notice_reference TEXT NOT NULL,
  notice_mode TEXT,
  terms_version_id UUID REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT,
  rules_schema_version INTEGER,
  deadline_snapshot_id UUID REFERENCES package_payment_certificate_deadline_snapshots(id) ON DELETE RESTRICT,
  source_notice_id UUID REFERENCES package_payment_notices(id) ON DELETE RESTRICT,
  intended_payment_decision_id UUID REFERENCES package_intended_payment_decisions(id) ON DELETE RESTRICT,
  intended_payment_decision_version INTEGER,
  assessed_gross NUMERIC(18,2), retention NUMERIC(18,2), recoveries NUMERIC(18,2), vat NUMERIC(18,2), assessed_net NUMERIC(18,2),
  notified_sum NUMERIC(18,2), intended_payment NUMERIC(18,2), reduction NUMERIC(18,2),
  payment_notice_deadline DATE, pay_less_deadline DATE,
  basis_of_calculation TEXT,
  terms_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  rules_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  timetable_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  application_snapshot JSONB,
  monetary_basis JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version INTEGER NOT NULL DEFAULT 1,
  calculator_version TEXT,
  actor TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, notice_id, stage, attempt_number)
);

CREATE TABLE IF NOT EXISTS package_payment_notice_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  notice_id UUID NOT NULL REFERENCES package_payment_notices(id) ON DELETE RESTRICT,
  action TEXT NOT NULL, actor TEXT, detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_notices_certificate ON package_payment_notices(client_id,certificate_id,notice_type);
CREATE INDEX IF NOT EXISTS idx_intended_payment_certificate ON package_intended_payment_decisions(client_id,certificate_id,decision_version DESC);
CREATE INDEX IF NOT EXISTS idx_payment_notice_snapshots_notice ON package_payment_notice_snapshots(client_id,notice_id,stage,attempt_number);
CREATE INDEX IF NOT EXISTS idx_payment_notice_audit_notice ON package_payment_notice_audit(client_id,notice_id,created_at);

CREATE OR REPLACE FUNCTION prevent_payment_notice_snapshot_mutation() RETURNS trigger AS $$ BEGIN
  RAISE EXCEPTION 'Payment notice snapshots are immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_notice_snapshot_immutable ON package_payment_notice_snapshots;
CREATE TRIGGER trg_payment_notice_snapshot_immutable BEFORE UPDATE OR DELETE ON package_payment_notice_snapshots
FOR EACH ROW EXECUTE FUNCTION prevent_payment_notice_snapshot_mutation();

CREATE OR REPLACE FUNCTION prevent_referenced_payment_decision_mutation() RETURNS trigger AS $$ BEGIN
  IF EXISTS(SELECT 1 FROM package_payment_notice_snapshots s WHERE s.intended_payment_decision_id=OLD.id AND s.stage='issued') THEN
    RAISE EXCEPTION 'An intended-payment decision referenced by an Issued notice is immutable';
  END IF; RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_referenced_payment_decision_immutable ON package_intended_payment_decisions;
CREATE TRIGGER trg_referenced_payment_decision_immutable BEFORE UPDATE OR DELETE ON package_intended_payment_decisions
FOR EACH ROW EXECUTE FUNCTION prevent_referenced_payment_decision_mutation();
