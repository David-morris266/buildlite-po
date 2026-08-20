-- 011_development_revenue_settings.sql
-- BL-032A — Development-scoped revenue strategy/settings (additive).
-- Does not alter CVR snapshots, periods, or live commercial facts.
-- Does not backfill locked P01/P02. Do not apply to buildlite_clone in this slice.

CREATE TABLE IF NOT EXISTS development_revenue_settings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id          TEXT NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  recognition_policy      TEXT NOT NULL DEFAULT 'completion',
  strategy                JSONB NOT NULL DEFAULT '{}'::jsonb,
  house_type_pricing      JSONB NOT NULL DEFAULT '{}'::jsonb,
  revenue_adjustments     JSONB NOT NULL DEFAULT '[]'::jsonb,
  recognition_settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT,
  updated_by              TEXT,
  CONSTRAINT uq_development_revenue_settings_client_development
    UNIQUE (client_id, development_id),
  CONSTRAINT chk_development_revenue_settings_policy
    CHECK (recognition_policy IN ('completion', 'exchange')),
  CONSTRAINT chk_development_revenue_settings_version
    CHECK (version >= 1),
  CONSTRAINT chk_development_revenue_settings_strategy
    CHECK (jsonb_typeof(strategy) = 'object' AND jsonb_typeof(strategy) <> 'array'),
  CONSTRAINT chk_development_revenue_settings_house_types
    CHECK (jsonb_typeof(house_type_pricing) = 'object' AND jsonb_typeof(house_type_pricing) <> 'array'),
  CONSTRAINT chk_development_revenue_settings_adjustments
    CHECK (jsonb_typeof(revenue_adjustments) = 'array'),
  CONSTRAINT chk_development_revenue_settings_recognition_settings
    CHECK (jsonb_typeof(recognition_settings) = 'object' AND jsonb_typeof(recognition_settings) <> 'array')
);

CREATE INDEX IF NOT EXISTS idx_development_revenue_settings_client_development
  ON development_revenue_settings (client_id, development_id);

-- One settings row per development (development_id is already globally unique).
CREATE UNIQUE INDEX IF NOT EXISTS uq_development_revenue_settings_development_id
  ON development_revenue_settings (development_id);
