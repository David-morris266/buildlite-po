-- 013_cost_code_classifications.sql
-- BL-033B — Tenant-level BuildLite semantic classification for client cost codes.
-- Additive. No backfill. Does not rewrite PO/CE/certificate/ledger/CVR data.
-- Unmapped codes are NOT stored: they resolve as UNCLASSIFIED + STANDARD_CVR.
-- OTHER is an explicit classification only. Do not apply to buildlite_clone
-- until the controlled classification UAT.

CREATE TABLE IF NOT EXISTS cost_code_classifications (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  cost_code_key      TEXT NOT NULL,
  semantic_group     TEXT NOT NULL,
  forecast_driver    TEXT NOT NULL DEFAULT 'STANDARD_CVR',
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         TEXT,
  updated_by         TEXT,
  CONSTRAINT uq_cost_code_classifications_client_key
    UNIQUE (client_id, cost_code_key),
  CONSTRAINT chk_cost_code_classifications_key
    CHECK (char_length(btrim(cost_code_key)) BETWEEN 1 AND 64),
  CONSTRAINT chk_cost_code_classifications_version
    CHECK (version >= 1),
  CONSTRAINT chk_cost_code_classifications_group
    CHECK (
      semantic_group IN (
        'LAND',
        'FEES',
        'INFRASTRUCTURE',
        'BUILD',
        'PRELIMS',
        'SELLING',
        'OTHER'
      )
    ),
  CONSTRAINT chk_cost_code_classifications_driver
    CHECK (
      forecast_driver IN (
        'STANDARD_CVR',
        'TIME',
        'LUMP_SUM',
        'QUANTITY',
        'MILESTONE',
        'PERCENTAGE',
        'MANUAL'
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_code_classifications_client_key_lower
  ON cost_code_classifications (client_id, lower(cost_code_key));

CREATE INDEX IF NOT EXISTS idx_cost_code_classifications_client
  ON cost_code_classifications (client_id);
