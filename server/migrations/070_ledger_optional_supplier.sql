-- Permit honest supplier-less Purchase Ledger journals while retaining the
-- existing non-null representation and supplier length protection.

ALTER TABLE ledger_transactions
  DROP CONSTRAINT IF EXISTS chk_ledger_transactions_supplier;

ALTER TABLE ledger_transactions
  ADD CONSTRAINT chk_ledger_transactions_supplier
    CHECK (
      supplier = ''
      OR char_length(btrim(supplier)) BETWEEN 1 AND 200
    );
