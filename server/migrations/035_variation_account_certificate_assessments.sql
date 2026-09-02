-- VA-2: QS certificate assessments against canonical Variation Account items.
-- Additive only. No historic backfill and no reinterpretation of Migration 032 facts.
CREATE TABLE IF NOT EXISTS package_variation_account_certificate_assessments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT, package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
 certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
 variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
 application_variation_line_id UUID REFERENCES subcontract_payment_application_variation_lines(id) ON DELETE RESTRICT,
 signed_current_assessment NUMERIC(14,2) NOT NULL CHECK(signed_current_assessment<>0), assessment_basis TEXT NOT NULL CHECK(btrim(assessment_basis)<>''),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','locked','withdrawn')),
 previous_certified_at_lock NUMERIC(14,2), cumulative_certified_at_lock NUMERIC(14,2), source_authority_snapshot JSONB,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id), created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id),
 created_by_provider_user_id TEXT NOT NULL, created_by_display_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_by_user_id UUID NOT NULL REFERENCES buildlite_users(id), updated_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id),
 updated_by_provider_user_id TEXT NOT NULL, updated_by_display_name TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 locked_at TIMESTAMPTZ, locked_by_user_id UUID REFERENCES buildlite_users(id),
 CHECK((status IN('draft','withdrawn') AND locked_at IS NULL AND locked_by_user_id IS NULL AND previous_certified_at_lock IS NULL AND cumulative_certified_at_lock IS NULL AND source_authority_snapshot IS NULL) OR
       (status='locked' AND locked_at IS NOT NULL AND locked_by_user_id IS NOT NULL AND previous_certified_at_lock IS NOT NULL AND cumulative_certified_at_lock IS NOT NULL AND source_authority_snapshot IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_certificate_assessment_active ON package_variation_account_certificate_assessments(client_id,certificate_id,variation_account_item_id) WHERE status<>'withdrawn';
CREATE INDEX IF NOT EXISTS idx_va_certificate_assessment_history ON package_variation_account_certificate_assessments(client_id,package_id,variation_account_item_id,status,created_at,id);
CREATE TABLE IF NOT EXISTS package_variation_account_certificate_assessment_audit (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id),
 assessment_id UUID NOT NULL REFERENCES package_variation_account_certificate_assessments(id), certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id),
 variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id), action TEXT NOT NULL CHECK(action IN('created','revised','withdrawn','locked')),
 detail JSONB NOT NULL DEFAULT '{}'::jsonb, actor_user_id UUID NOT NULL REFERENCES buildlite_users(id), actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id),
 actor_provider_user_id TEXT NOT NULL, actor_display_name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_va_certificate_assessment_audit ON package_variation_account_certificate_assessment_audit(client_id,assessment_id,created_at,id);
CREATE OR REPLACE FUNCTION guard_va_certificate_assessment() RETURNS trigger AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variation Account certificate assessment cannot be deleted'; END IF;
 IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Non-draft Variation Account certificate assessment is immutable'; END IF;
 IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR NEW.package_id<>OLD.package_id OR NEW.certificate_id<>OLD.certificate_id OR NEW.variation_account_item_id<>OLD.variation_account_item_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Variation Account certificate assessment identity is immutable'; END IF;
 RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_va_certificate_assessment_guard ON package_variation_account_certificate_assessments;
CREATE TRIGGER trg_va_certificate_assessment_guard BEFORE UPDATE OR DELETE ON package_variation_account_certificate_assessments FOR EACH ROW EXECUTE FUNCTION guard_va_certificate_assessment();
CREATE OR REPLACE FUNCTION protect_va_certificate_assessment_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'Variation Account certificate assessment audit is append-only'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_va_certificate_assessment_audit_immutable ON package_variation_account_certificate_assessment_audit;
CREATE TRIGGER trg_va_certificate_assessment_audit_immutable BEFORE UPDATE OR DELETE ON package_variation_account_certificate_assessment_audit FOR EACH ROW EXECUTE FUNCTION protect_va_certificate_assessment_audit();
INSERT INTO permissions(key,description) VALUES('variation_account.assess','Assess Variation Account items on Draft payment certificates') ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
WITH grants(role_key,permission_key) AS (VALUES('qs','variation_account.assess'),('commercial_manager','variation_account.assess'),('commercial_director','variation_account.assess'))
INSERT INTO role_permissions(role_id,permission_key) SELECT r.id,g.permission_key FROM grants g JOIN roles r ON r.key=g.role_key ON CONFLICT DO NOTHING;
