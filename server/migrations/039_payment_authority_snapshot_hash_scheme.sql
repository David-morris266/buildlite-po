-- VA-4A integrity correction: version deterministic Payment Authority snapshot hashing.
-- Existing decisions remain NULL/legacy; no historic hash is relabelled or rewritten.

ALTER TABLE payment_authority_decisions
  ADD COLUMN source_snapshot_hash_scheme TEXT
  CHECK (source_snapshot_hash_scheme IS NULL OR source_snapshot_hash_scheme = 'canonical_json_sha256_v1');

CREATE OR REPLACE FUNCTION require_payment_authority_hash_scheme() RETURNS trigger AS $$
BEGIN
  IF NEW.source_snapshot_hash_scheme IS NULL THEN
    RAISE EXCEPTION 'New Payment Authority decisions require a source snapshot hash scheme';
  END IF;
  IF NEW.source_snapshot_hash_scheme <> 'canonical_json_sha256_v1' THEN
    RAISE EXCEPTION 'Unsupported Payment Authority source snapshot hash scheme';
  END IF;
  IF NEW.source_snapshot_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Payment Authority source snapshot SHA-256 is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_authority_hash_scheme
  BEFORE INSERT ON payment_authority_decisions
  FOR EACH ROW EXECUTE FUNCTION require_payment_authority_hash_scheme();
