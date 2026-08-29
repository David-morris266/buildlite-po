-- 025_variation_order_line_ce_allocations.sql
-- Explicit immutable authority bridge from source Commercial Events to VO lines.

CREATE TABLE IF NOT EXISTS variation_order_line_commercial_event_allocations (
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  variation_order_id UUID NOT NULL REFERENCES variation_orders(id) ON DELETE CASCADE,
  variation_order_line_id UUID NOT NULL REFERENCES variation_order_lines(id) ON DELETE CASCADE,
  commercial_event_id TEXT NOT NULL REFERENCES commercial_events(id) ON DELETE RESTRICT,
  allocated_value NUMERIC(14,2) NOT NULL,
  historic_certified_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  allocation_method TEXT NOT NULL DEFAULT 'explicit'
    CHECK (allocation_method IN ('explicit', 'single_line_auto')),
  historic_allocation_method TEXT NOT NULL DEFAULT 'explicit'
    CHECK (historic_allocation_method IN ('explicit', 'zero_auto', 'single_line_auto')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  PRIMARY KEY (variation_order_line_id, commercial_event_id),
  CONSTRAINT chk_vo_line_ce_allocation_nonzero CHECK (allocated_value <> 0),
  CONSTRAINT chk_vo_line_ce_historic_within_authority
    CHECK (abs(historic_certified_value) <= abs(allocated_value))
);

CREATE INDEX IF NOT EXISTS idx_vo_line_ce_allocations_vo
  ON variation_order_line_commercial_event_allocations (client_id, variation_order_id);

CREATE INDEX IF NOT EXISTS idx_vo_line_ce_allocations_ce
  ON variation_order_line_commercial_event_allocations (client_id, commercial_event_id);
