-- Slice 2: no backfill, notice issue, dispatch or payment writes.
CREATE TABLE payment_notice_instructions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 decision_id UUID NOT NULL REFERENCES payment_authority_decisions(id) ON DELETE RESTRICT,
 certificate_id UUID NOT NULL REFERENCES package_payment_certificates(id) ON DELETE RESTRICT,
 package_id UUID NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
 deadline_snapshot_id UUID REFERENCES package_payment_certificate_deadline_snapshots(id) ON DELETE RESTRICT,
 outcome TEXT NOT NULL CHECK(outcome IN ('prepare','exception','existing_notice','not_required')),
 notice_type TEXT NOT NULL DEFAULT 'payment_notice' CHECK(notice_type='payment_notice'),
 notified_sum NUMERIC(18,2), basis TEXT,
 authority JSONB NOT NULL CHECK(jsonb_typeof(authority)='object'),
 authority_sha256 TEXT NOT NULL CHECK(authority_sha256 ~ '^[0-9a-f]{64}$'),
 hash_scheme TEXT NOT NULL CHECK(hash_scheme='canonical_json_sha256_v1'),
 owner_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(client_id,id), UNIQUE(client_id,decision_id),
 CHECK(outcome<>'prepare' OR (notified_sum IS NOT NULL AND basis IS NOT NULL AND length(btrim(basis))>0 AND deadline_snapshot_id IS NOT NULL))
);
CREATE UNIQUE INDEX payment_notice_one_initial_instruction ON payment_notice_instructions(client_id,certificate_id) WHERE outcome='prepare';
CREATE TABLE payment_notice_preparation_jobs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 instruction_id UUID NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0),
 available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 lease_token UUID, lease_until TIMESTAMPTZ,
 document_id UUID,
 failures JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(failures)='array'),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 FOREIGN KEY(client_id,instruction_id) REFERENCES payment_notice_instructions(client_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(client_id,document_id) REFERENCES commercial_documents(client_id,id) ON DELETE RESTRICT,
 UNIQUE(client_id,instruction_id),
 CHECK((status='running')=(lease_token IS NOT NULL AND lease_until IS NOT NULL)),
 CHECK((status='completed')=(document_id IS NOT NULL))
);
CREATE INDEX payment_notice_preparation_pending ON payment_notice_preparation_jobs(status,available_at,lease_until);
CREATE UNIQUE INDEX payment_notice_instruction_document ON commercial_documents(client_id,source_authority_id)
 WHERE source_authority_type='authorised_payment_notice_instruction';
CREATE FUNCTION guard_payment_notice_instruction() RETURNS trigger AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Notice instructions are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM payment_authority_decisions d JOIN package_payment_certificates c
 ON c.id=d.certificate_id AND c.client_id=d.client_id JOIN client_user_memberships m
 ON m.id=NEW.owner_membership_id AND m.client_id=d.client_id
 WHERE d.id=NEW.decision_id AND d.client_id=NEW.client_id AND d.certificate_id=NEW.certificate_id
 AND d.package_id=NEW.package_id AND d.decision_kind='authority' AND c.status='locked'
 AND d.approved_by_membership_id=m.id) THEN RAISE EXCEPTION 'Notice instruction tenant/approval mismatch'; END IF;
 IF NEW.deadline_snapshot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM package_payment_certificate_deadline_snapshots s
 WHERE s.id=NEW.deadline_snapshot_id AND s.client_id=NEW.client_id AND s.certificate_id=NEW.certificate_id
 AND s.package_id=NEW.package_id AND s.stage='locked') THEN RAISE EXCEPTION 'Notice deadline provenance mismatch'; END IF;
 IF NEW.outcome='prepare' AND EXISTS(SELECT 1 FROM package_payment_notices n WHERE n.client_id=NEW.client_id
  AND n.certificate_id=NEW.certificate_id AND n.notice_type='payment_notice' AND n.status NOT IN ('voided','superseded')) THEN
  RAISE EXCEPTION 'Existing notice evidence prevents a duplicate initial instruction'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER payment_notice_instruction_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_notice_instructions
 FOR EACH ROW EXECUTE FUNCTION guard_payment_notice_instruction();
CREATE FUNCTION guard_notice_preparation_document() RETURNS trigger AS $$
BEGIN
 IF NEW.source_authority_type='authorised_payment_notice_instruction' THEN
  IF NEW.status<>'generated' OR NEW.issued_at IS NOT NULL OR NEW.issued_by IS NOT NULL THEN
   RAISE EXCEPTION 'Slice 2 prepared documents must remain unissued';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM payment_notice_instructions i WHERE i.id=NEW.source_authority_id
   AND i.client_id=NEW.client_id AND i.package_id=NEW.package_id AND i.certificate_id=NEW.certificate_id
   AND i.outcome='prepare') THEN RAISE EXCEPTION 'Document instruction provenance mismatch'; END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER notice_preparation_document_guard BEFORE INSERT OR UPDATE ON commercial_documents
 FOR EACH ROW EXECUTE FUNCTION guard_notice_preparation_document();
