-- 020_development_selling_costs_settings.sql
-- BL-034B — Development-scoped Simple Selling Costs assumption settings (additive).
-- Percentage is authoritative; calculated £ is never persisted as authority.
-- Does not write CVR inputs, snapshots, or periods.
-- Do not apply to buildlite_clone until controlled UAT approval.

CREATE TABLE IF NOT EXISTS development_selling_costs_settings (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id              TEXT NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  mode                        TEXT NOT NULL DEFAULT 'simple',
  assumption_percent          NUMERIC(12, 4) NOT NULL,
  destination_cost_code_key   TEXT,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_by                  TEXT,
  CONSTRAINT uq_development_selling_costs_settings_client_development
    UNIQUE (client_id, development_id),
  CONSTRAINT chk_development_selling_costs_settings_mode
    CHECK (mode IN ('simple', 'detailed')),
  CONSTRAINT chk_development_selling_costs_settings_version
    CHECK (version >= 1),
  CONSTRAINT chk_development_selling_costs_settings_percent
    CHECK (assumption_percent >= 0 AND assumption_percent <= 1000),
  CONSTRAINT chk_development_selling_costs_settings_destination
    CHECK (
      destination_cost_code_key IS NULL
      OR (
        char_length(btrim(destination_cost_code_key)) BETWEEN 1 AND 64
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_development_selling_costs_settings_client_development
  ON development_selling_costs_settings (client_id, development_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_development_selling_costs_settings_development_id
  ON development_selling_costs_settings (development_id);
