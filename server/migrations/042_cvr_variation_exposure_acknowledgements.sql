-- VA-5C: auditable acknowledgement of calculable VA floor exceptions.
-- Acknowledgements belong to one immutable CVR VA submission attempt.

CREATE TABLE cvr_variation_exposure_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES cvr_periods(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES cvr_period_variation_exposure_submissions(id) ON DELETE RESTRICT,
  variation_account_item_id UUID NOT NULL REFERENCES package_variation_account_items(id) ON DELETE RESTRICT,
  exception_code TEXT NOT NULL CHECK(exception_code IN ('forecast_below_recognised_authority','forecast_below_locked_certification','certified_above_forecast')),
  variation_reference TEXT NOT NULL,
  qs_forecast NUMERIC(18,2) NOT NULL,
  effective_floor NUMERIC(18,2) NOT NULL,
  variance NUMERIC(18,2) NOT NULL,
  reason TEXT,
  acknowledged_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  role_key TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,submission_id,variation_account_item_id,exception_code)
);
CREATE INDEX idx_cvr_va_ack_period ON cvr_variation_exposure_acknowledgements(client_id,period_id,submission_id,acknowledged_at);

CREATE OR REPLACE FUNCTION protect_cvr_variation_exposure_acknowledgement() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND pg_trigger_depth()>1 THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'CVR Variation exposure acknowledgement is immutable';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_va_ack_immutable BEFORE UPDATE OR DELETE ON cvr_variation_exposure_acknowledgements
FOR EACH ROW EXECUTE FUNCTION protect_cvr_variation_exposure_acknowledgement();

CREATE OR REPLACE FUNCTION validate_cvr_variation_exposure_acknowledgement() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cvr_period_variation_exposure_submissions s
    JOIN cvr_periods p ON p.id=s.period_id AND p.client_id=s.client_id
    JOIN package_variation_account_items va ON va.id=NEW.variation_account_item_id AND va.client_id=NEW.client_id
    JOIN client_user_memberships m ON m.id=NEW.membership_id AND m.client_id=NEW.client_id AND m.user_id=NEW.acknowledged_by_user_id
    WHERE s.id=NEW.submission_id AND s.client_id=NEW.client_id
      AND s.development_id=NEW.development_id AND s.period_id=NEW.period_id
      AND p.status='submitted' AND va.development_id=NEW.development_id
  ) THEN RAISE EXCEPTION 'CVR Variation exposure acknowledgement boundary is invalid'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_cvr_va_ack_boundary BEFORE INSERT ON cvr_variation_exposure_acknowledgements
FOR EACH ROW EXECUTE FUNCTION validate_cvr_variation_exposure_acknowledgement();
