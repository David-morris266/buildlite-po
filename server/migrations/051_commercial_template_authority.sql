-- GP8-009A-R5: dedicated authority for tenant-owned commercial templates.
-- Additive RBAC only. No template, Cost Code, development or CVR data changes.

INSERT INTO permissions(key, description)
VALUES (
  'commercial_templates.manage',
  'Manage tenant-owned company commercial forecasting templates and Cost Code mappings'
)
ON CONFLICT(key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'commercial_templates.manage'
FROM roles
WHERE key IN ('commercial_director', 'admin')
ON CONFLICT DO NOTHING;
