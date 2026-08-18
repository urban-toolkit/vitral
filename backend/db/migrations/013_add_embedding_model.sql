-- Records which embedding model produced each stored vector.
--
-- The card-similarity endpoint reuses these vectors instead of re-embedding the whole canvas on
-- every file drop. Comparing a vector from one model against a vector from another is
-- meaningless, and the vector(1536) type only catches a change in dimensionality -- not a switch
-- to a different 1536-dimension model. Rows written before this migration are left NULL and are
-- treated as "unknown model", so they still match while OPENAI_EMBEDDING_MODEL is unchanged.

ALTER TABLE document_node_embeddings
  ADD COLUMN IF NOT EXISTS model TEXT;
