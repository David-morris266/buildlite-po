-- 024_variation_order_normal_source.sql
-- Current one-approved-CE-to-one-normal-VO UX concurrency guard.
-- Corrective and future allocated/consolidated links continue to use the linkage table.

ALTER TABLE variation_orders
  ADD COLUMN IF NOT EXISTS normal_source_commercial_event_id TEXT
  REFERENCES commercial_events(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_variation_orders_client_normal_source_ce
  ON variation_orders (client_id, normal_source_commercial_event_id)
  WHERE normal_source_commercial_event_id IS NOT NULL AND status <> 'rejected';
