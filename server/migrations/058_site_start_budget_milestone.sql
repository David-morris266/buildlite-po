-- GP9-003-R4: explicit immutable Site Start Budget milestone. Additive; zero backfill.
CREATE TABLE development_budget_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  milestone_type TEXT NOT NULL CHECK(milestone_type='site_start_budget'),
  opening_budget_event_id UUID NOT NULL REFERENCES development_budget_events(id) ON DELETE RESTRICT,
  approved_effective_date DATE NOT NULL, reference TEXT NOT NULL CHECK(btrim(reference)<>''),
  approval_reason TEXT NOT NULL CHECK(btrim(approval_reason)<>''), evidence_snapshot JSONB NOT NULL CHECK(jsonb_typeof(evidence_snapshot)='object'),
  evidence_hash_scheme TEXT NOT NULL CHECK(evidence_hash_scheme='canonical_json_sha256_v1'),
  evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL, created_by_display_name TEXT NOT NULL, created_role_key TEXT NOT NULL,
  created_permission_key TEXT NOT NULL CHECK(created_permission_key='development_budget.post'), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,development_id,milestone_type), UNIQUE(client_id,opening_budget_event_id,milestone_type)
);
CREATE OR REPLACE FUNCTION validate_development_budget_milestone() RETURNS trigger AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM development_budget_events e WHERE e.id=NEW.opening_budget_event_id AND e.client_id=NEW.client_id AND e.development_id=NEW.development_id AND e.event_type='opening_budget') THEN RAISE EXCEPTION 'Site Start Budget must reference this Development''s Opening Budget'; END IF;
  IF NOT EXISTS(SELECT 1 FROM client_user_memberships m JOIN buildlite_users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_key='development_budget.post' WHERE m.id=NEW.created_by_membership_id AND m.user_id=NEW.created_by_user_id AND m.client_id=NEW.client_id AND m.is_active AND u.status='active' AND u.provider_user_id=NEW.created_by_provider_user_id AND u.display_name=NEW.created_by_display_name AND r.key=NEW.created_role_key) THEN RAISE EXCEPTION 'Site Start Budget requires an active authorised membership'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_development_budget_milestone_boundary BEFORE INSERT ON development_budget_milestones FOR EACH ROW EXECUTE FUNCTION validate_development_budget_milestone();
CREATE TRIGGER trg_development_budget_milestone_immutable BEFORE UPDATE OR DELETE ON development_budget_milestones FOR EACH ROW EXECUTE FUNCTION protect_development_budget_history();
