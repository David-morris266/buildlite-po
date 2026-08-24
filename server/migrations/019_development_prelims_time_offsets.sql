-- 019_development_prelims_time_offsets.sql
-- BL-033D.x.3R — Development-owned TIME calendar-month offsets.
-- Additive. Default 0 / 0 so existing rows keep SITE_START → FINAL_COMPLETION money.
-- Does not alter company templates, CVR, snapshots, classification, or programme.
-- Do not apply to buildlite_clone until controlled UAT.

ALTER TABLE development_prelims_items
  ADD COLUMN IF NOT EXISTS start_offset_months INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS end_offset_months INTEGER NOT NULL DEFAULT 0;

ALTER TABLE development_prelims_items
  DROP CONSTRAINT IF EXISTS chk_development_prelims_items_start_offset,
  DROP CONSTRAINT IF EXISTS chk_development_prelims_items_end_offset;

ALTER TABLE development_prelims_items
  ADD CONSTRAINT chk_development_prelims_items_start_offset
    CHECK (start_offset_months BETWEEN -60 AND 60),
  ADD CONSTRAINT chk_development_prelims_items_end_offset
    CHECK (end_offset_months BETWEEN -60 AND 60);
