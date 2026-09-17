-- GP-6A.1 — server-authoritative Summary Revenue mode.
-- Additive: existing settings remain Sales Register; historic snapshots are not backfilled.

ALTER TABLE development_revenue_settings
  ADD COLUMN revenue_mode TEXT NOT NULL DEFAULT 'sales_register',
  ADD COLUMN summary_revenue_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  ADD COLUMN updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  ADD COLUMN updated_by_provider_user_id TEXT,
  ADD CONSTRAINT chk_development_revenue_settings_mode
    CHECK (revenue_mode IN ('sales_register', 'summary')),
  ADD CONSTRAINT chk_development_revenue_settings_summary_lines
    CHECK (jsonb_typeof(summary_revenue_lines) = 'array');

ALTER TABLE cvr_period_snapshots DROP CONSTRAINT IF EXISTS chk_cvr_snapshot_revenue_presence;
ALTER TABLE cvr_period_snapshots ADD CONSTRAINT chk_cvr_snapshot_revenue_presence CHECK (
  (schema_version = 1 AND forecast_revenue IS NULL AND secured_revenue IS NULL
    AND remaining_forecast_revenue IS NULL AND plots_sold IS NULL AND plots_remaining IS NULL
    AND gross_profit IS NULL AND gross_margin_percent IS NULL)
  OR
  (schema_version >= 2 AND forecast_revenue IS NOT NULL AND gross_profit IS NOT NULL AND (
    (COALESCE(revenue_assumptions->>'revenueMode','sales_register') = 'sales_register'
      AND secured_revenue IS NOT NULL AND remaining_forecast_revenue IS NOT NULL
      AND plots_sold IS NOT NULL AND plots_remaining IS NOT NULL)
    OR
    (revenue_assumptions->>'revenueMode' = 'summary'
      AND secured_revenue IS NULL AND remaining_forecast_revenue IS NULL
      AND plots_sold IS NULL AND plots_remaining IS NULL)
  ))
);

INSERT INTO permissions(key, description)
VALUES ('revenue.manage', 'Manage development Revenue authority')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'revenue.manage' FROM roles
WHERE key IN ('qs','commercial_manager','commercial_director','admin')
ON CONFLICT DO NOTHING;
