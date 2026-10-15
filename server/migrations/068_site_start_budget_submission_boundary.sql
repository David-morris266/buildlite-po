-- GP-PILOT-08E: permit governed monthly CVRs to capture their approved
-- Site Start Budget source while retaining the original tenant/development/
-- period boundary and rejecting evidence for the wrong authority type.
CREATE OR REPLACE FUNCTION validate_cvr_budget_submission_boundary() RETURNS trigger AS $$
DECLARE
  period_budget_source TEXT;
  period_site_start_snapshot_id UUID;
  evidence_schema_version TEXT;
BEGIN
  SELECT p.budget_source, p.site_start_source_snapshot_id
    INTO period_budget_source, period_site_start_snapshot_id
  FROM cvr_periods p
  WHERE p.id=NEW.period_id
    AND p.client_id=NEW.client_id
    AND p.development_id=NEW.development_id;

  IF period_budget_source IS NULL THEN
    RAISE EXCEPTION 'CVR budget submission boundary is invalid';
  END IF;

  evidence_schema_version := NEW.source_snapshot->>'schemaVersion';

  IF period_budget_source='development_budget' THEN
    IF evidence_schema_version IS DISTINCT FROM 'cvr_development_budget_source_v1' THEN
      RAISE EXCEPTION 'CVR budget submission authority is invalid';
    END IF;
  ELSIF period_budget_source='site_start_budget' THEN
    IF evidence_schema_version IS DISTINCT FROM 'cvr_site_start_budget_source_v1'
       OR period_site_start_snapshot_id IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM development_budget_milestones m
         WHERE m.client_id=NEW.client_id
           AND m.development_id=NEW.development_id
           AND m.milestone_type='site_start_budget'
           AND m.authority_version=2
           AND m.site_start_snapshot_id=period_site_start_snapshot_id
       ) THEN
      RAISE EXCEPTION 'CVR Site Start Budget submission authority is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'CVR budget submission source is invalid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
