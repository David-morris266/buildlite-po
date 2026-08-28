-- 023_variation_orders.sql
-- Variation Order domain/persistence foundation. Additive only; no backfill.

CREATE TABLE IF NOT EXISTS variation_order_number_sequences (
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  package_id      UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  next_number     INTEGER NOT NULL DEFAULT 1 CHECK (next_number > 0),
  PRIMARY KEY (client_id, package_id)
);

CREATE TABLE IF NOT EXISTS variation_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id        TEXT NOT NULL REFERENCES developments(id),
  package_id            UUID NOT NULL REFERENCES packages(id),
  order_key             TEXT NOT NULL,
  source_po_number      TEXT NOT NULL,
  supplier_id           TEXT NOT NULL,
  variation_order_number TEXT NOT NULL,
  reference             TEXT NOT NULL DEFAULT '',
  description           TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'issued', 'rejected')),
  vat_treatment         TEXT NOT NULL DEFAULT 'inherit'
    CHECK (vat_treatment IN ('inherit', 'standard', 'zeroRated', 'exempt', 'outsideScope')),
  retention_treatment   TEXT NOT NULL DEFAULT 'inherit'
    CHECK (retention_treatment IN ('inherit', 'applicable', 'notApplicable')),
  terms_override        JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_at           TIMESTAMPTZ,
  approved_by           TEXT,
  issued_at             TIMESTAMPTZ,
  issued_by             TEXT,
  document_id           TEXT,
  document_reference    TEXT,
  supersedes_id         UUID REFERENCES variation_orders(id) DEFERRABLE INITIALLY DEFERRED,
  reverses_id           UUID REFERENCES variation_orders(id) DEFERRABLE INITIALLY DEFERRED,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT,
  updated_by            TEXT,
  CHECK (supersedes_id IS NULL OR reverses_id IS NULL),
  CHECK ((status IN ('approved', 'issued')) = (approved_at IS NOT NULL)),
  CHECK ((status = 'issued') = (issued_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_variation_orders_client_package_number
  ON variation_orders (client_id, package_id, lower(variation_order_number));
CREATE INDEX IF NOT EXISTS idx_variation_orders_client_package
  ON variation_orders (client_id, package_id, created_at);
CREATE INDEX IF NOT EXISTS idx_variation_orders_client_development
  ON variation_orders (client_id, development_id);

CREATE TABLE IF NOT EXISTS variation_order_lines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  variation_order_id  UUID NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  line_number         INTEGER NOT NULL CHECK (line_number > 0),
  cost_code           TEXT NOT NULL,
  description         TEXT NOT NULL,
  net_value           NUMERIC(14,2) NOT NULL,
  vat_treatment       TEXT NOT NULL DEFAULT 'inherit'
    CHECK (vat_treatment IN ('inherit', 'standard', 'zeroRated', 'exempt', 'outsideScope')),
  retention_treatment TEXT NOT NULL DEFAULT 'inherit'
    CHECK (retention_treatment IN ('inherit', 'applicable', 'notApplicable')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (variation_order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_variation_order_lines_vo
  ON variation_order_lines (client_id, variation_order_id, line_number);

CREATE TABLE IF NOT EXISTS variation_order_commercial_events (
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  variation_order_id    UUID NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  commercial_event_id   TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE RESTRICT,
  allocated_value       NUMERIC(14,2),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (variation_order_id, commercial_event_id)
);

CREATE INDEX IF NOT EXISTS idx_variation_order_ce_event
  ON variation_order_commercial_events (client_id, commercial_event_id);

CREATE TABLE IF NOT EXISTS variation_order_audit (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  variation_order_id    UUID NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  action                TEXT NOT NULL,
  actor                 TEXT,
  comment               TEXT NOT NULL DEFAULT '',
  prior_status          TEXT,
  new_status            TEXT,
  prior_version         INTEGER,
  new_version           INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variation_order_audit_vo_created
  ON variation_order_audit (variation_order_id, created_at, id);
