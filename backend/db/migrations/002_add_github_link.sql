ALTER TABLE documents
ADD COLUMN IF NOT EXISTS github_owner TEXT,
ADD COLUMN IF NOT EXISTS github_repo TEXT,
ADD COLUMN IF NOT EXISTS github_default_branch TEXT,
ADD COLUMN IF NOT EXISTS github_linked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS documents_github_owner_repo_idx
  ON documents (github_owner, github_repo);