-- 004_developments.sql
-- BL-027A.1 — Server-backed Developments (commercial entity; distinct from jobs)

CREATE TABLE IF NOT EXISTS developments (
  id                TEXT PRIMARY KEY,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_number        TEXT NOT NULL,
  development_name  TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'planning',
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  version           INTEGER NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_by        TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_developments_client_job_number
  ON developments (client_id, lower(job_number));

CREATE INDEX IF NOT EXISTS idx_developments_client_id
  ON developments (client_id);

CREATE INDEX IF NOT EXISTS idx_developments_client_status
  ON developments (client_id, status);