CREATE FUNCTION guard_notice_preparation_job() RETURNS trigger AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.client_id IS DISTINCT FROM NEW.client_id OR OLD.instruction_id IS DISTINCT FROM NEW.instruction_id
   OR OLD.id IS DISTINCT FROM NEW.id OR OLD.status='completed' THEN RAISE EXCEPTION 'Preparation identity/completion is immutable'; END IF;
  IF jsonb_array_length(NEW.failures)<jsonb_array_length(OLD.failures) OR
   (SELECT COALESCE(jsonb_agg(value ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(NEW.failures) WITH ORDINALITY a(value,ord)
    WHERE ord<=jsonb_array_length(OLD.failures)) IS DISTINCT FROM OLD.failures THEN RAISE EXCEPTION 'Preparation failure history is append-only'; END IF;
 END IF;
 IF NEW.status IN ('pending','running') AND EXISTS(
  SELECT 1 FROM payment_notice_instructions i WHERE i.id=NEW.instruction_id AND i.client_id=NEW.client_id
   AND (EXISTS(SELECT 1 FROM package_payment_notices n WHERE n.client_id=i.client_id AND n.certificate_id=i.certificate_id AND n.notice_type='payment_notice')
    OR EXISTS(SELECT 1 FROM payment_authority_decisions r WHERE r.client_id=i.client_id AND r.reverses_decision_id=i.decision_id))) THEN
  RAISE EXCEPTION 'Manual notice history or reversed approval prevents automated preparation';
 END IF;
 IF NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM commercial_documents d WHERE d.id=NEW.document_id
  AND d.client_id=NEW.client_id AND d.source_authority_type='authorised_payment_notice_instruction'
  AND d.source_authority_id=NEW.instruction_id AND d.status='generated') THEN RAISE EXCEPTION 'Preparation document mismatch'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER notice_preparation_job_guard BEFORE INSERT OR UPDATE ON payment_notice_preparation_jobs
 FOR EACH ROW EXECUTE FUNCTION guard_notice_preparation_job();
CREATE FUNCTION guard_notice_preparation_overlap() RETURNS trigger AS $$
DECLARE instruction RECORD; job RECORD; reversed BOOLEAN;
BEGIN
 IF NEW.notice_type='payment_notice' AND NEW.status NOT IN ('voided','superseded') THEN
  PERFORM 1 FROM package_payment_certificates WHERE id=NEW.certificate_id AND client_id=NEW.client_id FOR UPDATE;
  FOR instruction IN SELECT i.* FROM payment_notice_instructions i WHERE i.client_id=NEW.client_id AND i.certificate_id=NEW.certificate_id AND i.outcome='prepare' LOOP
   SELECT * INTO job FROM payment_notice_preparation_jobs j WHERE j.client_id=instruction.client_id AND j.instruction_id=instruction.id FOR UPDATE;
   SELECT EXISTS(SELECT 1 FROM payment_authority_decisions r WHERE r.client_id=instruction.client_id AND r.reverses_decision_id=instruction.decision_id) INTO reversed;
   IF NOT reversed AND COALESCE(job.status,'')<>'failed' THEN
    RAISE EXCEPTION 'Initial notice preparation is active or completed; competing manual notice creation is blocked';
   END IF;
   IF job.status IN ('pending','running') THEN
    UPDATE payment_notice_preparation_jobs SET status='failed',lease_token=NULL,lease_until=NULL,updated_at=NOW(),
     failures=failures || jsonb_build_array(jsonb_build_object('at',NOW(),'reason','Manual recovery after approval reversal fenced automated preparation','noticeId',NEW.id,'previousStatus',job.status))
     WHERE id=job.id AND client_id=NEW.client_id;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER notice_preparation_overlap_guard BEFORE INSERT ON package_payment_notices
 FOR EACH ROW EXECUTE FUNCTION guard_notice_preparation_overlap();
CREATE FUNCTION audit_notice_preparation_recovery() RETURNS trigger AS $$
BEGIN
 IF NEW.notice_type='payment_notice' THEN
  INSERT INTO package_payment_notice_audit(client_id,notice_id,action,actor,detail)
   SELECT NEW.client_id,NEW.id,'manual_preparation_recovery',NEW.created_by,
    jsonb_build_object('instructionId',i.id,'approvalDecisionId',i.decision_id,'jobId',j.id,'jobStatus',j.status,
      'reversalIds',(SELECT COALESCE(jsonb_agg(r.id),'[]'::jsonb) FROM payment_authority_decisions r WHERE r.client_id=i.client_id AND r.reverses_decision_id=i.decision_id))
   FROM payment_notice_instructions i LEFT JOIN payment_notice_preparation_jobs j ON j.client_id=i.client_id AND j.instruction_id=i.id
   WHERE i.client_id=NEW.client_id AND i.certificate_id=NEW.certificate_id AND i.outcome='prepare';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER notice_preparation_recovery_audit AFTER INSERT ON package_payment_notices
 FOR EACH ROW EXECUTE FUNCTION audit_notice_preparation_recovery();
