-- GP8-014 — authenticated Plot Master controlled-tenure review authority.
-- Additive only. Existing plots and tenure evidence are deliberately not backfilled.

INSERT INTO permissions(key, description)
VALUES ('plot_master.manage', 'Manage Development Plot Master records and controlled tenure review')
ON CONFLICT(key) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions(role_id, permission_key)
SELECT id, 'plot_master.manage'
FROM roles
WHERE key IN ('admin', 'commercial_director', 'commercial_manager', 'qs')
ON CONFLICT DO NOTHING;

CREATE TABLE plot_tenure_review_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_batch_id UUID NOT NULL,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  development_id TEXT NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  plot_id TEXT NOT NULL,
  source_tenure TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  previous_tenure_code TEXT NOT NULL,
  resulting_tenure_code TEXT NOT NULL,
  development_version_before INTEGER NOT NULL CHECK(development_version_before > 0),
  development_version_after INTEGER NOT NULL CHECK(development_version_after = development_version_before + 1),
  actor_user_id UUID NOT NULL REFERENCES buildlite_users(id) ON DELETE RESTRICT,
  actor_membership_id UUID NOT NULL REFERENCES client_user_memberships(id) ON DELETE RESTRICT,
  actor_provider_user_id TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  actor_role_key TEXT NOT NULL,
  actor_permission_key TEXT NOT NULL CHECK(actor_permission_key = 'plot_master.manage'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_plot_tenure_review_audit_development
  ON plot_tenure_review_audit(client_id, development_id, occurred_at DESC);
CREATE INDEX idx_plot_tenure_review_audit_plot
  ON plot_tenure_review_audit(client_id, development_id, plot_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION protect_plot_tenure_review_audit() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Plot tenure review audit is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plot_tenure_review_audit_immutable
  BEFORE UPDATE OR DELETE ON plot_tenure_review_audit
  FOR EACH ROW EXECUTE FUNCTION protect_plot_tenure_review_audit();
