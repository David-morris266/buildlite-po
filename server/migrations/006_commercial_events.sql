-- 006_commercial_events.sql
-- BL-028A — Server-backed Commercial Events (workflow + audit)

CREATE TABLE IF NOT EXISTS commercial_events (
  id                          TEXT PRIMARY KEY,
  client_id                   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id              TEXT NOT NULL REFERENCES developments(id),
  package_id                  UUID NOT NULL REFERENCES packages(id),
  order_key                   TEXT NOT NULL,
  event_number                TEXT NOT NULL,
  event_type                  TEXT NOT NULL,
  category                    TEXT NOT NULL,
  subcategory                 TEXT NOT NULL DEFAULT '',
  responsibility              TEXT NOT NULL,
  description                 TEXT NOT NULL,
  value                       NUMERIC(14,2) NOT NULL,
  financial_treatment         TEXT,
  vat_treatment               TEXT NOT NULL DEFAULT 'standard',
  date_raised                 DATE,
  raised_by                   TEXT,
  status                      TEXT NOT NULL DEFAULT 'draft',
  linked_event_id             TEXT,
  recovery_package_id         TEXT,
  potential_contra_charge     BOOLEAN NOT NULL DEFAULT false,
  potential_contra_charge_notes TEXT NOT NULL DEFAULT '',
  relationship_type           TEXT,
  recovered_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  certificate_status          TEXT NOT NULL DEFAULT 'notIncluded',
  recovery_status             TEXT NOT NULL DEFAULT 'notApplicable',
  po_number                   TEXT NOT NULL DEFAULT '',
  supplier_id                 TEXT NOT NULL DEFAULT '',
  cost_code                   TEXT NOT NULL DEFAULT '',
  payload                     JSONB NOT NULL DEFAULT '{}'::jsonb,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by                  TEXT,
  updated_by                  TEXT,
  CONSTRAINT fk_commercial_events_linked_event
    FOREIGN KEY (linked_event_id)
    REFERENCES commercial_events(id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_events_client_event_number
  ON commercial_events (client_id, event_number);

CREATE INDEX IF NOT EXISTS idx_commercial_events_client_development
  ON commercial_events (client_id, development_id);

CREATE INDEX IF NOT EXISTS idx_commercial_events_client_package
  ON commercial_events (client_id, package_id);

CREATE INDEX IF NOT EXISTS idx_commercial_events_client_order_key
  ON commercial_events (client_id, order_key);

CREATE INDEX IF NOT EXISTS idx_commercial_events_client_status
  ON commercial_events (client_id, status);

CREATE INDEX IF NOT EXISTS idx_commercial_events_linked_event
  ON commercial_events (linked_event_id);

CREATE TABLE IF NOT EXISTS commercial_event_audit (
  id                        TEXT PRIMARY KEY,
  client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  commercial_event_id     TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,
  action                    TEXT NOT NULL,
  actor                     TEXT,
  comment                   TEXT NOT NULL DEFAULT '',
  prior_status              TEXT,
  new_status                TEXT,
  prior_recovery_status     TEXT,
  new_recovery_status       TEXT,
  prior_certificate_status  TEXT,
  new_certificate_status    TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_event_audit_event_created
  ON commercial_event_audit (commercial_event_id, created_at);
