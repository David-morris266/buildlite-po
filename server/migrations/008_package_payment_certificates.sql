-- 008_package_payment_certificates.sql
-- BL-030A — V1 Payment Certificate engine (not the legacy payment_certificates table)

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_payment_certificates_client_package_number
  ON package_payment_certificates (client_id, package_id, certificate_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_payment_certificates_one_open
  ON package_payment_certificates (client_id, package_id)
  WHERE status IN ('draft', 'submitted');

CREATE INDEX IF NOT EXISTS idx_package_payment_certificates_client_package
  ON package_payment_certificates (client_id, package_id);

CREATE INDEX IF NOT EXISTS idx_package_payment_certificates_client_development
  ON package_payment_certificates (client_id, development_id);

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

CREATE INDEX IF NOT EXISTS idx_package_payment_certificate_audit_cert_created
  ON package_payment_certificate_audit (certificate_id, created_at);
