-- SS-1: immutable Land Purchase Appraisal and first-class Site Start period identity.

INSERT INTO permissions(key,description) VALUES
  ('land_appraisal.capture','Capture the immutable Land Purchase Appraisal baseline'),
  ('site_start.manage','Manage the Site Start forecast lifecycle')
ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
WITH grants(role_key) AS (VALUES('qs'),('commercial_manager'),('commercial_director'))
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,'land_appraisal.capture' FROM grants g JOIN roles r ON r.key=g.role_key
ON CONFLICT DO NOTHING;
WITH grants(role_key) AS (VALUES('qs'),('commercial_manager'),('commercial_director'))
INSERT INTO role_permissions(role_id,permission_key)
SELECT r.id,'site_start.manage' FROM grants g JOIN roles r ON r.key=g.role_key
ON CONFLICT DO NOTHING;

CREATE TABLE development_land_appraisals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  effective_date DATE NOT NULL,
  reference TEXT NOT NULL CHECK(btrim(reference)<>''),
  approval_reason TEXT NOT NULL CHECK(btrim(approval_reason)<>''),
  source_file_name TEXT,
  source_file_sha256 TEXT,
  evidence_snapshot JSONB NOT NULL CHECK(jsonb_typeof(evidence_snapshot)='object'),
  evidence_hash_scheme TEXT NOT NULL CHECK(evidence_hash_scheme='canonical_json_sha256_v1'),
  evidence_sha256 TEXT NOT NULL CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_role_key TEXT NOT NULL,
  created_permission_key TEXT NOT NULL CHECK(created_permission_key='land_appraisal.capture'),
  is_sealed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,development_id),
  CHECK((source_file_name IS NULL)=(source_file_sha256 IS NULL)),
  CHECK(source_file_sha256 IS NULL OR source_file_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE development_land_appraisal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  appraisal_id UUID NOT NULL REFERENCES development_land_appraisals(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK(line_number>0),
  cost_code_id UUID NOT NULL REFERENCES cost_codes(id) ON DELETE RESTRICT,
  cost_code TEXT NOT NULL CHECK(btrim(cost_code)<>''),
  description TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14,2) NOT NULL CHECK(amount>=0),
  UNIQUE(appraisal_id,line_number), UNIQUE(appraisal_id,cost_code_id)
);
CREATE INDEX idx_land_appraisal_lines_development ON development_land_appraisal_lines(client_id,development_id,cost_code_id);

CREATE OR REPLACE FUNCTION protect_land_appraisal_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP='UPDATE' AND OLD.is_sealed=FALSE AND NEW.is_sealed=TRUE
     AND (to_jsonb(NEW)-'is_sealed')=(to_jsonb(OLD)-'is_sealed') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Land Purchase Appraisal history is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_land_appraisal_immutable BEFORE UPDATE OR DELETE ON development_land_appraisals FOR EACH ROW EXECUTE FUNCTION protect_land_appraisal_history();
CREATE TRIGGER trg_land_appraisal_lines_immutable BEFORE UPDATE OR DELETE ON development_land_appraisal_lines FOR EACH ROW EXECUTE FUNCTION protect_land_appraisal_history();

CREATE OR REPLACE FUNCTION validate_land_appraisal_boundary() RETURNS trigger AS $$ BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.client_id::text),hashtext(NEW.development_id));
  IF NOT EXISTS(SELECT 1 FROM developments d WHERE d.id=NEW.development_id AND d.client_id=NEW.client_id) THEN RAISE EXCEPTION 'Land Appraisal tenant/development boundary is invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM client_user_memberships m JOIN buildlite_users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_key='land_appraisal.capture' WHERE m.id=NEW.created_by_membership_id AND m.user_id=NEW.created_by_user_id AND m.client_id=NEW.client_id AND m.is_active AND u.status='active' AND u.provider_user_id=NEW.created_by_provider_user_id AND u.display_name=NEW.created_by_display_name AND r.key=NEW.created_role_key) THEN RAISE EXCEPTION 'Land Appraisal requires an active authorised membership'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_land_appraisal_boundary BEFORE INSERT ON development_land_appraisals FOR EACH ROW EXECUTE FUNCTION validate_land_appraisal_boundary();

CREATE OR REPLACE FUNCTION validate_land_appraisal_line_boundary() RETURNS trigger AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM development_land_appraisals a WHERE a.id=NEW.appraisal_id AND a.client_id=NEW.client_id AND a.development_id=NEW.development_id AND a.is_sealed=FALSE) THEN RAISE EXCEPTION 'Land Appraisal line creation is limited to the original capture transaction'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cost_codes c WHERE c.id=NEW.cost_code_id AND c.client_id=NEW.client_id AND c.is_active AND c.code=NEW.cost_code) THEN RAISE EXCEPTION 'Land Appraisal requires an active tenant Cost Code identity'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_land_appraisal_line_boundary BEFORE INSERT ON development_land_appraisal_lines FOR EACH ROW EXECUTE FUNCTION validate_land_appraisal_line_boundary();

ALTER TABLE cvr_periods ADD COLUMN period_type TEXT NOT NULL DEFAULT 'monthly_cvr'
  CHECK(period_type IN('monthly_cvr','site_start'));
ALTER TABLE cvr_periods ADD COLUMN forecast_as_at_month DATE;
ALTER TABLE cvr_periods ADD COLUMN site_start_source_snapshot_id UUID REFERENCES cvr_period_snapshots(id) ON DELETE RESTRICT;
ALTER TABLE cvr_periods DROP CONSTRAINT IF EXISTS cvr_periods_budget_source_check;
ALTER TABLE cvr_periods ADD CONSTRAINT cvr_periods_budget_source_check
  CHECK(budget_source IN('legacy_cvr','development_budget','land_appraisal','site_start_budget'));
