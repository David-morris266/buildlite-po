-- 018_development_prelims_item_provenance.sql
-- BL-033D.x.3 — Nullable template provenance on development Prelims items.
-- Additive. No backfill. Existing D.1 manual rows stay NULL.
-- Identity for template-instantiated rows is
--   (development_id, source_template_id, source_template_key)
-- Same cost_code_key is an overlap warning, not uniqueness.
-- Do not apply to buildlite_clone until the controlled D.x.3 UAT.

ALTER TABLE development_prelims_items
  ADD COLUMN IF NOT EXISTS source_template_id UUID,
  ADD COLUMN IF NOT EXISTS source_template_version INTEGER,
  ADD COLUMN IF NOT EXISTS source_template_line_id UUID,
  ADD COLUMN IF NOT EXISTS source_template_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_development_prelims_items_template_provenance
  ON development_prelims_items (development_id, source_template_id, source_template_key)
  WHERE source_template_id IS NOT NULL AND source_template_key IS NOT NULL;
