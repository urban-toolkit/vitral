CREATE TABLE IF NOT EXISTS node_file_links (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  file_id UUID NOT NULL REFERENCES document_files(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (document_id, node_id, file_id)
);

CREATE INDEX IF NOT EXISTS node_file_links_node_idx
  ON node_file_links(document_id, node_id);