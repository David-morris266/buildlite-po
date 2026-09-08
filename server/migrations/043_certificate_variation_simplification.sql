-- GP certificate variation simplification.
-- Truthful unassessed VA forecasts and narrowly-scoped disposal of never-submitted Draft certificates.
-- No backfill, authority reinterpretation or historic certificate mutation.

ALTER TABLE package_variation_account_items
  ALTER COLUMN current_qs_forecast DROP NOT NULL;

ALTER TABLE package_variation_account_items
  ADD COLUMN IF NOT EXISTS forecast_status TEXT NOT NULL DEFAULT 'assessed';
ALTER TABLE package_variation_account_items
  ADD COLUMN IF NOT EXISTS originating_certificate_id UUID NULL REFERENCES package_payment_certificates(id);

ALTER TABLE package_variation_account_items
  DROP CONSTRAINT IF EXISTS chk_variation_account_forecast_state;
ALTER TABLE package_variation_account_items
  ADD CONSTRAINT chk_variation_account_forecast_state CHECK (
    (forecast_status = 'assessed' AND current_qs_forecast IS NOT NULL)
    OR (forecast_status = 'pending' AND current_qs_forecast IS NULL)
  );

CREATE OR REPLACE FUNCTION is_disposable_draft_certificate(p_client_id UUID, p_certificate_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM package_payment_certificates c
    WHERE c.client_id = p_client_id AND c.id = p_certificate_id AND c.status = 'draft'
  ) AND NOT EXISTS (
    SELECT 1 FROM package_payment_certificate_audit a
    WHERE a.client_id = p_client_id AND a.certificate_id = p_certificate_id AND a.action = 'submitted'
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION is_disposable_draft_variation(p_client_id UUID, p_item_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM package_variation_account_items v
    WHERE v.client_id=p_client_id AND v.id=p_item_id AND v.forecast_status='pending'
      AND v.originating_certificate_id IS NOT NULL
      AND is_disposable_draft_certificate(v.client_id,v.originating_certificate_id)
  );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION protect_variation_account_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_variation(OLD.client_id,OLD.variation_account_item_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'variation account history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_variation_account_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_variation(OLD.client_id,OLD.id) THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'variation account identity is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR
     NEW.package_id<>OLD.package_id OR NEW.cost_code<>OLD.cost_code OR NEW.variation_reference<>OLD.variation_reference OR
     NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR
     NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR
     NEW.created_at<>OLD.created_at OR NEW.originating_certificate_id IS DISTINCT FROM OLD.originating_certificate_id THEN RAISE EXCEPTION 'variation account identity is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_va_authority_append_only() RETURNS trigger AS $$
DECLARE item_id UUID;
BEGIN
  item_id := CASE WHEN TG_TABLE_NAME='package_variation_account_authority_audit' THEN OLD.variation_account_item_id ELSE OLD.variation_account_item_id END;
  IF TG_OP='DELETE' AND is_disposable_draft_variation(OLD.client_id,item_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Variation Account authority provenance is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_application_variation_line_mutation() RETURNS trigger AS $$
DECLARE app_status TEXT; cert_status TEXT; cert_id UUID;
BEGIN
  SELECT a.status,c.status,a.certificate_id INTO app_status,cert_status,cert_id
  FROM subcontract_payment_applications a
  LEFT JOIN package_payment_certificates c ON c.id=a.certificate_id AND c.client_id=a.client_id
  WHERE a.id=OLD.application_id;
  IF TG_OP='DELETE' AND cert_id IS NOT NULL AND is_disposable_draft_certificate(OLD.client_id,cert_id) THEN RETURN OLD; END IF;
  IF app_status <> 'recorded' OR (cert_status IS NOT NULL AND cert_status <> 'draft') THEN
    RAISE EXCEPTION 'Frozen application variation evidence is immutable';
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Application variation evidence cannot be deleted'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_application_variation_audit_mutation() RETURNS trigger AS $$
DECLARE cert_id UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT a.certificate_id INTO cert_id
    FROM subcontract_payment_application_variation_lines l
    JOIN subcontract_payment_applications a ON a.id=l.application_id AND a.client_id=l.client_id
    WHERE l.id=OLD.line_id AND l.client_id=OLD.client_id;
    IF cert_id IS NOT NULL AND is_disposable_draft_certificate(OLD.client_id,cert_id) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'Application variation audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_va_certificate_assessment() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_certificate(OLD.client_id,OLD.certificate_id) AND OLD.status<>'locked' THEN RETURN OLD; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Variation Account certificate assessment cannot be deleted'; END IF;
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'Non-draft Variation Account certificate assessment is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR NEW.package_id<>OLD.package_id OR NEW.certificate_id<>OLD.certificate_id OR NEW.variation_account_item_id<>OLD.variation_account_item_id OR NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'Variation Account certificate assessment identity is immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_va_certificate_assessment_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_certificate(OLD.client_id,OLD.certificate_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Variation Account certificate assessment audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_payment_discovered_locked_fact() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_certificate(OLD.client_id,OLD.certificate_id) AND OLD.status<>'locked' THEN RETURN OLD; END IF;
  IF OLD.status<>'draft' THEN RAISE EXCEPTION 'non-draft payment-discovered item is immutable'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment-discovered identity is immutable'; END IF;
  IF NEW.id<>OLD.id OR NEW.client_id<>OLD.client_id OR NEW.development_id<>OLD.development_id OR
     NEW.package_id<>OLD.package_id OR NEW.certificate_id<>OLD.certificate_id OR NEW.cost_code<>OLD.cost_code OR
     NEW.description<>OLD.description OR NEW.signed_amount<>OLD.signed_amount OR NEW.basis<>OLD.basis OR
     NEW.created_by_user_id<>OLD.created_by_user_id OR NEW.created_by_membership_id<>OLD.created_by_membership_id OR
     NEW.created_by_provider_user_id<>OLD.created_by_provider_user_id OR NEW.created_by_display_name<>OLD.created_by_display_name OR
     NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'payment-discovered fact fields are immutable'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION protect_disposable_payment_discovered_audit() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND is_disposable_draft_certificate(OLD.client_id,OLD.certificate_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'payment-discovered provenance is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_discovered_audit_immutable ON package_payment_discovered_item_audit;
CREATE TRIGGER trg_payment_discovered_audit_immutable BEFORE UPDATE OR DELETE ON package_payment_discovered_item_audit
FOR EACH ROW EXECUTE FUNCTION protect_disposable_payment_discovered_audit();

CREATE OR REPLACE FUNCTION protect_disposable_payment_discovered_link() RETURNS trigger AS $$
DECLARE cert_id UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT certificate_id INTO cert_id FROM package_payment_discovered_items
    WHERE client_id=OLD.client_id AND id=OLD.payment_discovered_item_id;
    IF cert_id IS NOT NULL AND is_disposable_draft_certificate(OLD.client_id,cert_id) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'payment-discovered provenance is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_payment_discovered_links_immutable ON package_payment_discovered_regularisation_links;
CREATE TRIGGER trg_payment_discovered_links_immutable BEFORE UPDATE OR DELETE ON package_payment_discovered_regularisation_links
FOR EACH ROW EXECUTE FUNCTION protect_disposable_payment_discovered_link();

CREATE OR REPLACE FUNCTION protect_disposable_va_payment_discovered_link() RETURNS trigger AS $$
DECLARE cert_id UUID;
BEGIN
  IF TG_OP='DELETE' THEN
    SELECT certificate_id INTO cert_id FROM package_payment_discovered_items
    WHERE client_id=OLD.client_id AND id=OLD.payment_discovered_item_id;
    IF cert_id IS NOT NULL AND is_disposable_draft_certificate(OLD.client_id,cert_id) THEN RETURN OLD; END IF;
  END IF;
  RAISE EXCEPTION 'variation account history is append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_variation_account_pd_links_immutable ON package_variation_account_payment_discovered_links;
CREATE TRIGGER trg_variation_account_pd_links_immutable BEFORE UPDATE OR DELETE ON package_variation_account_payment_discovered_links
FOR EACH ROW EXECUTE FUNCTION protect_disposable_va_payment_discovered_link();

-- Existing Variation Account rows remain assessed and unchanged through the DEFAULT.
-- No historic row is updated and no certificate/authority fact is created.
