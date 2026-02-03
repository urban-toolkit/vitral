ALTER TABLE document_files
  ADD COLUMN storage_backend TEXT NOT NULL DEFAULT 'postgres'
    CHECK (storage_backend IN ('postgres','minio')),
  ADD COLUMN storage_bucket TEXT,
  ADD COLUMN storage_key TEXT,
  ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'text'
    CHECK (content_kind IN ('text','binary'));

ALTER TABLE document_files
  ADD CONSTRAINT document_files_storage_check
  CHECK (
    (storage_backend = 'postgres' AND content_text IS NOT NULL AND storage_bucket IS NULL AND storage_key IS NULL)
 OR (storage_backend = 'minio' AND storage_bucket IS NOT NULL AND storage_key IS NOT NULL)
  );