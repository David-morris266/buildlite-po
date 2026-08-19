-- 010_cvr_period_snapshots.sql
-- BL-031E.1 — Immutable CVR period snapshot schema (additive).
-- Does not persist snapshots at runtime (BL-031E.2 close engine is calculate-only).
-- Does not backfill locked periods from live CVR data.
-- Approve & Lock remains workflow-only until BL-031E.3.

CREATE TABLE IF NOT EXISTS cvr_period_snapshots (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id          TEXT NOT NULL REFERENCES developments(id),
  period_id               UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE RESTRICT,
  period_key              TEXT NOT NULL,
  schema_version          INTEGER NOT NULL DEFAULT 1,
  commentary              JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_readiness        JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_budget          NUMERIC(14,2) NOT NULL DEFAULT 0,
  committed               NUMERIC(14,2) NOT NULL DEFAULT 0,
  certified               NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cost             NUMERIC(14,2) NOT NULL DEFAULT 0,
  manual_accrual          NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,
  system_forecast         NUMERIC(14,2) NOT NULL DEFAULT 0,
  commercial_adjustment   NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_forecast          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_to_complete        NUMERIC(14,2) NOT NULL DEFAULT 0,
  -- Frozen source for Worksheet outstanding certified AND Summary
  -- "Certified Not in Ledger" (identical BL-031D formula: max(0, certified - actual)).
  outstanding_certified   NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance                NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT,
  CONSTRAINT uq_cvr_period_snapshots_client_period
    UNIQUE (client_id, period_id),
  CONSTRAINT chk_cvr_period_snapshots_schema_version
    CHECK (schema_version >= 1),
  CONSTRAINT chk_cvr_period_snapshots_period_key
    CHECK (char_length(btrim(period_key)) BETWEEN 1 AND 32),
  CONSTRAINT chk_cvr_period_snapshots_commentary
    CHECK (jsonb_typeof(commentary) = 'object'),
  CONSTRAINT chk_cvr_period_snapshots_source_readiness
    CHECK (jsonb_typeof(source_readiness) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshots_client_development
  ON cvr_period_snapshots (client_id, development_id);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshots_period
  ON cvr_period_snapshots (period_id);

CREATE TABLE IF NOT EXISTS cvr_period_snapshot_rows (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_id             UUID NOT NULL REFERENCES cvr_period_snapshots(id) ON DELETE CASCADE,
  cost_code_key           TEXT NOT NULL,
  cost_code_label         TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  commercial_head         TEXT NOT NULL DEFAULT '',
  commercial_family       TEXT NOT NULL DEFAULT '',
  trade                   TEXT NOT NULL DEFAULT '',
  active                  BOOLEAN NOT NULL DEFAULT true,
  original_budget         NUMERIC(14,2),
  current_budget          NUMERIC(14,2),
  commercial_adjustment   NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_reason       TEXT NOT NULL DEFAULT '',
  manual_accrual          NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes                   TEXT NOT NULL DEFAULT '',
  committed               NUMERIC(14,2) NOT NULL DEFAULT 0,
  certified               NUMERIC(14,2) NOT NULL DEFAULT 0,
  actual_cost             NUMERIC(14,2) NOT NULL DEFAULT 0,
  current_cost            NUMERIC(14,2) NOT NULL DEFAULT 0,
  system_forecast         NUMERIC(14,2) NOT NULL DEFAULT 0,
  final_forecast          NUMERIC(14,2) NOT NULL DEFAULT 0,
  cost_to_complete        NUMERIC(14,2) NOT NULL DEFAULT 0,
  outstanding_certified   NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance                NUMERIC(14,2) NOT NULL DEFAULT 0,
  display_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_cvr_period_snapshot_rows_snapshot_key
    UNIQUE (snapshot_id, cost_code_key),
  CONSTRAINT chk_cvr_period_snapshot_rows_key
    CHECK (char_length(btrim(cost_code_key)) BETWEEN 1 AND 64),
  CONSTRAINT chk_cvr_period_snapshot_rows_metadata
    CHECK (jsonb_typeof(display_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshot_rows_snapshot
  ON cvr_period_snapshot_rows (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshot_rows_client_key
  ON cvr_period_snapshot_rows (client_id, cost_code_key);
