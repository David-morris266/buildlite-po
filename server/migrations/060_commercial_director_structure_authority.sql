-- GP10-003: senior commercial authority for company structure and Cost Code onboarding.
INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'commercial_structure.manage'
FROM roles
WHERE key = 'commercial_director'
ON CONFLICT DO NOTHING;
