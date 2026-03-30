-- provenance_schema.sql
-- Documentation-focused SQL model for provenance relationships.
-- Source of truth inspected: backend/db/init/001_init.sql, backend/db/migrations/008_support_github_events.sql,
-- backend/db/migrations/012_add_canvas_provenance.sql, and provenance write paths in backend/src/routes/state.ts.
--
-- Notes:
-- 1) "Enforced FK" relationships below exist as database foreign keys.
-- 2) "Logical (app-enforced)" relationships are important in provenance semantics but are not enforced as physical FKs today.

CREATE TYPE provenance_connection_kind AS ENUM ('regular', 'referenced_by', 'iteration_of');
CREATE TYPE provenance_event_type AS ENUM ('created', 'updated', 'deleted', 'tree_changed');

CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    state JSONB NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    timeline JSONB,
    github_owner TEXT,
    github_repo TEXT,
    github_default_branch TEXT,
    github_linked_at TIMESTAMPTZ,
    github_last_synced_at TIMESTAMPTZ,
    review_only BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE document_state_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    state JSONB NOT NULL,
    timeline JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX document_state_revisions_doc_time_idx
    ON document_state_revisions (document_id, captured_at DESC);
CREATE INDEX document_state_revisions_doc_version_idx
    ON document_state_revisions (document_id, version DESC);

CREATE TABLE document_github_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    repo_owner TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_key TEXT NOT NULL,
    actor_login TEXT,
    title TEXT,
    url TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    issue_number INT,
    pr_number INT,
    commit_sha TEXT,
    branch_name TEXT,
    payload JSONB NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, event_type, event_key)
);

CREATE INDEX document_github_events_time
    ON document_github_events (document_id, occurred_at DESC);

CREATE TABLE prov_object (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    parent_object_node_id TEXT NULL,
    requirement_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_activity (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    related_activity_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_user (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_requirement (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    detailed_requirement_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_concept (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    concept_composition_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_insight (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    concept_node_id TEXT NULL,
    activity_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_component (
    id BIGSERIAL PRIMARY KEY,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    parent_component_node_id TEXT NULL,
    UNIQUE (document_id, node_id)
);

CREATE TABLE prov_object_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    object_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, object_node_id, activity_node_id)
);

CREATE TABLE prov_user_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, user_node_id, activity_node_id)
);

CREATE TABLE prov_requirement_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    requirement_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, requirement_node_id, activity_node_id)
);

CREATE TABLE prov_concept_activity (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    concept_node_id TEXT NOT NULL,
    activity_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, concept_node_id, activity_node_id)
);

CREATE TABLE prov_component_requirement (
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    component_node_id TEXT NOT NULL,
    requirement_node_id TEXT NOT NULL,
    connection_kind provenance_connection_kind NOT NULL DEFAULT 'regular',
    PRIMARY KEY (document_id, component_node_id, requirement_node_id)
);

CREATE TABLE prov_card_connection (
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

CREATE INDEX prov_card_connection_doc_idx
    ON prov_card_connection (document_id, updated_at DESC);

CREATE TABLE prov_card_event (
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

CREATE INDEX prov_card_event_doc_time_idx
    ON prov_card_event (document_id, occurred_at DESC);
CREATE INDEX prov_card_event_doc_tree_idx
    ON prov_card_event (document_id, tree_activity_node_id, occurred_at DESC);

CREATE TABLE prov_connection_event (
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

CREATE INDEX prov_connection_event_doc_time_idx
    ON prov_connection_event (document_id, occurred_at DESC);

-- Logical (app-enforced) relationships for provenance graph semantics:
-- prov_object.(document_id, parent_object_node_id) -> prov_object.(document_id, node_id)
-- prov_object.(document_id, requirement_node_id) -> prov_requirement.(document_id, node_id)
-- prov_activity.(document_id, related_activity_node_id) -> prov_activity.(document_id, node_id)
-- prov_requirement.(document_id, detailed_requirement_node_id) -> prov_requirement.(document_id, node_id)
-- prov_concept.(document_id, concept_composition_node_id) -> prov_concept.(document_id, node_id)
-- prov_insight.(document_id, concept_node_id) -> prov_concept.(document_id, node_id)
-- prov_insight.(document_id, activity_node_id) -> prov_activity.(document_id, node_id)
-- prov_component.(document_id, parent_component_node_id) -> prov_component.(document_id, node_id)
-- prov_object_activity links prov_object <-> prov_activity
-- prov_user_activity links prov_user <-> prov_activity
-- prov_requirement_activity links prov_requirement <-> prov_activity
-- prov_concept_activity links prov_concept <-> prov_activity
-- prov_component_requirement links prov_component <-> prov_requirement
-- prov_card_event.tree_activity_node_id points to activity-tree membership used in timeline grouping
-- prov_card_connection.source_node_id/target_node_id are polymorphic identifiers across card/component node tables
-- prov_card_event.node_id and prov_connection_event.edge_id are historical identifiers and may outlive current snapshot rows
