DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        WHERE t.typname = 'provenance_connection_kind'
    ) THEN
        CREATE TYPE provenance_connection_kind AS ENUM ('regular', 'referenced_by', 'iteration_of');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        WHERE t.typname = 'provenance_event_type'
    ) THEN
        CREATE TYPE provenance_event_type AS ENUM ('created', 'updated', 'deleted', 'tree_changed');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS document_state_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state JSONB NOT NULL,
    timeline JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS document_state_revisions_doc_time_idx
ON document_state_revisions (document_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS document_state_revisions_doc_version_idx
ON document_state_revisions (document_id, version DESC);

CREATE TABLE IF NOT EXISTS prov_object (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    parent_object_node_id TEXT NULL,
    requirement_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_activity (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    related_activity_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_user (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_requirement (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    detailed_requirement_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_concept (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    concept_composition_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_insight (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    concept_node_id TEXT NULL,
    activity_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_component (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    parent_component_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE IF NOT EXISTS prov_object_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    object_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, object_node_id, activity_node_id)
);

CREATE TABLE IF NOT EXISTS prov_user_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, user_node_id, activity_node_id)
);

CREATE TABLE IF NOT EXISTS prov_requirement_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    requirement_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, requirement_node_id, activity_node_id)
);

CREATE TABLE IF NOT EXISTS prov_concept_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    concept_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, concept_node_id, activity_node_id)
);

CREATE TABLE IF NOT EXISTS prov_component_requirement (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    component_node_id TEXT NOT NULL,
    requirement_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, component_node_id, requirement_node_id)
);

CREATE TABLE IF NOT EXISTS prov_card_connection (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    edge_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    source_label TEXT NOT NULL,
    target_label TEXT NOT NULL,
    source_title TEXT NOT NULL DEFAULT '',
    target_title TEXT NOT NULL DEFAULT '',
    connection_label TEXT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ NULL,
    PRIMARY KEY (document_id, edge_id)
);

ALTER TABLE prov_card_connection
    ADD COLUMN IF NOT EXISTS source_title TEXT NOT NULL DEFAULT '';

ALTER TABLE prov_card_connection
    ADD COLUMN IF NOT EXISTS target_title TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS prov_card_connection_doc_idx
ON prov_card_connection (document_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS prov_card_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    node_id TEXT NOT NULL,
    card_label TEXT NOT NULL,
    card_title TEXT NOT NULL DEFAULT '',
    card_description TEXT NOT NULL DEFAULT '',
    event_type provenance_event_type NOT NULL,
    tree_activity_node_id TEXT NULL,
    tree_activity_title TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS prov_card_event_doc_time_idx
ON prov_card_event (document_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS prov_card_event_doc_tree_idx
ON prov_card_event (document_id, tree_activity_node_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS prov_connection_event (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    edge_id TEXT NOT NULL,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    source_label TEXT NOT NULL,
    target_label TEXT NOT NULL,
    source_title TEXT NOT NULL DEFAULT '',
    target_title TEXT NOT NULL DEFAULT '',
    connection_label TEXT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    event_type provenance_event_type NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS prov_connection_event_doc_time_idx
ON prov_connection_event (document_id, occurred_at DESC);
