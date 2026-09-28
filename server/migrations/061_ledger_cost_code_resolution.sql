-- GP10-008: separate immutable accounting Cost Code evidence from Company Cost Code allocation.

INSERT INTO permissions(key, description)
VALUES ('ledger.manage', 'Import, reverse and resolve Purchase Ledger transactions')
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

WITH grants(role_key, permission_key) AS (
  VALUES
    ('admin', 'ledger.manage'),
    ('commercial_director', 'ledger.manage'),
    ('commercial_manager', 'ledger.manage'),
    ('qs', 'ledger.manage')
)
INSERT INTO role_permissions(role_id, permission_key)
SELECT roles.id, grants.permission_key
FROM grants
JOIN roles ON roles.key = grants.role_key
ON CONFLICT DO NOTHING;

ALTER TABLE ledger_transactions
  ADD COLUMN source_cost_code_key TEXT,
  ADD COLUMN resolved_cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  ADD COLUMN resolution_status TEXT,
  ADD COLUMN resolution_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by_user_id UUID REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  ADD COLUMN resolved_by_membership_id UUID REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  ADD COLUMN resolved_by_provider_user_id TEXT,
  ADD COLUMN resolved_by_display_name TEXT;

UPDATE ledger_transactions
SET source_cost_code_key = cost_code_key;

UPDATE ledger_transactions transaction
SET resolved_cost_code_id = code.id,
    resolution_status = 'resolved'
FROM cost_codes code
WHERE code.client_id = transaction.client_id
  AND lower(btrim(code.code)) = lower(btrim(transaction.cost_code_key))
  AND code.is_active = TRUE
  AND code.allow_ledger_import = TRUE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ledger_transactions
    WHERE resolved_cost_code_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 061 cannot safely resolve every historic ledger transaction to an active ledger-eligible Company Cost Code.';
  END IF;
END $$;

ALTER TABLE ledger_transactions
  ALTER COLUMN source_cost_code_key SET NOT NULL,
  ALTER COLUMN resolution_status SET NOT NULL,
  ADD CONSTRAINT chk_ledger_source_cost_code
    CHECK (char_length(btrim(source_cost_code_key)) BETWEEN 1 AND 64),
  ADD CONSTRAINT chk_ledger_resolution_status
    CHECK (resolution_status IN ('resolved', 'unresolved')),
  ADD CONSTRAINT chk_ledger_resolution_consistency
    CHECK (
      (resolution_status = 'resolved' AND resolved_cost_code_id IS NOT NULL)
      OR
      (resolution_status = 'unresolved' AND resolved_cost_code_id IS NULL)
    ),
  ADD CONSTRAINT chk_ledger_resolution_version CHECK (resolution_version > 0);

CREATE INDEX idx_ledger_transactions_resolution
  ON ledger_transactions(client_id, development_id, resolution_status, transaction_date DESC);

CREATE INDEX idx_ledger_transactions_resolved_cost_code
  ON ledger_transactions(client_id, development_id, resolved_cost_code_id);

CREATE TABLE ledger_cost_code_resolution_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id) ON DELETE RESTRICT,
  prior_resolved_cost_code_id UUID REFERENCES cost_codes(id) ON DELETE RESTRICT,
  resolved_cost_code_id UUID NOT NULL REFERENCES cost_codes(id) ON DELETE RESTRICT,
  source_cost_code_key TEXT NOT NULL,
  prior_resolution_version INTEGER NOT NULL,
  resolution_version INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL CHECK (permission_key = 'ledger.manage'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_resolution_audit_transaction
  ON ledger_cost_code_resolution_audit(client_id, development_id, transaction_id, created_at DESC);

CREATE OR REPLACE FUNCTION protect_ledger_resolution_audit()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger Cost Code resolution audit is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_resolution_audit_immutable
BEFORE UPDATE OR DELETE ON ledger_cost_code_resolution_audit
FOR EACH ROW EXECUTE FUNCTION protect_ledger_resolution_audit();

CREATE OR REPLACE FUNCTION protect_ledger_source_evidence()
RETURNS trigger AS $$
BEGIN
  IF NEW.source_cost_code_key IS DISTINCT FROM OLD.source_cost_code_key
     OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint THEN
    RAISE EXCEPTION 'Ledger source Cost Code and fingerprint are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_source_evidence_immutable
BEFORE UPDATE ON ledger_transactions
FOR EACH ROW EXECUTE FUNCTION protect_ledger_source_evidence();
