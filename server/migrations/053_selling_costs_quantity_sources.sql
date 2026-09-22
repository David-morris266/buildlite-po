-- GP8-009B-R3: controlled Detailed Selling Costs quantity sources and units.
-- Additive only. Existing rows remain compatibility/manual; no Plot Master or CVR backfill.

ALTER TABLE client_selling_cost_template_lines
  ADD COLUMN default_quantity_source TEXT,
  ADD COLUMN default_unit_code TEXT,
  ADD COLUMN default_custom_unit_label TEXT,
  ADD CONSTRAINT chk_selling_cost_template_quantity_source CHECK (
    default_quantity_source IS NULL OR default_quantity_source IN ('MANUAL','TOTAL_PLOTS','PRIVATE_SALE_PLOTS')
  ),
  ADD CONSTRAINT chk_selling_cost_template_unit_code CHECK (
    default_unit_code IS NULL OR default_unit_code IN ('PLOTS','MONTHS','WEEKS','VISITS','ITEMS','EACH','FT2','M2','CUSTOM')
  ),
  ADD CONSTRAINT chk_selling_cost_template_custom_unit CHECK (
    default_custom_unit_label IS NULL OR char_length(btrim(default_custom_unit_label)) BETWEEN 1 AND 40
  );

ALTER TABLE development_selling_cost_line_assumptions
  ADD COLUMN quantity_source TEXT,
  ADD COLUMN unit_code TEXT,
  ADD COLUMN custom_unit_label TEXT,
  ADD CONSTRAINT chk_development_selling_cost_quantity_source CHECK (
    quantity_source IS NULL OR quantity_source IN ('MANUAL','TOTAL_PLOTS','PRIVATE_SALE_PLOTS')
  ),
  ADD CONSTRAINT chk_development_selling_cost_unit_code CHECK (
    unit_code IS NULL OR unit_code IN ('PLOTS','MONTHS','WEEKS','VISITS','ITEMS','EACH','FT2','M2','CUSTOM')
  ),
  ADD CONSTRAINT chk_development_selling_cost_custom_unit CHECK (
    custom_unit_label IS NULL OR char_length(btrim(custom_unit_label)) BETWEEN 1 AND 40
  );
