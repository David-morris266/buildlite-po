-- GP8-009B: durable Development Detailed Selling Costs assumptions.
-- Additive setup/proposal authority only; no CVR adoption or historic backfill.

ALTER TABLE client_selling_cost_template_lines
  ADD CONSTRAINT uq_client_selling_cost_template_line_identity UNIQUE(template_id,id);

CREATE TABLE development_selling_cost_line_assumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  development_id TEXT NOT NULL,
  template_id UUID NOT NULL,
  template_line_id UUID NOT NULL,
  driver TEXT NOT NULL CHECK (driver IN ('PERCENT_REVENUE','LUMP_SUM','QUANTITY_RATE')),
  percent NUMERIC(12,4) CHECK (percent IS NULL OR (percent >= 0 AND percent <= 1000)),
  lump_sum NUMERIC(14,2),
  quantity NUMERIC(14,4),
  rate NUMERIC(14,4),
  unit_label TEXT CHECK (unit_label IS NULL OR char_length(btrim(unit_label)) BETWEEN 1 AND 40),
  destination_cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  assumption_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  destination_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  updated_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  updated_by_provider_user_id TEXT,
  updated_by_display_name TEXT,
  UNIQUE(client_id,development_id,template_line_id),
  FOREIGN KEY(development_id) REFERENCES developments(id) ON DELETE CASCADE,
  FOREIGN KEY(client_id,template_id) REFERENCES client_selling_cost_templates(client_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(template_id,template_line_id) REFERENCES client_selling_cost_template_lines(template_id,id) ON DELETE RESTRICT
);

CREATE INDEX idx_development_selling_cost_line_assumptions
  ON development_selling_cost_line_assumptions(client_id,development_id,template_id);

CREATE OR REPLACE FUNCTION validate_detailed_selling_costs_development_tenant() RETURNS trigger AS $$
DECLARE owner_client UUID;
BEGIN
  SELECT client_id INTO owner_client FROM developments WHERE id=NEW.development_id;
  IF owner_client IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'Detailed Selling Costs development must belong to the same tenant'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_detailed_selling_costs_development_tenant
BEFORE INSERT OR UPDATE OF client_id,development_id
ON development_selling_cost_line_assumptions
FOR EACH ROW EXECUTE FUNCTION validate_detailed_selling_costs_development_tenant();

CREATE TRIGGER trg_development_selling_cost_line_destination_tenant
BEFORE INSERT OR UPDATE OF client_id,destination_cost_code_id
ON development_selling_cost_line_assumptions
FOR EACH ROW EXECUTE FUNCTION validate_selling_costs_cost_code_tenant();
