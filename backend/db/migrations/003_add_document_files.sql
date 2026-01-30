CREATE TABLE IF NOT EXISTS document_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  mime_type TEXT,
  ext TEXT,

  content_text TEXT,       
 
  size_bytes INTEGER,
  sha256 TEXT,             -- dedupe + integrity

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_files_document_id_idx
  ON document_files(document_id);

CREATE INDEX IF NOT EXISTS document_files_document_sha_idx
  ON document_files(document_id, sha256);