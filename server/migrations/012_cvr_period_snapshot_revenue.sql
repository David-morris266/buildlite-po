-- 012_cvr_period_snapshot_revenue.sql
-- BL-032D — Whole-CVR Revenue-bearing snapshot (additive).
-- Does not backfill locked schema-v1 snapshots.
-- Does not write £0 into historic Revenue columns.
-- Do not apply to buildlite_clone until the controlled clone step.

ALTER TABLE cvr_period_snapshots
  ADD COLUMN IF NOT EXISTS forecast_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS secured_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS remaining_forecast_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS plots_sold INTEGER,
  ADD COLUMN IF NOT EXISTS plots_remaining INTEGER,
  ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS gross_margin_percent NUMERIC(8,4),
  ADD COLUMN IF NOT EXISTS revenue_assumptions JSONB,
  ADD COLUMN IF NOT EXISTS revenue_settings_id UUID,
  ADD COLUMN IF NOT EXISTS revenue_settings_version INTEGER;

ALTER TABLE cvr_period_snapshots
  DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_revenue_presence;

ALTER TABLE cvr_period_snapshots
  ADD CONSTRAINT chk_cvr_snapshot_revenue_presence CHECK (
    (
      schema_version = 1
      AND forecast_revenue IS NULL
      AND secured_revenue IS NULL
      AND remaining_forecast_revenue IS NULL
      AND plots_sold IS NULL
      AND plots_remaining IS NULL
      AND gross_profit IS NULL
      AND gross_margin_percent IS NULL
    )
    OR (
      schema_version >= 2
      AND forecast_revenue IS NOT NULL
      AND secured_revenue IS NOT NULL
      AND remaining_forecast_revenue IS NOT NULL
      AND plots_sold IS NOT NULL
      AND plots_remaining IS NOT NULL
      AND gross_profit IS NOT NULL
    )
  );

ALTER TABLE cvr_period_snapshots
  DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_revenue_assumptions;

ALTER TABLE cvr_period_snapshots
  ADD CONSTRAINT chk_cvr_snapshot_revenue_assumptions CHECK (
    revenue_assumptions IS NULL
    OR jsonb_typeof(revenue_assumptions) = 'object'
  );

ALTER TABLE cvr_period_snapshots
  DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_revenue_settings_version;

ALTER TABLE cvr_period_snapshots
  ADD CONSTRAINT chk_cvr_snapshot_revenue_settings_version CHECK (
    revenue_settings_version IS NULL OR revenue_settings_version >= 1
  );

CREATE TABLE IF NOT EXISTS cvr_period_snapshot_plots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_id                 UUID NOT NULL REFERENCES cvr_period_snapshots(id) ON DELETE CASCADE,
  plot_id                     TEXT NOT NULL,
  plot_number                 TEXT NOT NULL DEFAULT '',
  house_type                  TEXT NOT NULL DEFAULT '',
  tenure                      TEXT NOT NULL DEFAULT '',
  revenue_category            TEXT NOT NULL DEFAULT '',
  revenue_status              TEXT NOT NULL DEFAULT '',
  revenue_source              TEXT NOT NULL DEFAULT '',
  forecast_revenue            NUMERIC(14,2) NOT NULL DEFAULT 0,
  secured_revenue             NUMERIC(14,2) NOT NULL DEFAULT 0,
  remaining_forecast_revenue  NUMERIC(14,2) NOT NULL DEFAULT 0,
  selling_price               NUMERIC(14,2),
  derived_forecast            NUMERIC(14,2) NOT NULL DEFAULT 0,
  plot_premium                NUMERIC(14,2) NOT NULL DEFAULT 0,
  nia_ft2                     NUMERIC(14,2) NOT NULL DEFAULT 0,
  effective_garage            TEXT NOT NULL DEFAULT 'None',
  reserved_at                 DATE,
  exchanged_at                DATE,
  completed_at                DATE,
  display_metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_cvr_period_snapshot_plots_snapshot_plot
    UNIQUE (snapshot_id, plot_id),
  CONSTRAINT chk_cvr_period_snapshot_plots_plot_id
    CHECK (char_length(btrim(plot_id)) BETWEEN 1 AND 128),
  CONSTRAINT chk_cvr_period_snapshot_plots_metadata
    CHECK (jsonb_typeof(display_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshot_plots_snapshot
  ON cvr_period_snapshot_plots (snapshot_id);

CREATE INDEX IF NOT EXISTS idx_cvr_period_snapshot_plots_client
  ON cvr_period_snapshot_plots (client_id, plot_id);