ALTER TABLE cvr_periods ADD CONSTRAINT chk_cvr_period_type_identity CHECK(
  (period_type='site_start' AND period_key='SITE_START' AND period_label='Site Start' AND reporting_month IS NULL AND forecast_as_at_month IS NOT NULL AND budget_source='land_appraisal' AND site_start_source_snapshot_id IS NULL)
  OR (period_type='monthly_cvr' AND period_key<>'SITE_START' AND forecast_as_at_month IS NULL AND
      ((budget_source='site_start_budget' AND site_start_source_snapshot_id IS NOT NULL) OR
       (budget_source<>'site_start_budget' AND site_start_source_snapshot_id IS NULL)))
);
CREATE UNIQUE INDEX uq_cvr_periods_single_site_start
  ON cvr_periods(client_id,development_id) WHERE period_type='site_start';

-- SS-4A: a v2 milestone is created only by locking a first-class Site Start
-- period. Existing v1 Opening-Budget milestones remain intact and readable.
ALTER TABLE development_budget_milestones
  ADD COLUMN authority_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN site_start_period_id UUID REFERENCES cvr_periods(id) ON DELETE RESTRICT,
  ADD COLUMN site_start_snapshot_id UUID REFERENCES cvr_period_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN land_appraisal_id UUID REFERENCES development_land_appraisals(id) ON DELETE RESTRICT;
ALTER TABLE development_budget_milestones ALTER COLUMN opening_budget_event_id DROP NOT NULL;
ALTER TABLE development_budget_milestones DROP CONSTRAINT IF EXISTS development_budget_milestones_created_permission_key_check;
ALTER TABLE development_budget_milestones ADD CONSTRAINT chk_development_budget_milestone_permission
  CHECK((authority_version=1 AND created_permission_key='development_budget.post') OR
        (authority_version=2 AND created_permission_key='cvr.lock'));
ALTER TABLE development_budget_milestones ADD CONSTRAINT chk_development_budget_milestone_version
  CHECK((authority_version=1 AND opening_budget_event_id IS NOT NULL AND site_start_period_id IS NULL AND site_start_snapshot_id IS NULL AND land_appraisal_id IS NULL) OR
        (authority_version=2 AND opening_budget_event_id IS NULL AND site_start_period_id IS NOT NULL AND site_start_snapshot_id IS NOT NULL AND land_appraisal_id IS NOT NULL));
ALTER TABLE development_budget_milestones DROP CONSTRAINT IF EXISTS development_budget_milestones_client_id_development_id_milest_key;
ALTER TABLE development_budget_milestones DROP CONSTRAINT IF EXISTS development_budget_milestones_client_id_opening_budget_event_id_key;
ALTER TABLE development_budget_milestones DROP CONSTRAINT IF EXISTS development_budget_milestones_client_id_opening_budget_event_id_milestone_key;
CREATE UNIQUE INDEX uq_development_budget_milestone_v1
  ON development_budget_milestones(client_id,development_id,milestone_type) WHERE authority_version=1;
CREATE UNIQUE INDEX uq_development_budget_milestone_v2
  ON development_budget_milestones(client_id,development_id,milestone_type) WHERE authority_version=2;
CREATE UNIQUE INDEX uq_development_budget_milestone_site_start_period
  ON development_budget_milestones(client_id,site_start_period_id) WHERE authority_version=2;
CREATE UNIQUE INDEX uq_development_budget_milestone_site_start_snapshot
  ON development_budget_milestones(client_id,site_start_snapshot_id) WHERE authority_version=2;

CREATE OR REPLACE FUNCTION validate_development_budget_milestone() RETURNS trigger AS $$ BEGIN
  IF NEW.authority_version=1 THEN
    IF NOT EXISTS(SELECT 1 FROM development_budget_events e WHERE e.id=NEW.opening_budget_event_id AND e.client_id=NEW.client_id AND e.development_id=NEW.development_id AND e.event_type='opening_budget') THEN RAISE EXCEPTION 'Site Start Budget must reference this Development''s Opening Budget'; END IF;
  ELSIF NEW.authority_version=2 THEN
    IF NOT EXISTS(SELECT 1 FROM cvr_periods p JOIN cvr_period_snapshots s ON s.period_id=p.id AND s.id=NEW.site_start_snapshot_id AND s.client_id=p.client_id AND s.development_id=p.development_id WHERE p.id=NEW.site_start_period_id AND p.client_id=NEW.client_id AND p.development_id=NEW.development_id AND p.period_type='site_start') THEN RAISE EXCEPTION 'Site Start Budget v2 requires this Development''s Site Start snapshot'; END IF;
    IF NOT EXISTS(SELECT 1 FROM development_land_appraisals a WHERE a.id=NEW.land_appraisal_id AND a.client_id=NEW.client_id AND a.development_id=NEW.development_id) THEN RAISE EXCEPTION 'Site Start Budget v2 requires this Development''s Land Appraisal'; END IF;
  ELSE RAISE EXCEPTION 'Unsupported Site Start Budget authority version';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM client_user_memberships m JOIN buildlite_users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_key=NEW.created_permission_key WHERE m.id=NEW.created_by_membership_id AND m.user_id=NEW.created_by_user_id AND m.client_id=NEW.client_id AND m.is_active AND u.status='active' AND u.provider_user_id=NEW.created_by_provider_user_id AND u.display_name=NEW.created_by_display_name AND r.key=NEW.created_role_key) THEN RAISE EXCEPTION 'Site Start Budget requires an active authorised membership'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
