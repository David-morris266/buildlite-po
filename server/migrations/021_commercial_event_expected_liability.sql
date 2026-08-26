-- 021_commercial_event_expected_liability.sql
-- BL-038B — CE expected-liability treatment/override/audit foundation (additive).
-- Does NOT change CVR close, snapshots, periods, or overlay money.
-- Does NOT backfill expected amounts. Default treatment is derived at read time.
-- Do not apply to buildlite_clone in this slice.

ALTER TABLE commercial_events
  ADD COLUMN IF NOT EXISTS expected_treatment TEXT NOT NULL DEFAULT 'default';

ALTER TABLE commercial_events
  ADD COLUMN IF NOT EXISTS expected_amount NUMERIC(14,2);

ALTER TABLE commercial_events
  ADD COLUMN IF NOT EXISTS expected_reason TEXT;

ALTER TABLE commercial_events
  ADD COLUMN IF NOT EXISTS expected_updated_at TIMESTAMPTZ;

ALTER TABLE commercial_events
  ADD COLUMN IF NOT EXISTS expected_updated_by TEXT;

ALTER TABLE commercial_events DROP CONSTRAINT IF EXISTS chk_commercial_events_expected_treatment;
ALTER TABLE commercial_events
  ADD CONSTRAINT chk_commercial_events_expected_treatment
  CHECK (expected_treatment IN ('default', 'override', 'hold', 'exclude'));

ALTER TABLE commercial_events DROP CONSTRAINT IF EXISTS chk_commercial_events_expected_shape;
ALTER TABLE commercial_events
  ADD CONSTRAINT chk_commercial_events_expected_shape
  CHECK (
    (
      expected_treatment = 'default'
      AND expected_amount IS NULL
      AND expected_reason IS NULL
    )
    OR (
      expected_treatment = 'override'
      AND expected_amount IS NOT NULL
      AND char_length(btrim(COALESCE(expected_reason, ''))) >= 1
    )
    OR (
      expected_treatment IN ('hold', 'exclude')
      AND expected_amount IS NULL
      AND char_length(btrim(COALESCE(expected_reason, ''))) >= 1
    )
  );

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS prior_expected_treatment TEXT;

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS new_expected_treatment TEXT;

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS prior_expected_amount NUMERIC(14,2);

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS new_expected_amount NUMERIC(14,2);

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS prior_effective_expected NUMERIC(14,2);

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS new_effective_expected NUMERIC(14,2);

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS ce_value_at_change NUMERIC(14,2);

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS ce_status_at_change TEXT;

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS prior_ce_version INTEGER;

ALTER TABLE commercial_event_audit
  ADD COLUMN IF NOT EXISTS new_ce_version INTEGER;
