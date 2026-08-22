-- 017_cost_codes_tenant_master.sql
-- BL-033D.x.2A.1 — Evolve existing cost_codes into the tenant Cost Code Master.
-- Additive. Does not backfill Admin/browser master data.
-- Does not copy element into description.
-- Does not alter PO/CE/package/CVR/snapshot/ledger/classification/Prelims/template rows.
-- Do not apply to buildlite_clone until controlled x.2A.3 UAT.

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS commercial_head TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS commercial_family TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS reporting_group TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS hierarchy_mode TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS reporting_order INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS default_vat_treatment TEXT NOT NULL DEFAULT 'Standard';

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS default_order_type TEXT NOT NULL DEFAULT 'S';

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS allow_budget BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS allow_purchase_orders BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS allow_ledger_import BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS allow_forecast_adjustment BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS import_metadata JSONB;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS created_by TEXT;

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE cost_codes
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

ALTER TABLE cost_codes DROP CONSTRAINT IF EXISTS chk_cost_codes_code_len;
ALTER TABLE cost_codes
  ADD CONSTRAINT chk_cost_codes_code_len
  CHECK (char_length(btrim(code)) BETWEEN 1 AND 64);

ALTER TABLE cost_codes DROP CONSTRAINT IF EXISTS chk_cost_codes_version;
ALTER TABLE cost_codes
  ADD CONSTRAINT chk_cost_codes_version
  CHECK (version >= 1);

ALTER TABLE cost_codes DROP CONSTRAINT IF EXISTS chk_cost_codes_hierarchy_mode;
ALTER TABLE cost_codes
  ADD CONSTRAINT chk_cost_codes_hierarchy_mode
  CHECK (
    hierarchy_mode IS NULL
    OR hierarchy_mode IN ('two-level', 'three-level', 'three-level-default-family')
  );

ALTER TABLE cost_codes DROP CONSTRAINT IF EXISTS chk_cost_codes_vat;
ALTER TABLE cost_codes
  ADD CONSTRAINT chk_cost_codes_vat
  CHECK (default_vat_treatment IN ('Standard', 'Zero Rated', 'Reverse Charge'));

ALTER TABLE cost_codes DROP CONSTRAINT IF EXISTS chk_cost_codes_order_type;
ALTER TABLE cost_codes
  ADD CONSTRAINT chk_cost_codes_order_type
  CHECK (default_order_type IN ('M', 'S', 'P'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cost_codes_client_code_lower
  ON cost_codes (client_id, lower(btrim(code)));
