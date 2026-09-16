-- GP-5E.2A: immutable CVR submission-time Commercial Structure evidence.
-- Additive only. Existing Submitted/Locked CVRs remain legacy/not captured.
CREATE TABLE cvr_period_hierarchy_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  source_snapshot JSONB NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  source_snapshot_hash_scheme TEXT NOT NULL CHECK (source_snapshot_hash_scheme = 'canonical_json_sha256_v1'),
  source_snapshot_sha256 TEXT NOT NULL CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  captured_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  captured_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  captured_by_provider_user_id TEXT,
  captured_by_display_name TEXT,
  captured_by_role_key TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, period_id, attempt_number)
);
CREATE INDEX idx_cvr_hierarchy_submissions_period ON cvr_period_hierarchy_submissions(client_id,development_id,period_id,attempt_number);
ALTER TABLE cvr_period_snapshots ADD COLUMN hierarchy_submission_id UUID REFERENCES cvr_period_hierarchy_submissions(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX uq_cvr_snapshot_hierarchy_submission ON cvr_period_snapshots(client_id,hierarchy_submission_id) WHERE hierarchy_submission_id IS NOT NULL;
CREATE FUNCTION protect_cvr_hierarchy_submission() RETURNS trigger AS $$ BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'CVR submitted Commercial Structure evidence is immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_hierarchy_submission_immutable BEFORE UPDATE OR DELETE ON cvr_period_hierarchy_submissions FOR EACH ROW EXECUTE FUNCTION protect_cvr_hierarchy_submission();
CREATE FUNCTION validate_cvr_hierarchy_submission_boundary() RETURNS trigger AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM cvr_periods p WHERE p.id=NEW.period_id AND p.client_id=NEW.client_id AND p.development_id=NEW.development_id)
  THEN RAISE EXCEPTION 'CVR hierarchy submission tenant/development/period boundary is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_hierarchy_submission_boundary BEFORE INSERT ON cvr_period_hierarchy_submissions FOR EACH ROW EXECUTE FUNCTION validate_cvr_hierarchy_submission_boundary();
CREATE FUNCTION validate_cvr_snapshot_hierarchy_submission_boundary() RETURNS trigger AS $$ BEGIN
  IF NEW.hierarchy_submission_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM cvr_period_hierarchy_submissions s WHERE s.id=NEW.hierarchy_submission_id AND s.client_id=NEW.client_id AND s.development_id=NEW.development_id AND s.period_id=NEW.period_id)
  THEN RAISE EXCEPTION 'CVR snapshot hierarchy submission boundary is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_snapshot_hierarchy_submission_boundary BEFORE INSERT ON cvr_period_snapshots FOR EACH ROW EXECUTE FUNCTION validate_cvr_snapshot_hierarchy_submission_boundary();
