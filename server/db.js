// server/db.js — single Postgres pool; init aligned with Phase 0 migrations (Doc 20)
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
 * Fallback init for fresh deploys when migrations have not run yet.
 * Migrations (001_baseline.sql) are the source of truth.
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
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_brand_profiles (
      client_id   UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      logo_url    TEXT,
      brand       JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

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
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (client_id, code)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_certificates (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id          UUID REFERENCES clients(id),
      job_id             TEXT NOT NULL,
      supplier_id        TEXT NOT NULL,
      certificate_number INTEGER,
      period_from        DATE,
      period_to          DATE,
      status             TEXT NOT NULL DEFAULT 'Draft',
      notes              TEXT,
      payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_client_id
      ON purchase_orders (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_suppliers_client_id
      ON suppliers (client_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cost_codes_client_active_code
      ON cost_codes (client_id, is_active, code);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_payment_certificates_client_job_supplier
      ON payment_certificates (client_id, job_id, supplier_id);
  `);

  console.log("[DB] Tables ready (Phase 0 baseline)");
}

module.exports = {
  pool,
  query,
  init,
  isDbConfigured,
};
