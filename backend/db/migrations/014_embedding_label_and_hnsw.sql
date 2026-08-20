-- Card similarity now searches the vector index in the database instead of pulling every vector
-- into Node as text and comparing them there. Two things the old table shape could not express are
-- needed for that.
--
-- `label` as a column: a match is only ever considered between two cards carrying the same label,
-- and that filter has to run in SQL now rather than in a JS loop. Until now the label was readable
-- only by string-matching the first line of `node_text`.
--
-- HNSW instead of ivfflat: nothing ever used the old index, because the endpoint did a full scan
-- regardless. ivfflat with lists=100 also wants on the order of 100k rows before its partitioning
-- means anything, and one project's cards are a few hundred. HNSW needs no training set and
-- behaves correctly on a small table.

ALTER TABLE document_node_embeddings
  ADD COLUMN IF NOT EXISTS label TEXT;

-- Backfill from the serialized text of rows written before the column existed. Those rows are
-- superseded anyway -- the embedded text changed in the same release, so they no longer match the
-- current signature and will be re-embedded -- but a populated column keeps the filtered query
-- honest in the meantime rather than silently matching nothing.
UPDATE document_node_embeddings
SET label = lower(trim(replace(split_part(node_text, E'\n', 1), 'Card label:', '')))
WHERE label IS NULL
  AND split_part(node_text, E'\n', 1) LIKE 'Card label:%';

-- `task` is the legacy alias for `requirement`; the app normalizes it everywhere else.
UPDATE document_node_embeddings
SET label = 'requirement'
WHERE label = 'task';

CREATE INDEX IF NOT EXISTS document_node_embeddings_doc_label_idx
  ON document_node_embeddings (doc_id, label);

DROP INDEX IF EXISTS document_node_embeddings_embedding_idx;

CREATE INDEX IF NOT EXISTS document_node_embeddings_embedding_hnsw_idx
  ON document_node_embeddings
  USING hnsw (embedding vector_cosine_ops);
