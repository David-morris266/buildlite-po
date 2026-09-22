-- GP8-009A: tenant-owned Selling Costs templates and Simple-mode mapping authority.
-- Additive authority foundation. No customer Cost Code mapping or historic CVR backfill.

CREATE TABLE client_selling_cost_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  origin TEXT NOT NULL CHECK (origin IN ('buildlite_standard','blank')),
  source_standard_version INTEGER CHECK (source_standard_version IS NULL OR source_standard_version > 0),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  simple_assumption_percent NUMERIC(12,4) CHECK (simple_assumption_percent IS NULL OR (simple_assumption_percent >= 0 AND simple_assumption_percent <= 1000)),
  simple_destination_cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT,
  created_by_display_name TEXT,
  updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  updated_by_provider_user_id TEXT,
  updated_by_display_name TEXT,
  UNIQUE(client_id,id)
);
CREATE UNIQUE INDEX uq_client_selling_cost_templates_name ON client_selling_cost_templates(client_id,lower(btrim(name)));
CREATE UNIQUE INDEX uq_client_selling_cost_templates_default ON client_selling_cost_templates(client_id) WHERE is_default;
CREATE INDEX idx_client_selling_cost_templates_destination ON client_selling_cost_templates(client_id,simple_destination_cost_code_id);

CREATE TABLE client_selling_cost_template_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  template_id UUID NOT NULL,
  template_key TEXT NOT NULL CHECK (char_length(btrim(template_key)) BETWEEN 1 AND 80),
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  description TEXT,
  forecast_driver TEXT NOT NULL CHECK (forecast_driver IN ('PERCENT_REVENUE','LUMP_SUM','QUANTITY_RATE')),
  default_percent NUMERIC(12,4) CHECK (default_percent IS NULL OR (default_percent >= 0 AND default_percent <= 1000)),
  default_lump_sum NUMERIC(14,2),
  default_quantity NUMERIC(14,4),
  default_rate NUMERIC(14,4),
  unit_label TEXT CHECK (unit_label IS NULL OR char_length(btrim(unit_label)) BETWEEN 1 AND 40),
  cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  display_order INTEGER NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT,
  created_by_display_name TEXT,
  updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  updated_by_provider_user_id TEXT,
  updated_by_display_name TEXT,
  UNIQUE(template_id,template_key),
  FOREIGN KEY(client_id,template_id) REFERENCES client_selling_cost_templates(client_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_client_selling_cost_template_lines_template ON client_selling_cost_template_lines(client_id,template_id,display_order);

ALTER TABLE development_selling_costs_settings
  ALTER COLUMN assumption_percent DROP NOT NULL,
  ADD COLUMN source_template_id UUID,
  ADD COLUMN source_template_version INTEGER CHECK (source_template_version IS NULL OR source_template_version > 0),
  ADD COLUMN destination_cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  ADD COLUMN updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  ADD COLUMN updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  ADD COLUMN updated_by_provider_user_id TEXT;
ALTER TABLE development_selling_costs_settings
  ADD CONSTRAINT fk_development_selling_costs_template
  FOREIGN KEY(client_id,source_template_id) REFERENCES client_selling_cost_templates(client_id,id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION validate_selling_costs_cost_code_tenant() RETURNS trigger AS $$
DECLARE mapped_client UUID;
BEGIN
  IF TG_TABLE_NAME='client_selling_cost_templates' THEN
    IF NEW.simple_destination_cost_code_id IS NULL THEN RETURN NEW; END IF;
    SELECT client_id INTO mapped_client FROM cost_codes WHERE id=NEW.simple_destination_cost_code_id;
  ELSIF TG_TABLE_NAME='client_selling_cost_template_lines' THEN
    IF NEW.cost_code_id IS NULL THEN RETURN NEW; END IF;
    SELECT client_id INTO mapped_client FROM cost_codes WHERE id=NEW.cost_code_id;
  ELSE
    IF NEW.destination_cost_code_id IS NULL THEN RETURN NEW; END IF;
    SELECT client_id INTO mapped_client FROM cost_codes WHERE id=NEW.destination_cost_code_id;
  END IF;
  IF mapped_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'Selling Costs Cost Code must belong to the same tenant'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_selling_cost_template_tenant BEFORE INSERT OR UPDATE OF client_id,simple_destination_cost_code_id ON client_selling_cost_templates FOR EACH ROW EXECUTE FUNCTION validate_selling_costs_cost_code_tenant();
CREATE TRIGGER trg_selling_cost_line_tenant BEFORE INSERT OR UPDATE OF client_id,cost_code_id ON client_selling_cost_template_lines FOR EACH ROW EXECUTE FUNCTION validate_selling_costs_cost_code_tenant();
CREATE TRIGGER trg_development_selling_costs_destination_tenant BEFORE INSERT OR UPDATE OF client_id,destination_cost_code_id ON development_selling_costs_settings FOR EACH ROW EXECUTE FUNCTION validate_selling_costs_cost_code_tenant();
