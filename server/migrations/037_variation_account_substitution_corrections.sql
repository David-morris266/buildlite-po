-- Allow immutable, additive correction facts for an existing VA authority
-- predecessor/successor pair. No history is rewritten or backfilled.

DO $$
DECLARE pair_constraint TEXT;
BEGIN
  SELECT conname INTO pair_constraint
  FROM pg_constraint
  WHERE conrelid = 'package_variation_account_authority_substitutions'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) = 'UNIQUE (client_id, successor_allocation_id, predecessor_allocation_id)';

  IF pair_constraint IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE package_variation_account_authority_substitutions DROP CONSTRAINT %I',
      pair_constraint
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_va_authority_substitutions_pair
  ON package_variation_account_authority_substitutions(
    client_id,
    successor_allocation_id,
    predecessor_allocation_id,
    created_at,
    id
  );

CREATE OR REPLACE FUNCTION validate_va_authority_substitution_boundary() RETURNS trigger AS $$
DECLARE
  successor package_variation_account_authority_allocations%ROWTYPE;
  predecessor package_variation_account_authority_allocations%ROWTYPE;
  predecessor_consumed NUMERIC(14,2);
  successor_supported NUMERIC(14,2);
BEGIN
  SELECT * INTO successor
  FROM package_variation_account_authority_allocations
  WHERE id=NEW.successor_allocation_id
    AND client_id=NEW.client_id
    AND package_id=NEW.package_id
    AND variation_account_item_id=NEW.variation_account_item_id;

  SELECT * INTO predecessor
  FROM package_variation_account_authority_allocations
  WHERE id=NEW.predecessor_allocation_id
    AND client_id=NEW.client_id
    AND package_id=NEW.package_id
    AND variation_account_item_id=NEW.variation_account_item_id;

  IF successor.id IS NULL OR predecessor.id IS NULL OR successor.id=predecessor.id THEN
    RAISE EXCEPTION 'VA authority substitution boundary is invalid';
  END IF;

  IF sign(NEW.signed_substituted_amount)<>sign(successor.signed_allocated_amount)
     OR sign(NEW.signed_substituted_amount)<>sign(predecessor.signed_allocated_amount) THEN
    RAISE EXCEPTION 'VA authority substitution sign must match both allocations';
  END IF;

  SELECT COALESCE(SUM(ABS(signed_substituted_amount)),0) INTO predecessor_consumed
  FROM package_variation_account_authority_substitutions
  WHERE client_id=NEW.client_id
    AND predecessor_allocation_id=NEW.predecessor_allocation_id;

  IF predecessor_consumed + ABS(NEW.signed_substituted_amount) > ABS(predecessor.signed_allocated_amount) THEN
    RAISE EXCEPTION 'VA authority substitution exceeds predecessor authority';
  END IF;

  SELECT COALESCE(SUM(ABS(signed_substituted_amount)),0) INTO successor_supported
  FROM package_variation_account_authority_substitutions
  WHERE client_id=NEW.client_id
    AND successor_allocation_id=NEW.successor_allocation_id;

  IF successor_supported + ABS(NEW.signed_substituted_amount) > ABS(successor.signed_allocated_amount) THEN
    RAISE EXCEPTION 'VA authority substitution exceeds successor authority';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
