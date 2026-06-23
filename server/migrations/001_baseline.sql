-- 001_baseline.sql
-- Phase 0: additive baseline alignment (Doc 20 / Doc 22 Track A)
-- Safe to re-run: uses IF NOT EXISTS / IF NOT EXISTS columns throughout.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- schema_migrations (also ensured by migrate.js)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL UNIQUE,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_is_active
  ON clients (is_active)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- client_brand_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_brand_profiles (
  client_id   UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  logo_url    TEXT,
  brand       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
  id           SERIAL PRIMARY KEY,
  job_code     TEXT,
  job_number   TEXT,
  name         TEXT,
  site_address TEXT,
  site_manager TEXT,
  site_phone   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- suppliers (JSON payload model — Phase 3A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  payload   JSONB NOT NULL,
  client_id UUID REFERENCES clients(id)
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- ---------------------------------------------------------------------------
-- purchase_orders (JSON payload model — Phase 3A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  po_number TEXT PRIMARY KEY,
  payload   JSONB NOT NULL,
  client_id UUID REFERENCES clients(id)
);

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);

-- ---------------------------------------------------------------------------
-- cost_codes
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  sub_heading TEXT,
  trade       TEXT,
  element     TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, code)
);

-- ---------------------------------------------------------------------------
-- payment_certificates (production hybrid model — Doc 20 Appendix A)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_certificates (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID REFERENCES clients(id),
  job_id               TEXT NOT NULL,
  supplier_id          TEXT NOT NULL,
  certificate_number   INTEGER,
  period_from          DATE,
  period_to            DATE,
  status               TEXT NOT NULL DEFAULT 'Draft',
  notes                TEXT,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS certificate_number INTEGER;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS period_from DATE;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS period_to DATE;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy column aliases from older code paths (additive only)
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS cert_no INTEGER;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS period_end DATE;

-- Sync legacy -> canonical where present
UPDATE payment_certificates
SET certificate_number = cert_no
WHERE certificate_number IS NULL AND cert_no IS NOT NULL;

UPDATE payment_certificates
SET period_to = period_end
WHERE period_to IS NULL AND period_end IS NOT NULL;

-- ---------------------------------------------------------------------------
-- indexes (Doc 20 §5.3)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_purchase_orders_client_id
  ON purchase_orders (client_id);

CREATE INDEX IF NOT EXISTS idx_suppliers_client_id
  ON suppliers (client_id);

CREATE INDEX IF NOT EXISTS idx_cost_codes_client_active_code
  ON cost_codes (client_id, is_active, code);

CREATE INDEX IF NOT EXISTS idx_payment_certificates_client_job_supplier
  ON payment_certificates (client_id, job_id, supplier_id);
