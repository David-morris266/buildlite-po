-- 016_client_prelims_templates.sql
-- BL-033D.x.1 — Tenant-owned company Prelims templates (additive).
-- Multiple named templates per client. At most one default per client.
-- Does not alter CVR, snapshots, programme, classification, or development_prelims_items.
-- Do not apply to buildlite_clone until controlled D.x.1 UAT.

CREATE TABLE IF NOT EXISTS client_prelims_templates (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name                     TEXT NOT NULL,
  origin                   TEXT NOT NULL,
  source_standard_version  INTEGER,
  is_default               BOOLEAN NOT NULL DEFAULT false,
  version                  INTEGER NOT NULL DEFAULT 1,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               TEXT,
  updated_by               TEXT,
  CONSTRAINT chk_client_prelims_templates_name
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_client_prelims_templates_origin
    CHECK (origin IN ('buildlite_standard', 'blank')),
  CONSTRAINT chk_client_prelims_templates_version
    CHECK (version >= 1),
  CONSTRAINT chk_client_prelims_templates_standard_version
    CHECK (
      source_standard_version IS NULL
      OR source_standard_version >= 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_prelims_templates_client_name
  ON client_prelims_templates (client_id, lower(btrim(name)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_prelims_templates_one_default
  ON client_prelims_templates (client_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_client_prelims_templates_client
  ON client_prelims_templates (client_id);

CREATE TABLE IF NOT EXISTS client_prelims_template_lines (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id        UUID NOT NULL REFERENCES client_prelims_templates(id) ON DELETE CASCADE,
  template_key       TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT,
  category           TEXT,
  cost_code_key      TEXT,
  forecast_driver    TEXT NOT NULL,
  start_basis        TEXT,
  end_basis          TEXT,
  monthly_rate       NUMERIC(14,2),
  lump_sum_amount    NUMERIC(14,2),
  display_order      INTEGER NOT NULL DEFAULT 0,
  enabled            BOOLEAN NOT NULL DEFAULT true,
  version            INTEGER NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by         TEXT,
  updated_by         TEXT,
  CONSTRAINT chk_client_prelims_template_lines_key
    CHECK (char_length(btrim(template_key)) BETWEEN 1 AND 80),
  CONSTRAINT chk_client_prelims_template_lines_name
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT chk_client_prelims_template_lines_cost_code
    CHECK (
      cost_code_key IS NULL
      OR char_length(btrim(cost_code_key)) BETWEEN 1 AND 64
    ),
  CONSTRAINT chk_client_prelims_template_lines_driver
    CHECK (forecast_driver IN ('TIME', 'LUMP_SUM')),
  CONSTRAINT chk_client_prelims_template_lines_start_basis
    CHECK (
      start_basis IS NULL
      OR start_basis IN ('SITE_START', 'FIRST_COMPLETION', 'FINAL_COMPLETION')
    ),
  CONSTRAINT chk_client_prelims_template_lines_end_basis
    CHECK (
      end_basis IS NULL
      OR end_basis IN ('SITE_START', 'FIRST_COMPLETION', 'FINAL_COMPLETION')
    ),
  CONSTRAINT chk_client_prelims_template_lines_version
    CHECK (version >= 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_client_prelims_template_lines_key
  ON client_prelims_template_lines (template_id, template_key);

CREATE INDEX IF NOT EXISTS idx_client_prelims_template_lines_template
  ON client_prelims_template_lines (client_id, template_id);

CREATE INDEX IF NOT EXISTS idx_client_prelims_template_lines_cost_code
  ON client_prelims_template_lines (client_id, template_id, cost_code_key);
