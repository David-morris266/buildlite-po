-- 071_tenant_purchase_order_numbering.sql
-- Tenant-scoped Purchase Order identity and transactional S/M/P allocation.

DO $$
DECLARE
  unexpected_fks TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE client_id IS NULL) THEN
    RAISE EXCEPTION 'Migration 071 blocked: purchase_orders contains null client_id values';
  END IF;

  IF EXISTS (
    SELECT 1 FROM purchase_orders
    GROUP BY client_id, po_number HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Migration 071 blocked: duplicate tenant Purchase Order numbers exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM purchase_order_terms_overrides t
    LEFT JOIN purchase_orders p
      ON p.client_id=t.client_id AND p.po_number=t.po_number
    WHERE p.po_number IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 071 blocked: orphan or cross-tenant Purchase Order terms overrides exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM purchase_order_terms_bindings t
    LEFT JOIN purchase_orders p
      ON p.client_id=t.client_id AND p.po_number=t.po_number
    WHERE p.po_number IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 071 blocked: orphan or cross-tenant Purchase Order terms bindings exist';
  END IF;

  SELECT string_agg(format('%I.%I', ns.nspname, c.conname), ', ' ORDER BY ns.nspname, c.conname)
  INTO unexpected_fks
  FROM pg_constraint c
  JOIN pg_class target ON target.oid=c.confrelid
  JOIN pg_namespace ns ON ns.oid=c.connamespace
  WHERE c.contype='f'
    AND target.oid='purchase_orders'::regclass
    AND c.conname NOT IN (
      'purchase_order_terms_overrides_po_number_fkey',
      'purchase_order_terms_bindings_po_number_fkey'
    );

  IF unexpected_fks IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 071 blocked: unexpected purchase_orders foreign keys: %', unexpected_fks;
  END IF;
END $$;

ALTER TABLE purchase_order_terms_overrides
  DROP CONSTRAINT purchase_order_terms_overrides_po_number_fkey;
ALTER TABLE purchase_order_terms_bindings
  DROP CONSTRAINT purchase_order_terms_bindings_po_number_fkey;

DROP INDEX IF EXISTS uq_purchase_orders_client_po_number;
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_pkey;
ALTER TABLE purchase_orders ALTER COLUMN client_id SET NOT NULL;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (client_id, po_number);

ALTER TABLE purchase_order_terms_overrides
  ADD CONSTRAINT purchase_order_terms_overrides_po_number_fkey
  FOREIGN KEY (client_id, po_number)
  REFERENCES purchase_orders(client_id, po_number) ON DELETE CASCADE;
ALTER TABLE purchase_order_terms_bindings
  ADD CONSTRAINT purchase_order_terms_bindings_po_number_fkey
  FOREIGN KEY (client_id, po_number)
  REFERENCES purchase_orders(client_id, po_number) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS purchase_order_number_sequences (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL CHECK (order_type IN ('S','M','P')),
  next_number BIGINT NOT NULL CHECK (next_number > 0),
  PRIMARY KEY (client_id, order_type)
);
INSERT INTO purchase_order_number_sequences(client_id, order_type, next_number)
SELECT client_id, substring(po_number FROM 1 FOR 1),
       MAX(substring(po_number FROM 2)::BIGINT) + 1
FROM purchase_orders
WHERE po_number ~ '^[SMP][0-9]{4,}$'
GROUP BY client_id, substring(po_number FROM 1 FOR 1)
ON CONFLICT (client_id, order_type) DO UPDATE
SET next_number = GREATEST(
  purchase_order_number_sequences.next_number,
  EXCLUDED.next_number
);
