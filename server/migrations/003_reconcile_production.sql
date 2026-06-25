-- 003_reconcile_production.sql
-- BL-006: Align schema with Render production (additive only).
-- Production clone is source of truth. Safe to re-run.

-- ---------------------------------------------------------------------------
-- client_brand_profiles — production flat columns (001 may have created JSONB shape)
-- ---------------------------------------------------------------------------
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS trading_name TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS company_number TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS address_line1 TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS address_line2 TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS town TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS county TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS postcode TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS pdf_footer_text TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS accent_color TEXT;
ALTER TABLE client_brand_profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ---------------------------------------------------------------------------
-- payment_certificates — production legacy numbering columns
-- ---------------------------------------------------------------------------
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS legacy_cert_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_certificates ADD COLUMN IF NOT EXISTS legacy_period_end DATE;

-- Sync canonical / alias columns from production authority where empty
UPDATE payment_certificates
SET certificate_number = legacy_cert_no
WHERE certificate_number IS NULL AND legacy_cert_no IS NOT NULL;

UPDATE payment_certificates
SET cert_no = legacy_cert_no
WHERE cert_no IS NULL AND legacy_cert_no IS NOT NULL;

UPDATE payment_certificates
SET period_to = legacy_period_end
WHERE period_to IS NULL AND legacy_period_end IS NOT NULL;

UPDATE payment_certificates
SET period_end = legacy_period_end
WHERE period_end IS NULL AND legacy_period_end IS NOT NULL;

-- ---------------------------------------------------------------------------
-- indexes present in production but not in 001/002
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cost_codes_client
  ON cost_codes (client_id);

CREATE INDEX IF NOT EXISTS ix_paycert_client
  ON payment_certificates (client_id);

CREATE INDEX IF NOT EXISTS ix_paycert_client_job
  ON payment_certificates (client_id, job_id);

CREATE INDEX IF NOT EXISTS ix_paycert_client_supplier
  ON payment_certificates (client_id, supplier_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_paycert_client_job_supplier_no
  ON payment_certificates (client_id, job_id, supplier_id, legacy_cert_no);
