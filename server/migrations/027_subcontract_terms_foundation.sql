-- Versioned subcontract terms, defaults, immutable PO bindings and audit.
-- Additive only: no historic records are backfilled.

CREATE TABLE IF NOT EXISTS subcontract_terms_families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_terms_family_name_ci ON subcontract_terms_families(client_id, lower(btrim(name)));

CREATE TABLE IF NOT EXISTS subcontract_terms_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES subcontract_terms_families(id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL, version_label TEXT, status TEXT NOT NULL DEFAULT 'draft', effective_from DATE,
  rules_schema_version INTEGER NOT NULL DEFAULT 1, payment_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_document JSONB NOT NULL DEFAULT '{}'::jsonb, record_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_by TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by TEXT, published_at TIMESTAMPTZ, retired_by TEXT, retired_at TIMESTAMPTZ,
  UNIQUE(family_id, revision_number),
  CONSTRAINT chk_subcontract_terms_status CHECK(status IN ('draft','published','retired')),
  CONSTRAINT chk_subcontract_terms_revision CHECK(revision_number > 0),
  CONSTRAINT chk_subcontract_terms_rules CHECK(jsonb_typeof(payment_rules)='object'),
  CONSTRAINT chk_subcontract_terms_source CHECK(jsonb_typeof(source_document)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subcontract_terms_one_draft ON subcontract_terms_versions(family_id) WHERE status='draft';

CREATE TABLE IF NOT EXISTS client_subcontract_terms_defaults (
  client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE, terms_version_id UUID NOT NULL REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT,
  assigned_by TEXT, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS development_subcontract_terms_defaults (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE, development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  terms_version_id UUID NOT NULL REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT, assigned_by TEXT, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(client_id, development_id)
);
CREATE TABLE IF NOT EXISTS purchase_order_terms_overrides (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE, po_number TEXT NOT NULL REFERENCES purchase_orders(po_number) ON DELETE CASCADE,
  terms_version_id UUID NOT NULL REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT, reason TEXT NOT NULL,
  assigned_by TEXT, assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(client_id, po_number),
  CONSTRAINT chk_po_terms_override_reason CHECK(length(btrim(reason)) > 0)
);
CREATE TABLE IF NOT EXISTS purchase_order_terms_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  po_number TEXT NOT NULL REFERENCES purchase_orders(po_number) ON DELETE CASCADE, terms_version_id UUID REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT,
  resolved_source TEXT NOT NULL, binding_event TEXT NOT NULL DEFAULT 'po_approval', override_reason TEXT,
  legacy_prospective BOOLEAN NOT NULL DEFAULT FALSE, bound_by TEXT, bound_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id, po_number), CONSTRAINT chk_po_terms_source CHECK(resolved_source IN ('order_override','development_default','tenant_default','unconfigured','legacy_confirmed'))
);
CREATE TABLE IF NOT EXISTS subcontract_terms_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  family_id UUID REFERENCES subcontract_terms_families(id) ON DELETE RESTRICT, terms_version_id UUID REFERENCES subcontract_terms_versions(id) ON DELETE RESTRICT,
  po_number TEXT, development_id TEXT, action TEXT NOT NULL, actor TEXT, reason TEXT NOT NULL DEFAULT '', detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CONSTRAINT chk_subcontract_terms_audit_detail CHECK(jsonb_typeof(detail)='object')
);
CREATE INDEX IF NOT EXISTS idx_subcontract_terms_versions_client ON subcontract_terms_versions(client_id, family_id, revision_number);
CREATE INDEX IF NOT EXISTS idx_subcontract_terms_audit_client ON subcontract_terms_audit(client_id, created_at);

-- Reconcile an interrupted/test-first application of this not-yet-banked migration.
ALTER TABLE purchase_order_terms_bindings DROP CONSTRAINT IF EXISTS purchase_order_terms_bindings_po_number_fkey;
ALTER TABLE purchase_order_terms_bindings ADD CONSTRAINT purchase_order_terms_bindings_po_number_fkey
  FOREIGN KEY (po_number) REFERENCES purchase_orders(po_number) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION prevent_published_subcontract_terms_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('published','retired') AND (
    NEW.family_id IS DISTINCT FROM OLD.family_id OR NEW.revision_number IS DISTINCT FROM OLD.revision_number OR
    NEW.version_label IS DISTINCT FROM OLD.version_label OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
    NEW.rules_schema_version IS DISTINCT FROM OLD.rules_schema_version OR NEW.payment_rules IS DISTINCT FROM OLD.payment_rules OR
    NEW.source_document IS DISTINCT FROM OLD.source_document
  ) THEN RAISE EXCEPTION 'Published subcontract terms are immutable'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_subcontract_terms_published_immutable ON subcontract_terms_versions;
CREATE TRIGGER trg_subcontract_terms_published_immutable BEFORE UPDATE ON subcontract_terms_versions
FOR EACH ROW EXECUTE FUNCTION prevent_published_subcontract_terms_mutation();
