-- Generic immutable commercial-document envelope and stored PDF binary.
-- Additive only. No historic document backfill.

CREATE TABLE IF NOT EXISTS commercial_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
  certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL CHECK (document_type IN ('payment_certificate','combined_certificate_payment_notice','payment_notice','pay_less_notice')),
  document_reference TEXT NOT NULL,
  source_authority_type TEXT NOT NULL,
  source_authority_id UUID NOT NULL,
  source_snapshot_ids JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_snapshot_ids)='object'),
  document_schema_version INTEGER NOT NULL CHECK (document_schema_version > 0),
  template_version TEXT NOT NULL,
  render_payload JSONB NOT NULL CHECK (jsonb_typeof(render_payload)='object'),
  recipient_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(recipient_snapshot)='object'),
  mime_type TEXT NOT NULL DEFAULT 'application/pdf' CHECK (mime_type='application/pdf'),
  page_count INTEGER CHECK (page_count IS NULL OR page_count > 0),
  binary_data BYTEA NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','issued','superseded')),
  generated_by TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by TEXT,
  issued_at TIMESTAMPTZ,
  supersedes_document_id UUID REFERENCES commercial_documents(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(client_id,id)
);

CREATE TABLE IF NOT EXISTS commercial_document_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES commercial_documents(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  actor TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail)='object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commercial_documents_certificate ON commercial_documents(client_id,certificate_id,document_type,generated_at);
CREATE INDEX IF NOT EXISTS idx_commercial_documents_package ON commercial_documents(client_id,package_id,generated_at);
CREATE INDEX IF NOT EXISTS idx_commercial_document_audit ON commercial_document_audit(client_id,document_id,created_at);

CREATE OR REPLACE FUNCTION protect_commercial_document_authority() RETURNS trigger AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Commercial documents are immutable'; END IF;
  IF OLD.client_id IS DISTINCT FROM NEW.client_id OR OLD.development_id IS DISTINCT FROM NEW.development_id
    OR OLD.package_id IS DISTINCT FROM NEW.package_id OR OLD.certificate_id IS DISTINCT FROM NEW.certificate_id
    OR OLD.document_type IS DISTINCT FROM NEW.document_type OR OLD.document_reference IS DISTINCT FROM NEW.document_reference
    OR OLD.source_authority_type IS DISTINCT FROM NEW.source_authority_type OR OLD.source_authority_id IS DISTINCT FROM NEW.source_authority_id
    OR OLD.source_snapshot_ids IS DISTINCT FROM NEW.source_snapshot_ids OR OLD.document_schema_version IS DISTINCT FROM NEW.document_schema_version
    OR OLD.template_version IS DISTINCT FROM NEW.template_version OR OLD.render_payload IS DISTINCT FROM NEW.render_payload
    OR OLD.recipient_snapshot IS DISTINCT FROM NEW.recipient_snapshot OR OLD.mime_type IS DISTINCT FROM NEW.mime_type
    OR OLD.page_count IS DISTINCT FROM NEW.page_count OR OLD.binary_data IS DISTINCT FROM NEW.binary_data
    OR OLD.sha256 IS DISTINCT FROM NEW.sha256 OR OLD.generated_by IS DISTINCT FROM NEW.generated_by
    OR OLD.generated_at IS DISTINCT FROM NEW.generated_at OR OLD.supersedes_document_id IS DISTINCT FROM NEW.supersedes_document_id
  THEN RAISE EXCEPTION 'Commercial document content and provenance are immutable'; END IF;
  IF OLD.status='generated' AND NEW.status='issued' THEN
    IF NEW.issued_at IS NULL THEN RAISE EXCEPTION 'Issued document requires issued_at'; END IF;
  ELSIF OLD.status='issued' AND NEW.status='superseded' THEN NULL;
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN RAISE EXCEPTION 'Invalid commercial document lifecycle transition';
  END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status AND
    (OLD.issued_by IS DISTINCT FROM NEW.issued_by OR OLD.issued_at IS DISTINCT FROM NEW.issued_at OR OLD.version IS DISTINCT FROM NEW.version)
  THEN RAISE EXCEPTION 'Commercial document lifecycle evidence is immutable'; END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.version<>OLD.version+1
  THEN RAISE EXCEPTION 'Commercial document lifecycle version must advance once'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_commercial_document_immutable ON commercial_documents;
CREATE TRIGGER trg_commercial_document_immutable BEFORE UPDATE OR DELETE ON commercial_documents
FOR EACH ROW EXECUTE FUNCTION protect_commercial_document_authority();
