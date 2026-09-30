-- Stable tenant Cost Code Master authority for Variation Order monetary lines.
-- Preserve legacy display evidence and resolve only exact active canonical codes.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='uq_cost_codes_client_identity') THEN
    ALTER TABLE cost_codes ADD CONSTRAINT uq_cost_codes_client_identity UNIQUE (client_id, id);
  END IF;
END $$;

ALTER TABLE variation_order_lines
  ADD COLUMN IF NOT EXISTS cost_code_id UUID,
  ADD COLUMN IF NOT EXISTS cost_code_source_evidence TEXT,
  ADD COLUMN IF NOT EXISTS cost_code_description TEXT;

UPDATE variation_order_lines
SET cost_code_source_evidence = cost_code
WHERE cost_code_source_evidence IS NULL
   OR btrim(cost_code_source_evidence) = '';

UPDATE variation_order_lines line
SET cost_code_id = code.id,
    cost_code_description = COALESCE(code.description, code.element, '')
FROM cost_codes code
WHERE code.client_id = line.client_id
  AND code.is_active = TRUE
  AND lower(btrim(code.code)) = lower(btrim(line.cost_code));

UPDATE variation_order_lines
SET cost_code_description = NULL
WHERE cost_code_id IS NULL
  AND cost_code_description = '';

ALTER TABLE variation_order_lines
  ALTER COLUMN cost_code_source_evidence SET NOT NULL,
  ALTER COLUMN cost_code_source_evidence SET DEFAULT '',
  ALTER COLUMN cost_code_description DROP NOT NULL,
  ALTER COLUMN cost_code_description DROP DEFAULT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_variation_order_line_resolved_cost_code_evidence') THEN
    ALTER TABLE variation_order_lines
      ADD CONSTRAINT chk_variation_order_line_resolved_cost_code_evidence
      CHECK (cost_code_id IS NULL OR cost_code_description IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_variation_order_line_tenant_cost_code') THEN
    ALTER TABLE variation_order_lines
      ADD CONSTRAINT fk_variation_order_line_tenant_cost_code
      FOREIGN KEY (client_id, cost_code_id)
      REFERENCES cost_codes(client_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_variation_order_lines_cost_code
  ON variation_order_lines(client_id, cost_code_id, variation_order_id);
