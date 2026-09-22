-- GP8-012A — dedicated semantic-classification authority and authenticated provenance.
-- Additive only. Historic rows are intentionally not assigned invented identities.

INSERT INTO permissions(key, description)
VALUES ('cost_code_classifications.manage', 'Manage BuildLite semantic classifications applied to tenant Cost Codes')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'cost_code_classifications.manage' FROM roles WHERE key IN ('commercial_director', 'admin')
ON CONFLICT DO NOTHING;

ALTER TABLE cost_code_classifications
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS created_by_membership_id UUID,
  ADD COLUMN IF NOT EXISTS created_by_provider_user_id TEXT,
  ADD COLUMN IF NOT EXISTS created_by_role_key TEXT,
  ADD COLUMN IF NOT EXISTS created_by_permission_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_user_id UUID,
  ADD COLUMN IF NOT EXISTS updated_by_membership_id UUID,
  ADD COLUMN IF NOT EXISTS updated_by_provider_user_id TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_role_key TEXT,
  ADD COLUMN IF NOT EXISTS updated_by_permission_key TEXT;

CREATE INDEX IF NOT EXISTS idx_cost_code_classifications_created_membership
  ON cost_code_classifications(created_by_membership_id);
CREATE INDEX IF NOT EXISTS idx_cost_code_classifications_updated_membership
  ON cost_code_classifications(updated_by_membership_id);
