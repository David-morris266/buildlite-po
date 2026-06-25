// server/db.js — single Postgres pool; init aligned with production (BL-006 / 003)
require("dotenv").config();

const { Pool } = require("pg");
const { isDbConfigured } = require("./utils/env");

const connectionString = process.env.DATABASE_URL;

if (!isDbConfigured()) {
  console.warn(
    "[DB] DATABASE_URL not set. The API will not be able to persist data."
  );
}

const pool = new Pool({
  connectionString,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : false,
});

function query(text, params) {
  return pool.query(text, params);
}

/**
 * Fallback init when migrations have not run yet.
 * Shape matches Render production after 001 + 002 + 003_reconcile_production.
 * Does NOT create payment_certificate_lines (deprecated for new deploys).
 */
async function init() {
  if (!isDbConfigured()) {
    console.warn("[DB] Skipping init because DATABASE_URL is missing.");
    return;
  }

  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      is_active   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_brand_profiles (
      client_id         UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      legal_name        TEXT,
      trading_name      TEXT,
      company_number    TEXT,
      vat_number        TEXT,
      address_line1     TEXT,
      address_line2     TEXT,
      town              TEXT,
      county            TEXT,
      postcode          TEXT,
      phone             TEXT,
      email             TEXT,
      website           TEXT,
      pdf_footer_text   TEXT,
      logo_url          TEXT,
      accent_color      TEXT,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const brandProfileColumns = [
    "legal_name TEXT",
    "trading_name TEXT",
    "company_number TEXT",
    "vat_number TEXT",
    "address_line1 TEXT",
    "address_line2 TEXT",
    "town TEXT",
    "county TEXT",
    "postcode TEXT",
    "phone TEXT",
    "email TEXT",
    "website TEXT",
    "pdf_footer_text TEXT",
    "logo_url TEXT",
    "accent_color TEXT",
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  ];
  for (const col of brandProfileColumns) {
    await pool.query(
      `ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS ${col};`
    );
  }

  await pool.query(`
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
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      client_id    UUID REFERENCES clients(id)
    );
  `);

  await pool.query(`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      payload   JSONB NOT NULL,
      client_id UUID REFERENCES clients(id)
    );
  `);

  await pool.query(`
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      po_number TEXT PRIMARY KEY,
      payload   JSONB NOT NULL,
      client_id UUID REFERENCES clients(id)
    );
  `);

  await pool.query(`
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cost_codes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id   UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      code        TEXT NOT NULL,
      sub_heading TEXT,
      trade       TEXT,
      element     TEXT,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      UNIQUE (client_id, code)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_certificates (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id          UUID REFERENCES clients(id),
      job_id             TEXT,
      supplier_id        TEXT,
      legacy_cert_no     INTEGER NOT NULL DEFAULT 1,
      legacy_period_end  DATE,
      status             TEXT NOT NULL DEFAULT 'Draft',
      payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      certificate_number INTEGER,
      period_from        DATE,
      period_to          DATE,
      notes              TEXT,
      cert_no            INTEGER,
      period_end         DATE
    );
  `);

  const payCertColumns = [
    "legacy_cert_no INTEGER NOT NULL DEFAULT 1",
    "legacy_period_end DATE",
    "certificate_number INTEGER",
    "period_from DATE",
    "period_to DATE",
    "notes TEXT",
    "cert_no INTEGER",
    "period_end DATE",
    "payload JSONB NOT NULL DEFAULT '{}'::jsonb",
    "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
  ];
  for (const col of payCertColumns) {
    await pool.query(
      `ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS ${col};`
    );
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_client_id
      ON purchase_orders (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_suppliers_client_id
      ON suppliers (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cost_codes_client
      ON cost_codes (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cost_codes_client_active_code
      ON cost_codes (client_id, is_active, code);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_certificates_client_job_supplier
      ON payment_certificates (client_id, job_id, supplier_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_paycert_client
      ON payment_certificates (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_paycert_client_job
      ON payment_certificates (client_id, job_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ix_paycert_client_supplier
      ON payment_certificates (client_id, supplier_id);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_paycert_client_job_supplier_no
      ON payment_certificates (client_id, job_id, supplier_id, legacy_cert_no);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_jobs_client_id
      ON jobs (client_id);
  `);

  console.log("[DB] Tables ready (production-aligned baseline)");
}

module.exports = {
  pool,
  query,
  init,
  isDbConfigured,
};
