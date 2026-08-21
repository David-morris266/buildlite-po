-- 015_development_prelims_items.sql
-- BL-033D.1 — Development Prelims forecast lines (TIME / LUMP_SUM).
-- Additive. No backfill. Does not alter CVR, snapshots, programme, or classification.
-- Calculated months/money are NOT stored; they are derived live.
-- Do not apply to buildlite_clone until the controlled D.1 UAT.

CREATE TABLE IF NOT EXISTS development_prelims_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id     TEXT NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  cost_code_key      TEXT NOT NULL,
  name               TEXT NOT NULL,
  forecast_driver    TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'active',
  monthly_rate       NUMERIC(14,2),
  start_basis        TEXT,
  start_fixed_date   DATE,
  end_basis          TEXT,
  end_fixed_date     DATE,
  lump_sum_amount    NUMERIC(14,2),
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         TEXT,
  updated_by         TEXT,
  CONSTRAINT chk_development_prelims_items_key
    CHECK (char_length(btrim(cost_code_key)) BETWEEN 1 AND 64),
  CONSTRAINT chk_development_prelims_items_name
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_development_prelims_items_version
    CHECK (version >= 1),
  CONSTRAINT chk_development_prelims_items_driver
    CHECK (forecast_driver IN ('TIME', 'LUMP_SUM')),
  CONSTRAINT chk_development_prelims_items_status
    CHECK (status IN ('active', 'complete', 'cancelled')),
  CONSTRAINT chk_development_prelims_items_start_basis
    CHECK (
      start_basis IS NULL
      OR start_basis IN (
        'SITE_START',
        'FIRST_COMPLETION',
        'FINAL_COMPLETION',
        'FIXED_DATE'
      )
    ),
  CONSTRAINT chk_development_prelims_items_end_basis
    CHECK (
      end_basis IS NULL
      OR end_basis IN (
        'SITE_START',
        'FIRST_COMPLETION',
        'FINAL_COMPLETION',
        'FIXED_DATE'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_development_prelims_items_development
  ON development_prelims_items (client_id, development_id);

CREATE INDEX IF NOT EXISTS idx_development_prelims_items_cost_code
  ON development_prelims_items (client_id, development_id, cost_code_key);
