-- GP-5A.2: immutable Development Budget Authority journal. Additive; zero backfill.

CREATE TABLE development_budget_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  sequence_number INTEGER NOT NULL CHECK(sequence_number > 0),
  event_type TEXT NOT NULL CHECK(event_type IN('opening_budget','opening_adjustment','addition','omission','transfer','correction','reversal')),
  effective_date DATE NOT NULL,
  reference TEXT NOT NULL CHECK(btrim(reference) <> ''),
  reason TEXT NOT NULL CHECK(btrim(reason) <> ''),
  reverses_event_id UUID REFERENCES development_budget_events(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK(btrim(idempotency_key) <> ''),
  source_snapshot JSONB NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL CHECK(source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  source_snapshot_hash_scheme TEXT NOT NULL CHECK(source_snapshot_hash_scheme='canonical_json_sha256_v1'),
  created_by_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  created_by_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  created_by_provider_user_id TEXT NOT NULL,
  created_by_display_name TEXT NOT NULL,
  created_role_key TEXT NOT NULL,
  created_permission_key TEXT NOT NULL CHECK(created_permission_key='development_budget.post'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(client_id,development_id,sequence_number),
  UNIQUE(client_id,development_id,idempotency_key),
  CHECK((event_type='reversal')=(reverses_event_id IS NOT NULL))
);
CREATE UNIQUE INDEX uq_development_budget_single_reversal ON development_budget_events(client_id,reverses_event_id) WHERE reverses_event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_development_budget_single_opening ON development_budget_events(client_id,development_id) WHERE event_type='opening_budget';
CREATE INDEX idx_development_budget_events_history ON development_budget_events(client_id,development_id,sequence_number);

CREATE TABLE development_budget_event_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  event_id UUID NOT NULL REFERENCES development_budget_events(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK(line_number > 0),
  cost_code_id UUID NOT NULL REFERENCES cost_codes(id) ON DELETE RESTRICT,
  signed_amount NUMERIC(14,2) NOT NULL CHECK(signed_amount <> 0),
  explanation TEXT,
  UNIQUE(event_id,line_number)
);
CREATE INDEX idx_development_budget_lines_code ON development_budget_event_lines(client_id,development_id,cost_code_id);

CREATE OR REPLACE FUNCTION protect_development_budget_history() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Development Budget Authority history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_development_budget_events_immutable BEFORE UPDATE OR DELETE ON development_budget_events FOR EACH ROW EXECUTE FUNCTION protect_development_budget_history();
CREATE TRIGGER trg_development_budget_lines_immutable BEFORE UPDATE OR DELETE ON development_budget_event_lines FOR EACH ROW EXECUTE FUNCTION protect_development_budget_history();

CREATE OR REPLACE FUNCTION validate_development_budget_event_boundary() RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.client_id::text),hashtext(NEW.development_id));
  IF NOT EXISTS(SELECT 1 FROM developments d WHERE d.id=NEW.development_id AND d.client_id=NEW.client_id) THEN
    RAISE EXCEPTION 'Development Budget event tenant/development boundary is invalid';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM client_user_memberships m JOIN buildlite_users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id JOIN role_permissions rp ON rp.role_id=r.id AND rp.permission_key='development_budget.post' WHERE m.id=NEW.created_by_membership_id AND m.user_id=NEW.created_by_user_id AND m.client_id=NEW.client_id AND m.is_active AND u.status='active' AND u.provider_user_id=NEW.created_by_provider_user_id AND u.display_name=NEW.created_by_display_name AND r.key=NEW.created_role_key) THEN
    RAISE EXCEPTION 'Development Budget event requires an active authorised membership';
  END IF;
  IF NEW.sequence_number <> COALESCE((SELECT MAX(e.sequence_number)+1 FROM development_budget_events e WHERE e.client_id=NEW.client_id AND e.development_id=NEW.development_id),1) THEN
    RAISE EXCEPTION 'Development Budget event sequence is invalid';
  END IF;
  IF NEW.reverses_event_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM development_budget_events e WHERE e.id=NEW.reverses_event_id AND e.client_id=NEW.client_id AND e.development_id=NEW.development_id AND e.event_type NOT IN('opening_budget','reversal')) THEN
    RAISE EXCEPTION 'Development Budget reversal boundary is invalid';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_development_budget_event_boundary BEFORE INSERT ON development_budget_events FOR EACH ROW EXECUTE FUNCTION validate_development_budget_event_boundary();

CREATE OR REPLACE FUNCTION validate_development_budget_line_boundary() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM development_budget_events e WHERE e.id=NEW.event_id AND e.client_id=NEW.client_id AND e.development_id=NEW.development_id) THEN RAISE EXCEPTION 'Development Budget line event boundary is invalid'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cost_codes c WHERE c.id=NEW.cost_code_id AND c.client_id=NEW.client_id AND c.is_active) THEN RAISE EXCEPTION 'Development Budget line requires an active tenant Cost Code Master record'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_development_budget_line_boundary BEFORE INSERT ON development_budget_event_lines FOR EACH ROW EXECUTE FUNCTION validate_development_budget_line_boundary();

