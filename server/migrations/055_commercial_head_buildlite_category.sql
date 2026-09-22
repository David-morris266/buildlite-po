-- GP8-013A — tenant Commercial Head category authority.
-- Additive only: existing tenant Heads are deliberately not inferred or backfilled.

ALTER TABLE commercial_structure_heads
  ADD COLUMN IF NOT EXISTS buildlite_category TEXT;

ALTER TABLE commercial_structure_heads
  DROP CONSTRAINT IF EXISTS chk_commercial_structure_heads_buildlite_category;
ALTER TABLE commercial_structure_heads
  ADD CONSTRAINT chk_commercial_structure_heads_buildlite_category CHECK (
    buildlite_category IS NULL OR buildlite_category IN (
      'LAND',
      'PROFESSIONAL_FEES',
      'PRELIMINARIES',
      'HOUSE_BUILD',
      'PLOT_WORKS',
      'EXTERNAL_WORKS_INFRASTRUCTURE',
      'SELLING_COSTS',
      'FINANCE_LEGAL',
      'CUSTOMER_COSTS'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_structure_heads_active_buildlite_category
  ON commercial_structure_heads(client_id, buildlite_category)
  WHERE is_active = TRUE AND buildlite_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commercial_structure_heads_buildlite_category
  ON commercial_structure_heads(client_id, buildlite_category)
  WHERE buildlite_category IS NOT NULL;

INSERT INTO permissions(key, description)
VALUES ('commercial_head_categories.manage', 'Assign BuildLite categories to tenant Commercial Heads')
ON CONFLICT(key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'commercial_head_categories.manage'
FROM roles
WHERE key IN ('commercial_director', 'admin')
ON CONFLICT DO NOTHING;
