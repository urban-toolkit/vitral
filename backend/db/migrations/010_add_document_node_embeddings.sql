CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_node_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, node_id)
);

CREATE INDEX IF NOT EXISTS document_node_embeddings_doc_idx
  ON document_node_embeddings (doc_id);

CREATE INDEX IF NOT EXISTS document_node_embeddings_embedding_idx
  ON document_node_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