CREATE OR REPLACE FUNCTION validate_development_budget_line_snapshot() RETURNS trigger AS $$
DECLARE snapshot_line JSONB;
BEGIN
  SELECT item INTO snapshot_line
  FROM development_budget_events e,
       jsonb_array_elements(e.source_snapshot->'lines') item
  WHERE e.id=NEW.event_id
    AND (item->>'lineNumber')::INTEGER=NEW.line_number;
  IF snapshot_line IS NULL
     OR snapshot_line->>'costCodeId'<>NEW.cost_code_id::text
     OR (snapshot_line->>'amountPence')::BIGINT<>(NEW.signed_amount*100)::BIGINT THEN
    RAISE EXCEPTION 'Development Budget line does not match its frozen source snapshot';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_development_budget_line_snapshot BEFORE INSERT ON development_budget_event_lines FOR EACH ROW EXECUTE FUNCTION validate_development_budget_line_snapshot();

CREATE OR REPLACE FUNCTION validate_development_budget_event_complete() RETURNS trigger AS $$
DECLARE line_count INTEGER; line_total NUMERIC(14,2); invalid_count INTEGER;
BEGIN
  SELECT COUNT(*),COALESCE(SUM(signed_amount),0) INTO line_count,line_total FROM development_budget_event_lines WHERE event_id=NEW.id;
  IF line_count=0 THEN RAISE EXCEPTION 'Development Budget event requires at least one line'; END IF;
  IF NEW.event_type='transfer' AND (line_count<2 OR line_total<>0) THEN RAISE EXCEPTION 'Development Budget transfer must net exactly to zero'; END IF;
  IF NEW.event_type IN('opening_budget','addition') AND EXISTS(SELECT 1 FROM development_budget_event_lines WHERE event_id=NEW.id AND signed_amount<=0) THEN RAISE EXCEPTION 'Development Budget positive event has an invalid line sign'; END IF;
  IF NEW.event_type='omission' AND EXISTS(SELECT 1 FROM development_budget_event_lines WHERE event_id=NEW.id AND signed_amount>=0) THEN RAISE EXCEPTION 'Development Budget omission has an invalid line sign'; END IF;
  IF NEW.event_type='opening_budget' AND (SELECT COUNT(*) FROM development_budget_events o WHERE o.client_id=NEW.client_id AND o.development_id=NEW.development_id AND o.event_type='opening_budget' AND NOT EXISTS(SELECT 1 FROM development_budget_events r WHERE r.reverses_event_id=o.id))>1 THEN RAISE EXCEPTION 'Only one active Opening Budget is permitted'; END IF;
  IF NEW.event_type='reversal' THEN
    SELECT COUNT(*) INTO invalid_count FROM (
      SELECT COALESCE(a.cost_code_id,b.cost_code_id) cost_code_id,COALESCE(a.amount,0)+COALESCE(b.amount,0) balance
      FROM (SELECT cost_code_id,SUM(signed_amount) amount FROM development_budget_event_lines WHERE event_id=NEW.reverses_event_id GROUP BY cost_code_id) a
      FULL JOIN (SELECT cost_code_id,SUM(signed_amount) amount FROM development_budget_event_lines WHERE event_id=NEW.id GROUP BY cost_code_id) b USING(cost_code_id)
    ) x WHERE balance<>0;
    IF invalid_count<>0 THEN RAISE EXCEPTION 'Development Budget reversal must exactly negate the reversed event'; END IF;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_development_budget_event_complete AFTER INSERT ON development_budget_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_development_budget_event_complete();

CREATE OR REPLACE FUNCTION validate_development_budget_lines_complete() RETURNS trigger AS $$
DECLARE persisted_count INTEGER; snapshot_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO persisted_count FROM development_budget_event_lines WHERE event_id=NEW.event_id;
  SELECT jsonb_array_length(e.source_snapshot->'lines') INTO snapshot_count FROM development_budget_events e WHERE e.id=NEW.event_id;
  IF persisted_count<>snapshot_count THEN
    RAISE EXCEPTION 'Development Budget lines do not match the frozen source snapshot';
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER trg_development_budget_lines_complete AFTER INSERT ON development_budget_event_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_development_budget_lines_complete();

INSERT INTO permissions(key,description) VALUES('development_budget.post','Post immutable Development Budget Authority events') ON CONFLICT(key) DO UPDATE SET description=EXCLUDED.description;
WITH grants(role_key) AS (VALUES('qs'),('commercial_manager'),('commercial_director'))
INSERT INTO role_permissions(role_id,permission_key) SELECT r.id,'development_budget.post' FROM grants g JOIN roles r ON r.key=g.role_key ON CONFLICT DO NOTHING;
