// server/db.js — single Postgres pool; init aligned with production (BL-006 / 003)
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const {
  isDbConfigured,
  isServerTestMode,
  getConnectionString,
} = require("./utils/env");
const { assertTestDatabaseIsolation } = require("./utils/testDatabaseGuard");
const { parseDatabaseUrl } = require("./utils/databaseUrl");

if (isServerTestMode()) {
  assertTestDatabaseIsolation();
}

const connectionString = getConnectionString();

if (!isDbConfigured()) {
  const missingVar = isServerTestMode() ? "TEST_DATABASE_URL" : "DATABASE_URL";
  console.warn(
    `[DB] ${missingVar} not set. The API will not be able to persist data.`
  );
} else if (isServerTestMode()) {
  const target = parseDatabaseUrl(connectionString);
  console.log(
    `[DB] Server test mode using database: ${target.host}:${target.port}/${target.database}`
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
    const missingVar = isServerTestMode() ? "TEST_DATABASE_URL" : "DATABASE_URL";
    console.warn(`[DB] Skipping init because ${missingVar} is missing.`);
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

  // BL-038B — additive expected-liability columns. Test DB only via init().
  // Do not rely on this path for clone; clone is SELECT-only in this slice.
  if (isServerTestMode()) {
    const expectedLiabilitySql = fs.readFileSync(
      path.join(__dirname, "migrations", "021_commercial_event_expected_liability.sql"),
      "utf8"
    );
    await pool.query(expectedLiabilitySql);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_order_matrices (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      package_id        UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      development_id    TEXT NOT NULL REFERENCES developments(id),
      order_key         TEXT NOT NULL,
      layout            TEXT NOT NULL,
      committed_value   NUMERIC(14,2),
      payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
      version           INTEGER NOT NULL DEFAULT 1,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by        TEXT,
      updated_by        TEXT,
      CONSTRAINT chk_package_order_matrices_layout
        CHECK (layout = 'plot-stage')
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_package_order_matrices_client_package
      ON package_order_matrices (client_id, package_id);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_package_order_matrices_client_order_key
      ON package_order_matrices (client_id, order_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_package_order_matrices_client_development
      ON package_order_matrices (client_id, development_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_payment_certificates (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id                 UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      package_id                UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
      development_id            TEXT NOT NULL REFERENCES developments(id),
      order_key                 TEXT NOT NULL,
      certificate_number        INTEGER NOT NULL,
      status                    TEXT NOT NULL DEFAULT 'draft',
      certificate_date          DATE NOT NULL DEFAULT CURRENT_DATE,
      payload                   JSONB NOT NULL DEFAULT '{}'::jsonb,
      version                   INTEGER NOT NULL DEFAULT 1,
      gross_value               NUMERIC(14,2),
      net_value                 NUMERIC(14,2),
      matrix_gross              NUMERIC(14,2),
      commercial_event_gross    NUMERIC(14,2),
      recovery_signed           NUMERIC(14,2),
      retention                 NUMERIC(14,2),
      vat                       NUMERIC(14,2),
      retention_rate            NUMERIC(8,6),
      vat_rate                  NUMERIC(8,6),
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by                TEXT,
      updated_by                TEXT,
      submitted_at              TIMESTAMPTZ,
      submitted_by              TEXT,
      approved_at               TIMESTAMPTZ,
      approved_by               TEXT,
      CONSTRAINT chk_package_payment_certificates_status
        CHECK (status IN ('draft', 'submitted', 'locked')),
      CONSTRAINT chk_package_payment_certificates_number
        CHECK (certificate_number >= 1),
      CONSTRAINT chk_package_payment_certificates_version
        CHECK (version >= 1),
      CONSTRAINT chk_package_payment_certificates_payload
        CHECK (jsonb_typeof(payload) = 'object'),
      CONSTRAINT chk_package_payment_certificates_rates
        CHECK (
          (retention_rate IS NULL OR (retention_rate >= 0 AND retention_rate <= 1))
          AND (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 1))
        ),
      CONSTRAINT chk_package_payment_certificates_locked_totals
        CHECK (
          status <> 'locked'
          OR (
            gross_value IS NOT NULL
            AND net_value IS NOT NULL
            AND matrix_gross IS NOT NULL
            AND commercial_event_gross IS NOT NULL
            AND recovery_signed IS NOT NULL
            AND retention IS NOT NULL
            AND vat IS NOT NULL
            AND retention_rate IS NOT NULL
            AND vat_rate IS NOT NULL
          )
        )
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_package_payment_certificates_client_package_number
      ON package_payment_certificates (client_id, package_id, certificate_number);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_package_payment_certificates_one_open
      ON package_payment_certificates (client_id, package_id)
      WHERE status IN ('draft', 'submitted');
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_package_payment_certificates_client_package
      ON package_payment_certificates (client_id, package_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_package_payment_certificates_client_development
      ON package_payment_certificates (client_id, development_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_payment_certificate_audit (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      certificate_id    UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE CASCADE,
      action            TEXT NOT NULL,
      actor             TEXT,
      comment           TEXT NOT NULL DEFAULT '',
      prior_status      TEXT,
      new_status        TEXT,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_package_payment_certificate_audit_cert_created
      ON package_payment_certificate_audit (certificate_id, created_at);
  `);

  await pool.query(`
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
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_periods_client_development_key
      ON cvr_periods (client_id, development_id, lower(period_key));
  `);
  await pool.query(`DROP INDEX IF EXISTS uq_cvr_periods_one_draft;`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_periods_one_open
      ON cvr_periods (client_id, development_id)
      WHERE status IN ('draft', 'submitted');
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cvr_periods_client_development
      ON cvr_periods (client_id, development_id);
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cvr_period_audit_period_created
      ON cvr_period_audit (period_id, created_at);
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_cvr_cost_code_inputs_period_key
      ON cvr_cost_code_inputs (client_id, period_id, cost_code_key);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_cvr_cost_code_inputs_period
      ON cvr_cost_code_inputs (period_id);
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ledger_import_batches_client_development
      ON ledger_import_batches (client_id, development_id, imported_at DESC);
  `);
  await pool.query(`
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
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_transactions_fingerprint
      ON ledger_transactions (client_id, development_id, fingerprint);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ledger_transactions_client_development
      ON ledger_transactions (client_id, development_id, transaction_date DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ledger_transactions_batch
      ON ledger_transactions (batch_id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_ledger_transactions_cost_code
      ON ledger_transactions (client_id, development_id, cost_code_key);
  `);

  console.log("[DB] Tables ready (production-aligned baseline)");
}

module.exports = {
  pool,
  query,
  init,
  isDbConfigured,
};
