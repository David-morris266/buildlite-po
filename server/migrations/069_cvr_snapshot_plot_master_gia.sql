-- 069_cvr_snapshot_plot_master_gia.sql
-- Freeze governed Plot Master GIA when a CVR is approved and locked.
-- Additive only: historical snapshots remain explicitly unavailable.

CREATE TABLE IF NOT EXISTS cvr_period_snapshot_gia_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id TEXT NOT NULL REFERENCES developments(id),
  period_id UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE RESTRICT,
  snapshot_id UUID NOT NULL UNIQUE REFERENCES cvr_period_snapshots(id) ON DELETE CASCADE,
  evidence_schema_version INTEGER NOT NULL,
  availability_state TEXT NOT NULL,
  total_plot_count INTEGER NOT NULL,
  active_plot_count INTEGER NOT NULL,
  active_plot_gia_count INTEGER NOT NULL,
  captured_valid_active_gia NUMERIC(16,4),
  total_active_gia NUMERIC(16,4),
  is_finalized BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  CONSTRAINT chk_cvr_gia_evidence_version CHECK (evidence_schema_version >= 1),
  CONSTRAINT chk_cvr_gia_availability CHECK (availability_state IN ('complete','incomplete','plot_master_missing','no_active_plots','total_out_of_range')),
  CONSTRAINT chk_cvr_gia_counts CHECK (
    total_plot_count >= 0 AND active_plot_count >= 0 AND active_plot_gia_count >= 0
    AND active_plot_count <= total_plot_count AND active_plot_gia_count <= active_plot_count
  ),
  CONSTRAINT chk_cvr_gia_complete CHECK (
    (availability_state = 'complete' AND active_plot_count > 0 AND active_plot_gia_count = active_plot_count AND captured_valid_active_gia=total_active_gia AND total_active_gia > 0)
    OR (availability_state <> 'complete' AND total_active_gia IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS cvr_period_snapshot_gia_plots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES cvr_period_snapshot_gia_evidence(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL REFERENCES cvr_period_snapshots(id) ON DELETE CASCADE,
  plot_id TEXT NOT NULL,
  source_index INTEGER NOT NULL,
  source_plot_id TEXT,
  source_identity_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  source_identity_oversized BOOLEAN NOT NULL DEFAULT FALSE,
  plot_number TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL,
  original_gia_raw TEXT,
  original_gia NUMERIC(16,4),
  gia_valid BOOLEAN NOT NULL,
  invalid_reason TEXT,
  CONSTRAINT uq_cvr_gia_plot_identity UNIQUE (evidence_id, plot_id),
  CONSTRAINT uq_cvr_gia_plot_source_index UNIQUE (evidence_id, source_index),
  CONSTRAINT chk_cvr_gia_plot_id CHECK (char_length(btrim(plot_id)) BETWEEN 1 AND 128),
  CONSTRAINT chk_cvr_gia_plot_index CHECK (source_index >= 0),
  CONSTRAINT chk_cvr_gia_plot_reason CHECK (invalid_reason IS NULL OR invalid_reason IN ('missing','not_numeric','non_positive','out_of_range')),
  CONSTRAINT chk_cvr_gia_plot_validity CHECK ((gia_valid AND original_gia > 0 AND invalid_reason IS NULL) OR (NOT gia_valid AND invalid_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_cvr_snapshot_gia_evidence_tenant_period
  ON cvr_period_snapshot_gia_evidence(client_id, period_id);
CREATE INDEX IF NOT EXISTS idx_cvr_snapshot_gia_plots_tenant_snapshot
  ON cvr_period_snapshot_gia_plots(client_id, snapshot_id);

CREATE OR REPLACE FUNCTION validate_cvr_snapshot_gia_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cvr_period_snapshots s
    WHERE s.id=NEW.snapshot_id AND s.client_id=NEW.client_id
      AND s.development_id=NEW.development_id AND s.period_id=NEW.period_id
      -- xmin is xid (32-bit); cast the current xid8 down to xid so epoch wrap is compared correctly.
      AND s.xmin=pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'CVR GIA evidence must match a snapshot created in the current lock transaction';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_cvr_snapshot_gia_plot_identity() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cvr_period_snapshot_gia_evidence e
    WHERE e.id=NEW.evidence_id AND e.client_id=NEW.client_id AND e.snapshot_id=NEW.snapshot_id
      AND e.is_finalized=FALSE
  ) THEN
    RAISE EXCEPTION 'CVR GIA plot identity is invalid or its evidence header is already finalised';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cvr_snapshot_gia_identity ON cvr_period_snapshot_gia_evidence;
CREATE TRIGGER trg_cvr_snapshot_gia_identity
  BEFORE INSERT ON cvr_period_snapshot_gia_evidence
  FOR EACH ROW EXECUTE FUNCTION validate_cvr_snapshot_gia_identity();

DROP TRIGGER IF EXISTS trg_cvr_snapshot_gia_plot_identity ON cvr_period_snapshot_gia_plots;
CREATE TRIGGER trg_cvr_snapshot_gia_plot_identity
  BEFORE INSERT ON cvr_period_snapshot_gia_plots
  FOR EACH ROW EXECUTE FUNCTION validate_cvr_snapshot_gia_plot_identity();

CREATE OR REPLACE FUNCTION protect_cvr_snapshot_gia_evidence() RETURNS trigger AS $$
DECLARE
  plot_count INTEGER;
  active_count INTEGER;
  valid_active_count INTEGER;
  valid_active_total NUMERIC;
BEGIN
  IF TG_OP='DELETE' THEN
    IF pg_trigger_depth() = 1 THEN RAISE EXCEPTION 'Locked CVR GIA evidence is immutable'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_finalized=FALSE AND NEW.is_finalized=TRUE
     AND (to_jsonb(NEW)-'is_finalized')=(to_jsonb(OLD)-'is_finalized') THEN
    SELECT COUNT(*)::int,
           COUNT(*) FILTER (WHERE active)::int,
           COUNT(*) FILTER (WHERE active AND gia_valid)::int,
           COALESCE(SUM(original_gia) FILTER (WHERE active AND gia_valid),0)
      INTO plot_count, active_count, valid_active_count, valid_active_total
      FROM cvr_period_snapshot_gia_plots WHERE evidence_id=OLD.id;
    IF plot_count<>OLD.total_plot_count OR active_count<>OLD.active_plot_count
       OR valid_active_count<>OLD.active_plot_gia_count
       OR (OLD.availability_state<>'total_out_of_range' AND valid_active_total<>OLD.captured_valid_active_gia)
       OR (OLD.availability_state='total_out_of_range' AND
           (OLD.captured_valid_active_gia IS NOT NULL OR ABS(valid_active_total)<=999999999999.9999))
       OR (OLD.availability_state='complete' AND valid_active_total<>OLD.total_active_gia) THEN
      RAISE EXCEPTION 'CVR GIA evidence cannot be finalised because plot rows do not reconcile';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Locked CVR GIA evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cvr_snapshot_gia_evidence_immutable ON cvr_period_snapshot_gia_evidence;
CREATE TRIGGER trg_cvr_snapshot_gia_evidence_immutable
  BEFORE UPDATE OR DELETE ON cvr_period_snapshot_gia_evidence
  FOR EACH ROW EXECUTE FUNCTION protect_cvr_snapshot_gia_evidence();

CREATE OR REPLACE FUNCTION protect_cvr_snapshot_gia_plot() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Locked CVR GIA evidence is immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cvr_snapshot_gia_plots_immutable ON cvr_period_snapshot_gia_plots;
CREATE TRIGGER trg_cvr_snapshot_gia_plots_immutable
  BEFORE UPDATE OR DELETE ON cvr_period_snapshot_gia_plots
  FOR EACH ROW EXECUTE FUNCTION protect_cvr_snapshot_gia_plot();
