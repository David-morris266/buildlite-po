-- 002_tenant_keys.sql
-- Phase 0 conditional: run ONLY after Doc 20 §8.7 and §8.8 return zero rows.
-- Adds tenant-scoping on jobs and composite uniqueness without dropping global PKs.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- Backfill jobs.client_id from the active client (single-tenant assumption).
UPDATE jobs j
SET client_id = c.id
FROM clients c
WHERE j.client_id IS NULL
  AND c.is_active = true;

-- Composite uniqueness (additive — keeps existing PRIMARY KEY on po_number / suppliers.id)
CREATE UNIQUE INDEX IF NOT EXISTS uq_purchase_orders_client_po_number
  ON purchase_orders (client_id, po_number)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_suppliers_client_id
  ON suppliers (client_id, id)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_client_id
  ON jobs (client_id);
