-- 009_cvr_and_purchase_ledger.sql
-- BL-031A — CVR periods, QS cost-code inputs, purchase ledger batches/transactions
-- Server persistence/API foundation only. No snapshots (BL-031E). No client cutover.

CREATE TABLE IF NOT EXISTS cvr_periods (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id    TEXT NOT NULL REFERENCES developments(id),
  period_key        TEXT NOT NULL,
  period_label      TEXT NOT NULL,
  reporting_month   DATE,
  status            TEXT NOT NULL DEFAULT 'draft',
  commentary        JSONB NOT NULL DEFAULT '{}'::jsonb,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_by        TEXT,
  submitted_at      TIMESTAMPTZ,
  submitted_by      TEXT,
  approved_at       TIMESTAMPTZ,
  approved_by       TEXT,
  CONSTRAINT chk_cvr_periods_status
    CHECK (status IN ('draft', 'submitted', 'locked')),
  CONSTRAINT chk_cvr_periods_version
    CHECK (version >= 1),
  CONSTRAINT chk_cvr_periods_key
    CHECK (char_length(btrim(period_key)) BETWEEN 1 AND 32),
  CONSTRAINT chk_cvr_periods_commentary
    CHECK (jsonb_typeof(commentary) = 'object'),
  CONSTRAINT chk_cvr_periods_workflow_timestamps
    CHECK (
      (
        status = 'draft'
        AND submitted_at IS NULL
        AND submitted_by IS NULL
        AND approved_at IS NULL
        AND approved_by IS NULL
      )
      OR (
        status = 'submitted'
        AND submitted_at IS NOT NULL
        AND approved_at IS NULL
        AND approved_by IS NULL
      )
      OR (
        status = 'locked'
        AND submitted_at IS NOT NULL
        AND approved_at IS NOT NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_periods_client_development_key
  ON cvr_periods (client_id, development_id, lower(period_key));

DROP INDEX IF EXISTS uq_cvr_periods_one_draft;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_periods_one_open
  ON cvr_periods (client_id, development_id)
  WHERE status IN ('draft', 'submitted');

CREATE INDEX IF NOT EXISTS idx_cvr_periods_client_development
  ON cvr_periods (client_id, development_id);

CREATE TABLE IF NOT EXISTS cvr_period_audit (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_id         UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE CASCADE,
  action            TEXT NOT NULL,
  actor             TEXT,
  comment           TEXT NOT NULL DEFAULT '',
  prior_status      TEXT,
  new_status        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cvr_period_audit_period_created
  ON cvr_period_audit (period_id, created_at);

CREATE TABLE IF NOT EXISTS cvr_cost_code_inputs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  period_id               UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE CASCADE,
  cost_code_key           TEXT NOT NULL,
  cost_code_label         TEXT NOT NULL,
  description             TEXT NOT NULL DEFAULT '',
  commercial_head         TEXT NOT NULL DEFAULT '',
  commercial_family       TEXT NOT NULL DEFAULT '',
  trade                   TEXT NOT NULL DEFAULT '',
  original_budget         NUMERIC(14,2),
  current_budget          NUMERIC(14,2),
  commercial_adjustment   NUMERIC(14,2) NOT NULL DEFAULT 0,
  adjustment_reason       TEXT NOT NULL DEFAULT '',
  manual_accrual          NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes                   TEXT NOT NULL DEFAULT '',
  active                  BOOLEAN NOT NULL DEFAULT true,
  display_metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  version                 INTEGER NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by              TEXT,
  updated_by              TEXT,
  CONSTRAINT chk_cvr_cost_code_inputs_version
    CHECK (version >= 1),
  CONSTRAINT chk_cvr_cost_code_inputs_key
    CHECK (char_length(btrim(cost_code_key)) BETWEEN 1 AND 64),
  CONSTRAINT chk_cvr_cost_code_inputs_metadata
    CHECK (jsonb_typeof(display_metadata) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_cost_code_inputs_period_key
  ON cvr_cost_code_inputs (client_id, period_id, cost_code_key);

CREATE INDEX IF NOT EXISTS idx_cvr_cost_code_inputs_period
  ON cvr_cost_code_inputs (period_id);

CREATE TABLE IF NOT EXISTS ledger_import_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id      TEXT NOT NULL REFERENCES developments(id),
  original_file_name  TEXT NOT NULL DEFAULT '',
  source_profile      TEXT NOT NULL DEFAULT '',
  rows_imported       INTEGER NOT NULL DEFAULT 0,
  rows_rejected       INTEGER NOT NULL DEFAULT 0,
  total_net           NUMERIC(14,2) NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_by         TEXT,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ledger_import_batches_counts
    CHECK (rows_imported >= 0 AND rows_rejected >= 0),
  CONSTRAINT chk_ledger_import_batches_metadata
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_ledger_import_batches_client_development
  ON ledger_import_batches (client_id, development_id, imported_at DESC);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id    TEXT NOT NULL REFERENCES developments(id),
  batch_id          UUID REFERENCES ledger_import_batches(id),
  supplier          TEXT NOT NULL,
  supplier_code     TEXT NOT NULL DEFAULT '',
  cost_code_key     TEXT NOT NULL,
  transaction_date  DATE NOT NULL,
  invoice_number    TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  net_amount        NUMERIC(14,2) NOT NULL,
  vat_amount        NUMERIC(14,2),
  gross_amount      NUMERIC(14,2),
  source            TEXT NOT NULL DEFAULT '',
  document_type     TEXT NOT NULL DEFAULT '',
  reference         TEXT NOT NULL DEFAULT '',
  fingerprint       TEXT NOT NULL,
  reverses_id       UUID REFERENCES ledger_transactions(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  CONSTRAINT chk_ledger_transactions_fingerprint
    CHECK (char_length(btrim(fingerprint)) BETWEEN 1 AND 128),
  CONSTRAINT chk_ledger_transactions_cost_code
    CHECK (char_length(btrim(cost_code_key)) BETWEEN 1 AND 64),
  CONSTRAINT chk_ledger_transactions_supplier
    CHECK (char_length(btrim(supplier)) BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_fingerprint
  ON ledger_transactions (client_id, development_id, fingerprint);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_client_development
  ON ledger_transactions (client_id, development_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_batch
  ON ledger_transactions (batch_id);

CREATE INDEX IF NOT EXISTS idx_ledger_transactions_cost_code
  ON ledger_transactions (client_id, development_id, cost_code_key);
