ALTER TABLE document_files
  DROP COLUMN content_text;

ALTER TABLE document_files
  DROP COLUMN storage_backend;

ALTER TABLE document_files
  DROP COLUMN content_kind;

ALTER TABLE document_files DROP CONSTRAINT IF EXISTS document_files_storage_check;