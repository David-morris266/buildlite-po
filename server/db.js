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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS developments (
      id                TEXT PRIMARY KEY,
      client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      job_number        TEXT NOT NULL,
      development_name  TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'planning',
      payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
      version           INTEGER NOT NULL DEFAULT 1,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by        TEXT,
      updated_by        TEXT
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_developments_client_job_number
      ON developments (client_id, lower(job_number));
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_developments_client_id
      ON developments (client_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_developments_client_status
      ON developments (client_id, status);
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_packages_client_order_key
      ON packages (client_id, order_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_packages_client_development
      ON packages (client_id, development_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_packages_client_supplier
      ON packages (client_id, supplier_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_purchase_orders (
      package_id   UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      po_number    TEXT NOT NULL,
      linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (package_id, po_number)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_package_po_client_po
      ON package_purchase_orders (client_id, po_number);
  `);

  await pool.query(`
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
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_events_client_event_number
      ON commercial_events (client_id, event_number);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_events_client_development
      ON commercial_events (client_id, development_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_events_client_package
      ON commercial_events (client_id, package_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_events_client_order_key
      ON commercial_events (client_id, order_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_events_client_status
      ON commercial_events (client_id, status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_events_linked_event
      ON commercial_events (linked_event_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS commercial_event_audit (
      id                        TEXT PRIMARY KEY,
      client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      commercial_event_id       TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE CASCADE,
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_commercial_event_audit_event_created
      ON commercial_event_audit (commercial_event_id, created_at);
  `);

  console.log("[DB] Tables ready (production-aligned baseline)");
}

module.exports = {
  pool,
  query,
  init,
  isDbConfigured,
};
