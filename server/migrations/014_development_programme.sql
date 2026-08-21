-- 014_development_programme.sql
-- BL-033C — Development programme assumptions (additive).
-- Seeds are GET-time only; this migration does not backfill from payload.
-- Does not alter CVR periods, snapshots, or cost_code_classifications.
-- Do not apply to buildlite_clone until the controlled programme UAT.

CREATE TABLE IF NOT EXISTS development_programme (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id      TEXT NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  site_start          DATE NOT NULL,
  first_completion    DATE,
  final_completion    DATE NOT NULL,
  total_plots         INTEGER NOT NULL DEFAULT 0,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,
  updated_by          TEXT,
  CONSTRAINT uq_development_programme_client_development
    UNIQUE (client_id, development_id),
  CONSTRAINT chk_development_programme_version
    CHECK (version >= 1),
  CONSTRAINT chk_development_programme_plots
    CHECK (total_plots >= 0),
  CONSTRAINT chk_development_programme_span
    CHECK (final_completion >= site_start),
  CONSTRAINT chk_development_programme_first_completion
    CHECK (
      first_completion IS NULL
      OR (
        first_completion >= site_start
        AND first_completion <= final_completion
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_development_programme_development_id
  ON development_programme (development_id);

CREATE INDEX IF NOT EXISTS idx_development_programme_client_development
  ON development_programme (client_id, development_id);
