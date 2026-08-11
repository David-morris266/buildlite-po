-- 005_packages.sql
-- BL-027B.1 — Server-backed Package identity/membership (orderKey + UUID package id)

CREATE TABLE IF NOT EXISTS packages (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id      TEXT NOT NULL REFERENCES developments(id),
  supplier_id         TEXT NOT NULL,
  cost_code           TEXT NOT NULL,
  order_key           TEXT NOT NULL,
  supplier_label      TEXT,
  development_number  TEXT,
  development_name    TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  version             INTEGER NOT NULL DEFAULT 1,
  materialised_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          TEXT,
  updated_by          TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_client_order_key
  ON packages (client_id, order_key);

CREATE INDEX IF NOT EXISTS idx_packages_client_development
  ON packages (client_id, development_id);

CREATE INDEX IF NOT EXISTS idx_packages_client_supplier
  ON packages (client_id, supplier_id);

CREATE TABLE IF NOT EXISTS package_purchase_orders (
  package_id   UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  po_number    TEXT NOT NULL,
  linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (package_id, po_number)
);

CREATE INDEX IF NOT EXISTS idx_package_po_client_po
  ON package_purchase_orders (client_id, po_number);
