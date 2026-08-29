-- 026_subcontract_payment_applications.sql
-- Source-fact capture for subcontractor payment applications.

CREATE TABLE IF NOT EXISTS subcontract_payment_applications (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id                TEXT NOT NULL REFERENCES developments(id),
  package_id                    UUID NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  certificate_id                UUID REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  application_reference         TEXT NOT NULL,
  received_at                   TIMESTAMPTZ NOT NULL,
  valuation_date                DATE,
  application_basis             TEXT NOT NULL,
  cumulative_gross_claimed      NUMERIC(14,2),
  current_period_gross_claimed  NUMERIC(14,2),
  previous_application_stated   NUMERIC(14,2),
  previous_certified_stated     NUMERIC(14,2),
  retention_stated              NUMERIC(14,2),
  contra_deductions_stated      NUMERIC(14,2),
  vat_stated                    NUMERIC(14,2),
  net_requested_stated          NUMERIC(14,2),
  notes                         TEXT,
  attachment_metadata           JSONB,
  revision_number               INTEGER NOT NULL DEFAULT 1,
  supersedes_id                 UUID REFERENCES subcontract_payment_applications(id) ON DELETE RESTRICT,
  status                        TEXT NOT NULL DEFAULT 'recorded',
  version                       INTEGER NOT NULL DEFAULT 1,
  recorded_by                   TEXT,
  recorded_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_subcontract_application_basis CHECK (application_basis IN (
    'cumulative_less_previous_application',
    'cumulative_less_previous_certified',
    'current_period_gross',
    'net_only'
  )),
  CONSTRAINT chk_subcontract_application_status CHECK (status IN ('recorded', 'superseded', 'withdrawn')),
  CONSTRAINT chk_subcontract_application_revision CHECK (revision_number >= 1),
  CONSTRAINT chk_subcontract_application_version CHECK (version >= 1),
  CONSTRAINT chk_subcontract_application_attachment CHECK (
    attachment_metadata IS NULL OR jsonb_typeof(attachment_metadata) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS idx_subcontract_applications_client_package
  ON subcontract_payment_applications (client_id, package_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_subcontract_applications_certificate
  ON subcontract_payment_applications (client_id, certificate_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_application_one_active_certificate
  ON subcontract_payment_applications (client_id, certificate_id)
  WHERE certificate_id IS NOT NULL AND status = 'recorded';

CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_application_revision
  ON subcontract_payment_applications (client_id, package_id, application_reference, revision_number);

CREATE TABLE IF NOT EXISTS subcontract_payment_application_audit (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  application_id    UUID NOT NULL REFERENCES subcontract_payment_applications(id) ON DELETE RESTRICT,
  action            TEXT NOT NULL,
  actor             TEXT,
  comment           TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subcontract_application_audit_application
  ON subcontract_payment_application_audit (application_id, created_at, id);
