-- VA-5B: immutable CVR submission-time Variation Account exposure evidence.
-- Additive only. Historic CVRs remain explicitly pre-VA/not captured.

CREATE TABLE cvr_period_variation_exposure_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  calculation_version TEXT NOT NULL CHECK(btrim(calculation_version) <> ''),
  source_snapshot JSONB NOT NULL CHECK(jsonb_typeof(source_snapshot) = 'object'),
  source_snapshot_hash_scheme TEXT NOT NULL CHECK(source_snapshot_hash_scheme = 'canonical_json_sha256_v1'),
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  captured_by TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, period_id, attempt_number)
);
CREATE INDEX idx_cvr_va_submissions_period
  ON cvr_period_variation_exposure_submissions(client_id,development_id,period_id,captured_at,id);

ALTER TABLE cvr_period_snapshots
  ADD COLUMN variation_exposure_submission_id UUID
    REFERENCES cvr_period_variation_exposure_submissions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_cvr_snapshot_va_submission
  ON cvr_period_snapshots(client_id,variation_exposure_submission_id)
  WHERE variation_exposure_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_cvr_va_submission_snapshot() RETURNS trigger AS $$
BEGIN
  -- Match existing CVR audit/input ownership: parent-period cleanup cascades,
  -- while direct history mutation remains forbidden.
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'CVR submitted Variation Account exposure is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_va_submission_snapshot_immutable
  BEFORE UPDATE OR DELETE ON cvr_period_variation_exposure_submissions
  FOR EACH ROW EXECUTE FUNCTION protect_cvr_va_submission_snapshot();

CREATE OR REPLACE FUNCTION validate_cvr_va_submission_snapshot_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cvr_periods p
     WHERE p.id=NEW.period_id AND p.client_id=NEW.client_id AND p.development_id=NEW.development_id
  ) THEN RAISE EXCEPTION 'CVR VA submission tenant/development/period boundary is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_va_submission_snapshot_boundary
  BEFORE INSERT ON cvr_period_variation_exposure_submissions
  FOR EACH ROW EXECUTE FUNCTION validate_cvr_va_submission_snapshot_boundary();

CREATE OR REPLACE FUNCTION validate_cvr_snapshot_va_submission_boundary() RETURNS trigger AS $$
BEGIN
  IF NEW.variation_exposure_submission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cvr_period_variation_exposure_submissions s
     WHERE s.id=NEW.variation_exposure_submission_id AND s.client_id=NEW.client_id
       AND s.development_id=NEW.development_id AND s.period_id=NEW.period_id
  ) THEN RAISE EXCEPTION 'CVR snapshot VA submission boundary is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_snapshot_va_submission_boundary
  BEFORE INSERT ON cvr_period_snapshots
  FOR EACH ROW EXECUTE FUNCTION validate_cvr_snapshot_va_submission_boundary();
