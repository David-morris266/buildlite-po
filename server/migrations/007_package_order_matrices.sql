-- 007_package_order_matrices.sql
-- BL-029A — Server-backed plot-stage Order Matrix (one current matrix per package)

CREATE TABLE IF NOT EXISTS package_order_matrices (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id        UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  development_id    TEXT NOT NULL REFERENCES developments(id),
  order_key         TEXT NOT NULL,
  layout            TEXT NOT NULL,
  committed_value   NUMERIC(14,2),
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_by        TEXT,
  CONSTRAINT chk_package_order_matrices_layout
    CHECK (layout = 'plot-stage')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_order_matrices_client_package
  ON package_order_matrices (client_id, package_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_order_matrices_client_order_key
  ON package_order_matrices (client_id, order_key);

CREATE INDEX IF NOT EXISTS idx_package_order_matrices_client_development
  ON package_order_matrices (client_id, development_id);
