ALTER TABLE documents
ADD COLUMN IF NOT EXISTS github_last_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS document_github_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  repo_owner TEXT NOT NULL,
  repo_name  TEXT NOT NULL,

  event_type TEXT NOT NULL,
  event_key  TEXT NOT NULL,

  actor_login TEXT,
  title TEXT,
  url TEXT,

  occurred_at TIMESTAMPTZ NOT NULL,

  issue_number INT,
  pr_number INT,
  commit_sha TEXT,
  branch_name TEXT,

  payload JSONB NOT NULL,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS document_github_events_uniq
ON document_github_events (document_id, event_type, event_key);

CREATE INDEX IF NOT EXISTS document_github_events_time
ON document_github_events (document_id, occurred_at DESC);
