-- BL-038E — Freeze CE Expected Liability and its lock-time provenance.
-- Existing snapshots remain NULL: NULL means the component was not captured.

ALTER TABLE cvr_period_snapshots
  ADD COLUMN IF NOT EXISTS expected_liability NUMERIC(14,2);

ALTER TABLE cvr_period_snapshot_rows
  ADD COLUMN IF NOT EXISTS expected_liability NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS expected_liability_provenance JSONB;

ALTER TABLE cvr_period_snapshots
  DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_expected_liability_presence;

ALTER TABLE cvr_period_snapshots
  ADD CONSTRAINT chk_cvr_snapshot_expected_liability_presence CHECK (
    (schema_version < 3 AND expected_liability IS NULL)
    OR (schema_version >= 3 AND expected_liability IS NOT NULL)
  );

ALTER TABLE cvr_period_snapshot_rows
  DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_row_expected_provenance;

ALTER TABLE cvr_period_snapshot_rows
  ADD CONSTRAINT chk_cvr_snapshot_row_expected_provenance CHECK (
    expected_liability_provenance IS NULL
    OR jsonb_typeof(expected_liability_provenance) = 'array'
  );
