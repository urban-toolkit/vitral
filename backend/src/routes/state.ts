import type { FastifyPluginAsync } from "fastify";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import path from "node:path";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { streamToBuffer, streamToString } from "../utils/streams.js";
import { safeFilename } from "../utils/files.js";
import { computeNodeEmbeddingDelta, createNodeEmbeddingQueue } from "../services/nodeEmbeddings.js";
import { applyStructuredFilters, extractCardNodesForSearch, parseNaturalLanguageNodeQuery, type CardNodeForSearch } from "../services/nodeSearch.js";
import {
    diffProvenanceSnapshots,
    extractProvenanceSnapshot,
    resolveTreeForCard,
    type ProvenanceConnection,
    type ProvenanceSnapshot,
} from "../services/canvasProvenance.js";
import { decodeProjectVi, encodeProjectVi, type ProjectViBundleV1 } from "../utils/projectVi.js";

type SaveBody = {
    title?: string;
    description?: string | null;
    state: unknown;
    timeline?: unknown;
};

type RevisionBody = {
    state: unknown;
    timeline?: unknown;
};

type QueryNodesBody = {
    query?: string;
    limit?: number;
    minScore?: number;
    scopeNodeIds?: string[];
    at?: string;
};

type QueryChatMessage = {
    role?: unknown;
    content?: unknown;
};

type QueryChatBody = {
    message?: string;
    conversation?: QueryChatMessage[];
    limit?: number;
    minScore?: number;
    scopeNodeIds?: string[];
    at?: string;
};

type SimilarityCardInput = {
    id?: unknown;
    label?: unknown;
    title?: unknown;
    description?: unknown;
};

type CompareCardsSimilarityBody = {
    newCards?: SimilarityCardInput[];
    existingCards?: SimilarityCardInput[];
};

const TEXT_EXTENSIONS = new Set([
    "txt", "json", "ipynb", "csv", "py", "js", "ts", "tsx", "jsx", "html", "css", "md",
]);

type SetupTemplateDefinition = {
    id?: unknown;
    name?: unknown;
    participants?: unknown;
    timeline?: {
        milestones?: unknown;
        stages?: unknown;
    };
};

type SetupTemplateResponse = {
    id: string;
    name: string;
    file: string;
    definition: {
        participants: Array<{ name: string; role: string }>;
        timeline: {
            milestones: Array<{ name: string; dayOffset: number }>;
            stages: Array<{ name: string; startDayOffset: number; endDayOffset: number }>;
        };
    };
};

function toTemplateNameFromFile(stem: string): string {
    return stem
        .split(/[-_]+/g)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function extractJsonObject(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

    const match = trimmed.match(/\{[\s\S]*\}/);
    return match ? match[0] : trimmed;
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength)}...`;
}

function rankNodesBySemanticQuery(
    nodes: CardNodeForSearch[],
    semanticQuery: string,
    limit: number,
): string[] {
    const normalized = semanticQuery.trim().toLowerCase();
    if (!normalized) return nodes.slice(0, limit).map((node) => node.id);
    const tokens = (normalized.match(/[a-z0-9]{2,}/g) ?? [])
        .filter((token, index, array) => array.indexOf(token) === index);
    if (tokens.length === 0) return nodes.slice(0, limit).map((node) => node.id);

    const scored = nodes.map((node) => {
        const title = node.title.toLowerCase();
        const description = node.description.toLowerCase();
        const label = node.label.toLowerCase();
        let score = 0;
        if (title.includes(normalized)) score += 14;
        if (description.includes(normalized)) score += 8;
        if (label.includes(normalized)) score += 6;
        for (const token of tokens) {
            if (title.includes(token)) score += 5;
            if (description.includes(token)) score += 2;
            if (label.includes(token)) score += 2;
        }
        return { id: node.id, score };
    });

    return scored
        .sort((a, b) => {
            if (a.score !== b.score) return b.score - a.score;
            return a.id.localeCompare(b.id);
        })
        .slice(0, limit)
        .map((entry) => entry.id);
}

function embeddingTextFromCard(card: { label: string; title: string; description: string }): string {
    return [
        `Card label: ${card.label}`,
        `Card title: ${card.title}`,
        `Card description: ${card.description}`,
    ].join("\n");
}

function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA <= 0 || normB <= 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeTemplateDefinition(raw: SetupTemplateDefinition): SetupTemplateResponse["definition"] {
    const participants = Array.isArray(raw.participants)
        ? raw.participants
            .filter(isRecord)
            .map((participant) => ({
                name: typeof participant.name === "string" ? participant.name : "Participant",
                role: typeof participant.role === "string" ? participant.role : "Researcher",
            }))
        : [];

    const milestones = Array.isArray(raw.timeline?.milestones)
        ? raw.timeline!.milestones
            .filter(isRecord)
            .map((milestone) => ({
                name: typeof milestone.name === "string" ? milestone.name : "Milestone",
                dayOffset: typeof milestone.dayOffset === "number" ? milestone.dayOffset : 0,
            }))
        : [];

    const stages = Array.isArray(raw.timeline?.stages)
        ? raw.timeline!.stages
            .filter(isRecord)
            .map((stage) => ({
                name: typeof stage.name === "string" ? stage.name : "Stage",
                startDayOffset: typeof stage.startDayOffset === "number" ? stage.startDayOffset : 0,
                endDayOffset: typeof stage.endDayOffset === "number" ? stage.endDayOffset : 0,
            }))
        : [];

    return {
        participants,
        timeline: {
            milestones,
            stages,
        },
    };
}

function parseVectorValue(raw: unknown): number[] {
    if (Array.isArray(raw)) {
        return raw
            .map((value) => (typeof value === "number" ? value : Number(value)))
            .filter((value) => Number.isFinite(value));
    }

    if (typeof raw === "string") {
        const trimmed = raw.trim();
        const unwrapped = trimmed.startsWith("[") && trimmed.endsWith("]")
            ? trimmed.slice(1, -1)
            : trimmed;
        if (!unwrapped) return [];
        return unwrapped
            .split(",")
            .map((part) => Number(part.trim()))
            .filter((value) => Number.isFinite(value));
    }

    return [];
}

function vectorToLiteral(values: number[]): string {
    return `[${values.join(",")}]`;
}

function sanitizeProjectFilename(title: string): string {
    const base = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return base || "project";
}

function arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) return false;
    }
    return true;
}

function remapStateFileReferences(state: unknown, fileIdMap: Map<string, string>): unknown {
    if (!isRecord(state)) return state;
    const flow = state.flow;
    if (!isRecord(flow)) return state;
    if (!Array.isArray(flow.nodes)) return state;

    const remappedNodes = flow.nodes.map((rawNode) => {
        if (!isRecord(rawNode)) return rawNode;
        if (!isRecord(rawNode.data)) return rawNode;

        const nodeData = rawNode.data;
        let changed = false;
        const nextData: Record<string, unknown> = { ...nodeData };

        if (Array.isArray(nodeData.attachmentIds)) {
            const nextAttachmentIds = nodeData.attachmentIds
                .map((value) => {
                    if (typeof value !== "string") return null;
                    return fileIdMap.get(value) ?? value;
                })
                .filter((value): value is string => typeof value === "string");
            const currentAttachmentIds = nodeData.attachmentIds.filter(
                (value): value is string => typeof value === "string",
            );
            if (!arraysEqual(currentAttachmentIds, nextAttachmentIds)) {
                nextData.attachmentIds = nextAttachmentIds;
                changed = true;
            }
        }

        if (typeof nodeData.origin === "string") {
            const remappedOrigin = fileIdMap.get(nodeData.origin);
            if (remappedOrigin && remappedOrigin !== nodeData.origin) {
                nextData.origin = remappedOrigin;
                changed = true;
            }
        }

        if (!changed) return rawNode;
        return {
            ...rawNode,
            data: nextData,
        };
    });

    return {
        ...state,
        flow: {
            ...flow,
            nodes: remappedNodes,
        },
    };
}

type DocumentSnapshotRow = {
    state: unknown;
    timeline: unknown;
    updated_at: string;
    version: number;
};

type LoadedSnapshot = {
    state: unknown;
    timeline: unknown;
    capturedAt: string;
    version: number;
};

type QueryablePg = {
    query<T = unknown>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

async function insertStateRevision(
    pg: QueryablePg,
    docId: string,
    version: number,
    state: unknown,
    timeline: unknown,
): Promise<void> {
    await pg.query(
        `
        INSERT INTO document_state_revisions (document_id, version, state, timeline)
        VALUES ($1, $2, $3::jsonb, $4::jsonb)
        `,
        [docId, version, JSON.stringify(state ?? {}), JSON.stringify(timeline ?? {})],
    );
}

async function loadSnapshotAt(
    pg: QueryablePg,
    docId: string,
    at?: Date | null,
): Promise<LoadedSnapshot | null> {
    const parsedAt = at && !Number.isNaN(at.getTime()) ? at : null;
    if (parsedAt) {
        const latestAtOrBefore = await pg.query<{
            state: unknown;
            timeline: unknown;
            captured_at: string;
            version: number;
        }>(
            `
            SELECT state, timeline, captured_at, version
            FROM document_state_revisions
            WHERE document_id = $1
              AND captured_at <= $2
            ORDER BY captured_at DESC
            LIMIT 1
            `,
            [docId, parsedAt.toISOString()],
        );
        if (latestAtOrBefore.rows.length > 0) {
            const row = latestAtOrBefore.rows[0];
            return {
                state: row.state,
                timeline: row.timeline,
                capturedAt: row.captured_at,
                version: row.version,
            };
        }

        const earliest = await pg.query<{
            state: unknown;
            timeline: unknown;
            captured_at: string;
            version: number;
        }>(
            `
            SELECT state, timeline, captured_at, version
            FROM document_state_revisions
            WHERE document_id = $1
            ORDER BY captured_at ASC
            LIMIT 1
            `,
            [docId],
        );
        if (earliest.rows.length > 0) {
            const row = earliest.rows[0];
            return {
                state: row.state,
                timeline: row.timeline,
                capturedAt: row.captured_at,
                version: row.version,
            };
        }
    }

    const current = await pg.query<DocumentSnapshotRow>(
        `
        SELECT state, timeline, updated_at, version
        FROM documents
        WHERE id = $1
        `,
        [docId],
    );
    if (current.rows.length === 0) return null;
    const row = current.rows[0];
    return {
        state: row.state,
        timeline: row.timeline,
        capturedAt: row.updated_at,
        version: row.version,
    };
}

async function refreshProvenanceGraph(
    pg: QueryablePg,
    docId: string,
    snapshot: ProvenanceSnapshot,
): Promise<void> {
    const deleteStatements = [
        "DELETE FROM prov_object_activity WHERE document_id = $1",
        "DELETE FROM prov_user_activity WHERE document_id = $1",
        "DELETE FROM prov_requirement_activity WHERE document_id = $1",
        "DELETE FROM prov_concept_activity WHERE document_id = $1",
        "DELETE FROM prov_component_requirement WHERE document_id = $1",
        "DELETE FROM prov_card_connection WHERE document_id = $1",
        "DELETE FROM prov_object WHERE document_id = $1",
        "DELETE FROM prov_activity WHERE document_id = $1",
        "DELETE FROM prov_user WHERE document_id = $1",
        "DELETE FROM prov_requirement WHERE document_id = $1",
        "DELETE FROM prov_concept WHERE document_id = $1",
        "DELETE FROM prov_insight WHERE document_id = $1",
        "DELETE FROM prov_component WHERE document_id = $1",
    ] as const;

    for (const statement of deleteStatements) {
        await pg.query(statement, [docId]);
    }

    for (const card of snapshot.cards.values()) {
        if (card.label === "object") {
            await pg.query(
                `
                INSERT INTO prov_object (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
            continue;
        }
        if (card.label === "activity") {
            await pg.query(
                `
                INSERT INTO prov_activity (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
            continue;
        }
        if (card.label === "person") {
            await pg.query(
                `
                INSERT INTO prov_user (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
            continue;
        }
        if (card.label === "requirement") {
            await pg.query(
                `
                INSERT INTO prov_requirement (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
            continue;
        }
        if (card.label === "concept") {
            await pg.query(
                `
                INSERT INTO prov_concept (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
            continue;
        }
        if (card.label === "insight") {
            await pg.query(
                `
                INSERT INTO prov_insight (document_id, node_id)
                VALUES ($1, $2)
                ON CONFLICT (document_id, node_id) DO NOTHING
                `,
                [docId, card.nodeId],
            );
        }
    }

    for (const component of snapshot.components.values()) {
        await pg.query(
            `
            INSERT INTO prov_component (document_id, node_id)
            VALUES ($1, $2)
            ON CONFLICT (document_id, node_id) DO NOTHING
            `,
            [docId, component.nodeId],
        );
    }

    const insertConnection = async (
        connection: ProvenanceConnection,
    ) => {
        await pg.query(
            `
            INSERT INTO prov_card_connection (
                document_id,
                edge_id,
                source_node_id,
                target_node_id,
                source_label,
                target_label,
                source_title,
                target_title,
                connection_label,
                connection_kind,
                updated_at,
                deleted_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::provenance_connection_kind, now(), NULL)
            ON CONFLICT (document_id, edge_id) DO UPDATE
            SET
                source_node_id = EXCLUDED.source_node_id,
                target_node_id = EXCLUDED.target_node_id,
                source_label = EXCLUDED.source_label,
                target_label = EXCLUDED.target_label,
                source_title = EXCLUDED.source_title,
                target_title = EXCLUDED.target_title,
                connection_label = EXCLUDED.connection_label,
                connection_kind = EXCLUDED.connection_kind,
                updated_at = now(),
                deleted_at = NULL
            `,
            [
                docId,
                connection.edgeId,
                connection.sourceNodeId,
                connection.targetNodeId,
                connection.sourceLabel,
                connection.targetLabel,
                connection.sourceTitle,
                connection.targetTitle,
                connection.label || null,
                connection.kind,
            ],
        );
    };

    for (const connection of snapshot.connections.values()) {
        await insertConnection(connection);
        const sourceLabel = connection.sourceLabel;
        const targetLabel = connection.targetLabel;

        const addObjectActivity = async (objectNodeId: string, activityNodeId: string) => {
            await pg.query(
                `
                INSERT INTO prov_object_activity (document_id, object_node_id, activity_node_id, connection_kind)
                VALUES ($1, $2, $3, $4::provenance_connection_kind)
                ON CONFLICT (document_id, object_node_id, activity_node_id)
                DO UPDATE SET connection_kind = EXCLUDED.connection_kind
                `,
                [docId, objectNodeId, activityNodeId, connection.kind],
            );
        };

        const addUserActivity = async (userNodeId: string, activityNodeId: string) => {
            await pg.query(
                `
                INSERT INTO prov_user_activity (document_id, user_node_id, activity_node_id, connection_kind)
                VALUES ($1, $2, $3, $4::provenance_connection_kind)
                ON CONFLICT (document_id, user_node_id, activity_node_id)
                DO UPDATE SET connection_kind = EXCLUDED.connection_kind
                `,
                [docId, userNodeId, activityNodeId, connection.kind],
            );
        };

        const addRequirementActivity = async (requirementNodeId: string, activityNodeId: string) => {
            await pg.query(
                `
                INSERT INTO prov_requirement_activity (document_id, requirement_node_id, activity_node_id, connection_kind)
                VALUES ($1, $2, $3, $4::provenance_connection_kind)
                ON CONFLICT (document_id, requirement_node_id, activity_node_id)
                DO UPDATE SET connection_kind = EXCLUDED.connection_kind
                `,
                [docId, requirementNodeId, activityNodeId, connection.kind],
            );
        };

        const addConceptActivity = async (conceptNodeId: string, activityNodeId: string) => {
            await pg.query(
                `
                INSERT INTO prov_concept_activity (document_id, concept_node_id, activity_node_id, connection_kind)
                VALUES ($1, $2, $3, $4::provenance_connection_kind)
                ON CONFLICT (document_id, concept_node_id, activity_node_id)
                DO UPDATE SET connection_kind = EXCLUDED.connection_kind
                `,
                [docId, conceptNodeId, activityNodeId, connection.kind],
            );
        };

        const addComponentRequirement = async (componentNodeId: string, requirementNodeId: string) => {
            await pg.query(
                `
                INSERT INTO prov_component_requirement (document_id, component_node_id, requirement_node_id, connection_kind)
                VALUES ($1, $2, $3, $4::provenance_connection_kind)
                ON CONFLICT (document_id, component_node_id, requirement_node_id)
                DO UPDATE SET connection_kind = EXCLUDED.connection_kind
                `,
                [docId, componentNodeId, requirementNodeId, connection.kind],
            );
        };

        if (sourceLabel === "object" && targetLabel === "activity") {
            await addObjectActivity(connection.sourceNodeId, connection.targetNodeId);
        } else if (targetLabel === "object" && sourceLabel === "activity") {
            await addObjectActivity(connection.targetNodeId, connection.sourceNodeId);
        } else if (sourceLabel === "person" && targetLabel === "activity") {
            await addUserActivity(connection.sourceNodeId, connection.targetNodeId);
        } else if (targetLabel === "person" && sourceLabel === "activity") {
            await addUserActivity(connection.targetNodeId, connection.sourceNodeId);
        } else if (sourceLabel === "requirement" && targetLabel === "activity") {
            await addRequirementActivity(connection.sourceNodeId, connection.targetNodeId);
        } else if (targetLabel === "requirement" && sourceLabel === "activity") {
            await addRequirementActivity(connection.targetNodeId, connection.sourceNodeId);
        } else if (sourceLabel === "concept" && targetLabel === "activity") {
            await addConceptActivity(connection.sourceNodeId, connection.targetNodeId);
        } else if (targetLabel === "concept" && sourceLabel === "activity") {
            await addConceptActivity(connection.targetNodeId, connection.sourceNodeId);
        } else if (sourceLabel === "blueprint_component" && targetLabel === "requirement") {
            await addComponentRequirement(connection.sourceNodeId, connection.targetNodeId);
        } else if (targetLabel === "blueprint_component" && sourceLabel === "requirement") {
            await addComponentRequirement(connection.targetNodeId, connection.sourceNodeId);
        }
    }
}

async function insertCardEvent(
    pg: QueryablePg,
    params: {
        docId: string;
        occurredAt: string;
        nodeId: string;
        cardLabel: string;
        cardTitle: string;
        cardDescription: string;
        eventType: "created" | "updated" | "deleted" | "tree_changed";
        treeId: string | null;
        treeTitle: string | null;
        metadata?: Record<string, unknown>;
    },
) {
    await pg.query(
        `
        INSERT INTO prov_card_event (
            document_id,
            occurred_at,
            node_id,
            card_label,
            card_title,
            card_description,
            event_type,
            tree_activity_node_id,
            tree_activity_title,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::provenance_event_type, $8, $9, $10::jsonb)
        `,
        [
            params.docId,
            params.occurredAt,
            params.nodeId,
            params.cardLabel,
            params.cardTitle,
            params.cardDescription,
            params.eventType,
            params.treeId,
            params.treeTitle,
            JSON.stringify(params.metadata ?? {}),
        ],
    );
}

async function insertConnectionEvent(
    pg: QueryablePg,
    params: {
        docId: string;
        occurredAt: string;
        edgeId: string;
        sourceNodeId: string;
        targetNodeId: string;
        sourceLabel: string;
        targetLabel: string;
        sourceTitle: string;
        targetTitle: string;
        connectionLabel: string;
        connectionKind: "regular" | "referenced_by" | "iteration_of";
        eventType: "created" | "updated" | "deleted";
        metadata?: Record<string, unknown>;
    },
) {
    await pg.query(
        `
        INSERT INTO prov_connection_event (
            document_id,
            occurred_at,
            edge_id,
            source_node_id,
            target_node_id,
            source_label,
            target_label,
            source_title,
            target_title,
            connection_label,
            connection_kind,
            event_type,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::provenance_connection_kind, $12::provenance_event_type, $13::jsonb)
        `,
        [
            params.docId,
            params.occurredAt,
            params.edgeId,
            params.sourceNodeId,
            params.targetNodeId,
            params.sourceLabel,
            params.targetLabel,
            params.sourceTitle,
            params.targetTitle,
            params.connectionLabel || null,
            params.connectionKind,
            params.eventType,
            JSON.stringify(params.metadata ?? {}),
        ],
    );
}

async function upsertCardCreationEventState(
    pg: QueryablePg,
    params: {
        docId: string;
        occurredAt: string;
        nodeId: string;
        cardLabel: string;
        cardTitle: string;
        cardDescription: string;
        treeId: string | null;
        treeTitle: string | null;
        metadata?: Record<string, unknown>;
    },
): Promise<void> {
    const updated = await pg.query<{ id: string }>(
        `
        WITH target AS (
            SELECT id
            FROM prov_card_event
            WHERE document_id = $1
              AND node_id = $2
              AND event_type = 'created'::provenance_event_type
            ORDER BY occurred_at ASC, id ASC
            LIMIT 1
        )
        UPDATE prov_card_event AS p
        SET
            card_label = $3,
            card_title = $4,
            card_description = $5,
            tree_activity_node_id = $6,
            tree_activity_title = $7,
            metadata = $8::jsonb
        FROM target
        WHERE p.id = target.id
        RETURNING p.id
        `,
        [
            params.docId,
            params.nodeId,
            params.cardLabel,
            params.cardTitle,
            params.cardDescription,
            params.treeId,
            params.treeTitle,
            JSON.stringify(params.metadata ?? {}),
        ],
    );

    if (updated.rows.length > 0) return;

    await insertCardEvent(pg, {
        docId: params.docId,
        occurredAt: params.occurredAt,
        nodeId: params.nodeId,
        cardLabel: params.cardLabel,
        cardTitle: params.cardTitle,
        cardDescription: params.cardDescription,
        eventType: "created",
        treeId: params.treeId,
        treeTitle: params.treeTitle,
        metadata: params.metadata ?? {},
    });
}

async function persistProvenanceEvolution(
    pg: QueryablePg,
    docId: string,
    previousState: unknown,
    currentState: unknown,
    occurredAt: string,
): Promise<void> {
    const previousSnapshot = extractProvenanceSnapshot(previousState);
    const currentSnapshot = extractProvenanceSnapshot(currentState);
    const diff = diffProvenanceSnapshots(previousSnapshot, currentSnapshot);

    for (const card of diff.cardCreated) {
        const tree = resolveTreeForCard(currentSnapshot, card.nodeId);
        await insertCardEvent(pg, {
            docId,
            occurredAt,
            nodeId: card.nodeId,
            cardLabel: card.label,
            cardTitle: card.title,
            cardDescription: card.description,
            eventType: "created",
            treeId: tree.treeId,
            treeTitle: tree.treeTitle,
            metadata: { relevant: card.relevant, deleted: false },
        });
    }

    for (const item of diff.cardUpdated) {
        const card = item.current;
        const tree = resolveTreeForCard(currentSnapshot, card.nodeId);
        await upsertCardCreationEventState(pg, {
            docId,
            occurredAt,
            nodeId: card.nodeId,
            cardLabel: card.label,
            cardTitle: card.title,
            cardDescription: card.description,
            treeId: tree.treeId,
            treeTitle: tree.treeTitle,
            metadata: {
                relevant: card.relevant,
                deleted: false,
            },
        });
    }

    for (const card of diff.cardDeleted) {
        await upsertCardCreationEventState(pg, {
            docId,
            occurredAt,
            nodeId: card.nodeId,
            cardLabel: card.label,
            cardTitle: card.title,
            cardDescription: card.description,
            treeId: null,
            treeTitle: null,
            metadata: { relevant: card.relevant, deleted: true },
        });
    }

    for (const connection of diff.connectionCreated) {
        await insertConnectionEvent(pg, {
            docId,
            occurredAt,
            edgeId: connection.edgeId,
            sourceNodeId: connection.sourceNodeId,
            targetNodeId: connection.targetNodeId,
            sourceLabel: connection.sourceLabel,
            targetLabel: connection.targetLabel,
            sourceTitle: connection.sourceTitle,
            targetTitle: connection.targetTitle,
            connectionLabel: connection.label,
            connectionKind: connection.kind,
            eventType: "created",
        });
    }

    for (const item of diff.connectionUpdated) {
        const connection = item.current;
        await insertConnectionEvent(pg, {
            docId,
            occurredAt,
            edgeId: connection.edgeId,
            sourceNodeId: connection.sourceNodeId,
            targetNodeId: connection.targetNodeId,
            sourceLabel: connection.sourceLabel,
            targetLabel: connection.targetLabel,
            sourceTitle: connection.sourceTitle,
            targetTitle: connection.targetTitle,
            connectionLabel: connection.label,
            connectionKind: connection.kind,
            eventType: "updated",
            metadata: {
                previous: {
                    sourceNodeId: item.previous.sourceNodeId,
                    targetNodeId: item.previous.targetNodeId,
                    label: item.previous.label,
                    kind: item.previous.kind,
                },
                current: {
                    sourceNodeId: connection.sourceNodeId,
                    targetNodeId: connection.targetNodeId,
                    label: connection.label,
                    kind: connection.kind,
                },
            },
        });
    }

    for (const connection of diff.connectionDeleted) {
        await insertConnectionEvent(pg, {
            docId,
            occurredAt,
            edgeId: connection.edgeId,
            sourceNodeId: connection.sourceNodeId,
            targetNodeId: connection.targetNodeId,
            sourceLabel: connection.sourceLabel,
            targetLabel: connection.targetLabel,
            sourceTitle: connection.sourceTitle,
            targetTitle: connection.targetTitle,
            connectionLabel: connection.label,
            connectionKind: connection.kind,
            eventType: "deleted",
        });
    }

    await refreshProvenanceGraph(pg, docId, currentSnapshot);
}

type TimelineBlueprintEventSnapshot = {
    id: string;
    componentNodeId: string;
    occurredAt: string;
    name: string;
};

function extractBlueprintEventsFromTimeline(timeline: unknown): TimelineBlueprintEventSnapshot[] {
    if (!isRecord(timeline)) return [];

    const fromArray = Array.isArray(timeline.blueprintEvents)
        ? timeline.blueprintEvents
        : null;

    if (fromArray) {
        return fromArray
            .filter(isRecord)
            .map((event) => ({
                id: typeof event.id === "string" ? event.id : "",
                componentNodeId: typeof event.componentNodeId === "string" ? event.componentNodeId : "",
                occurredAt: typeof event.occurredAt === "string" ? event.occurredAt : "",
                name: typeof event.name === "string" ? event.name : "",
            }))
            .filter((event) => event.id && event.componentNodeId);
    }

    const blueprintEvents = isRecord(timeline.blueprintEvents) ? timeline.blueprintEvents : null;
    const byId = blueprintEvents && isRecord(blueprintEvents.byId)
        ? blueprintEvents.byId
        : null;
    const allIds = blueprintEvents && Array.isArray(blueprintEvents.allIds)
        ? blueprintEvents.allIds
        : null;
    if (!byId || !allIds) return [];

    const events: TimelineBlueprintEventSnapshot[] = [];
    for (const rawId of allIds) {
        if (typeof rawId !== "string") continue;
        const candidate = byId[rawId];
        if (!isRecord(candidate)) continue;
        const componentNodeId = typeof candidate.componentNodeId === "string"
            ? candidate.componentNodeId
            : "";
        if (!componentNodeId) continue;
        events.push({
            id: typeof candidate.id === "string" ? candidate.id : rawId,
            componentNodeId,
            occurredAt: typeof candidate.occurredAt === "string" ? candidate.occurredAt : "",
            name: typeof candidate.name === "string" ? candidate.name : "",
        });
    }
    return events;
}

async function loadLiteratureTemplatesFromDisk(): Promise<SetupTemplateResponse[]> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const defaultTemplatesDir = path.resolve(here, "../../setupTemplates/literature");
    const configuredTemplatesDir = process.env.SETUP_TEMPLATES_DIR?.trim();
    const templatesDir = configuredTemplatesDir
        ? (path.isAbsolute(configuredTemplatesDir)
            ? configuredTemplatesDir
            : path.resolve(process.cwd(), configuredTemplatesDir))
        : defaultTemplatesDir;

    const entries = await readdir(templatesDir, { withFileTypes: true });
    const jsonFiles = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json") && entry.name.toLowerCase() !== "index.json")
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const templates = await Promise.all(jsonFiles.map(async (file): Promise<SetupTemplateResponse | null> => {
        const fullPath = path.join(templatesDir, file);
        const rawText = await readFile(fullPath, "utf8");
        const parsed = JSON.parse(rawText) as SetupTemplateDefinition;
        if (!isRecord(parsed)) return null;

        const fileStem = file.replace(/\.json$/i, "");
        const id = typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : fileStem;
        const name = typeof parsed.name === "string" && parsed.name.trim()
            ? parsed.name.trim()
            : toTemplateNameFromFile(fileStem);

        return {
            id,
            name,
            file,
            definition: normalizeTemplateDefinition(parsed),
        };
    }));

    return templates.filter((template): template is SetupTemplateResponse => template !== null);
}

export const stateRoutes: FastifyPluginAsync = async (app) => {
    const nodeEmbeddingQueue = createNodeEmbeddingQueue({
        pg: app.pg,
        logger: app.log,
    });
    const openAiClient = process.env.OPENAI_API_KEY
        ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
        : null;
    const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

    const getDocumentReviewOnly = async (docId: string): Promise<boolean | null> => {
        const result = await app.pg.query<{ review_only: boolean }>(
            `
            SELECT review_only
            FROM documents
            WHERE id = $1
            `,
            [docId],
        );
        if (result.rows.length === 0) return null;
        return Boolean(result.rows[0]?.review_only);
    };

    const ensureDocumentWritable = async (docId: string, reply: any): Promise<boolean> => {
        const reviewOnly = await getDocumentReviewOnly(docId);
        if (reviewOnly === null) {
            reply.status(404).send({ error: "Document not found" });
            return false;
        }
        if (reviewOnly) {
            reply.status(403).send({ error: "This is a review project and cannot be modified." });
            return false;
        }
        return true;
    };

    app.get("/setup-templates/literature", async (request, reply) => {
        try {
            const templates = await loadLiteratureTemplatesFromDisk();
            return { templates };
        } catch (error) {
            request.log.error({ error }, "Failed to load literature setup templates");
            return reply.status(500).send({ error: "Failed to load literature setup templates" });
        }
    });

    /**
     * Create a new document
     * POST /api/state
     */
    app.post("/state", async (request, reply) => {
        const body = request.body as SaveBody;

        if (!body || typeof body !== "object" || body.state === undefined) {
            return reply.status(400).send({ error: "Missing state" });
        }

        const title = (body.title && body.title.trim()) || "Untitled";
        const description = body.description ?? null;
        const timeline = body.timeline ?? {};

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (title, description, state, timeline)
            VALUES ($1, $2, $3::jsonb, $4::jsonb)
            RETURNING id, title, description, version, updated_at, review_only
            `,
            [title, description, JSON.stringify(body.state), JSON.stringify(timeline)]
        );

        try {
            const createdDocId = rows[0]?.id as string | undefined;
            const createdVersion = Number(rows[0]?.version ?? 1);
            const createdAt = typeof rows[0]?.updated_at === "string" ? rows[0].updated_at : new Date().toISOString();
            if (createdDocId) {
                await insertStateRevision(app.pg, createdDocId, createdVersion, body.state, timeline);
                await persistProvenanceEvolution(app.pg, createdDocId, undefined, body.state, createdAt);
                const { upserts } = computeNodeEmbeddingDelta(undefined, body.state, createdDocId);
                if (upserts.length > 0) {
                    nodeEmbeddingQueue.enqueue(upserts);
                }
            }
        } catch (error) {
            request.log.error({ error }, "Failed to enqueue node embeddings after document creation.");
        }

        return reply.status(201).send(rows[0]);
    });

    /**
     * Load a document by id
     * GET /api/state/:id
     */
    app.get("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await app.pg.query(
            `
            SELECT id, title, description, state, timeline, version, updated_at, review_only
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Load the closest saved canvas snapshot at or before a timestamp.
     * GET /api/state/:id/state-at?at=ISO
     */
    app.get("/state/:id/state-at", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { at } = request.query as { at?: string };

        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        let parsedAt: Date | null = null;
        if (typeof at === "string" && at.trim() !== "") {
            parsedAt = new Date(at);
            if (Number.isNaN(parsedAt.getTime())) {
                return reply.status(400).send({ error: "Invalid at timestamp" });
            }
        }

        const snapshot = await loadSnapshotAt(app.pg, id, parsedAt);
        if (!snapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return reply.send({
            state: snapshot.state,
            timeline: snapshot.timeline,
            capturedAt: snapshot.capturedAt,
            version: snapshot.version,
        });
    });

    /**
     * Load knowledge-base provenance payload for timeline rendering.
     * GET /api/state/:id/knowledge/provenance?at=ISO
     */
    app.get("/state/:id/knowledge/provenance", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { at } = request.query as { at?: string };

        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        let parsedAt: Date | null = null;
        if (typeof at === "string" && at.trim() !== "") {
            parsedAt = new Date(at);
            if (Number.isNaN(parsedAt.getTime())) {
                return reply.status(400).send({ error: "Invalid at timestamp" });
            }
        }

        const effectiveAt = parsedAt ?? new Date();
        const snapshot = await loadSnapshotAt(app.pg, id, effectiveAt);
        if (!snapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const snapshotGraph = extractProvenanceSnapshot(snapshot.state);
        const createdCardEventsRes = await app.pg.query<{
            id: string;
            occurred_at: string;
            node_id: string;
            card_label: string;
            card_title: string;
            card_description: string;
            tree_activity_node_id: string | null;
            tree_activity_title: string | null;
            metadata: unknown;
        }>(
            `
            SELECT DISTINCT ON (node_id)
                id,
                occurred_at,
                node_id,
                card_label,
                card_title,
                card_description,
                tree_activity_node_id,
                tree_activity_title,
                metadata
            FROM prov_card_event
            WHERE document_id = $1
              AND event_type = 'created'::provenance_event_type
              AND occurred_at <= $2
            ORDER BY node_id ASC, occurred_at ASC, id ASC
            `,
            [id, effectiveAt.toISOString()],
        );

        const connectionEventsRes = await app.pg.query<{
            id: string;
            occurred_at: string;
            edge_id: string;
            source_node_id: string;
            target_node_id: string;
            source_label: string;
            target_label: string;
            source_title: string;
            target_title: string;
            connection_label: string | null;
            connection_kind: "regular" | "referenced_by" | "iteration_of";
            event_type: "created" | "updated" | "deleted" | "tree_changed";
            metadata: unknown;
        }>(
            `
            SELECT
                id,
                occurred_at,
                edge_id,
                source_node_id,
                target_node_id,
                source_label,
                target_label,
                source_title,
                target_title,
                connection_label,
                connection_kind,
                event_type,
                metadata
            FROM prov_connection_event
            WHERE document_id = $1
              AND occurred_at <= $2
            ORDER BY occurred_at ASC, id ASC
            `,
            [id, effectiveAt.toISOString()],
        );

        const creationEventsFromDb = createdCardEventsRes.rows
            .map((row: typeof createdCardEventsRes.rows[number]) => {
                const snapshotCard = snapshotGraph.cards.get(row.node_id);
                const snapshotLabel = snapshotCard?.label ?? null;
                const snapshotTitle = snapshotCard?.title ?? null;
                const snapshotDescription = snapshotCard?.description ?? null;
                const snapshotRelevant = snapshotCard?.relevant;
                const metadata = isRecord(row.metadata) ? row.metadata : {};
                const isDeleted = !snapshotCard;
                const resolvedLabel = snapshotLabel ?? row.card_label;
                const resolvedTitle = snapshotTitle ?? row.card_title;
                const resolvedDescription = snapshotDescription ?? row.card_description;
                const resolvedTreeId = snapshotCard
                    ? (
                        snapshotGraph.treeByCardId.get(row.node_id) ??
                        (resolvedLabel === "activity" ? row.node_id : null)
                    )
                    : null;
                const resolvedTreeTitle = resolvedTreeId
                    ? (
                        snapshotGraph.treeTitleByActivityId.get(resolvedTreeId) ??
                        (resolvedLabel === "activity" && resolvedTreeId === row.node_id
                            ? resolvedTitle
                            : row.tree_activity_title) ??
                        "Activity"
                    )
                    : null;

                return {
                    id: row.id,
                    occurredAt: row.occurred_at,
                    eventType: "created" as const,
                    isDeleted,
                    nodeId: row.node_id,
                    cardLabel: resolvedLabel,
                    cardTitle: resolvedTitle,
                    cardDescription: resolvedDescription,
                    treeId: resolvedTreeId,
                    treeTitle: resolvedTreeTitle,
                    metadata: {
                        ...metadata,
                        relevant: snapshotRelevant ?? metadata.relevant ?? true,
                        deleted: isDeleted,
                    },
                };
            });

        const fallbackCreatedAtByNodeId = new Map<string, string>();
        if (isRecord(snapshot.state) && isRecord(snapshot.state.flow) && Array.isArray(snapshot.state.flow.nodes)) {
            for (const rawNode of snapshot.state.flow.nodes) {
                if (!isRecord(rawNode)) continue;
                const nodeId = typeof rawNode.id === "string" ? rawNode.id : "";
                if (!nodeId) continue;
                if (!snapshotGraph.cards.has(nodeId)) continue;
                const data = isRecord(rawNode.data) ? rawNode.data : {};
                const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
                const parsed = new Date(createdAt);
                fallbackCreatedAtByNodeId.set(
                    nodeId,
                    Number.isNaN(parsed.getTime()) ? snapshot.capturedAt : parsed.toISOString(),
                );
            }
        }

        const creationEventsFallback = Array.from(snapshotGraph.cards.values()).map((card) => {
            const treeId = (
                snapshotGraph.treeByCardId.get(card.nodeId) ??
                (card.label === "activity" ? card.nodeId : null)
            );
            const treeTitle = treeId
                ? (
                    snapshotGraph.treeTitleByActivityId.get(treeId) ??
                    (card.label === "activity" && treeId === card.nodeId ? card.title : null) ??
                    "Activity"
                )
                : null;
            return {
                id: `synthetic-created:${card.nodeId}`,
                occurredAt: fallbackCreatedAtByNodeId.get(card.nodeId) ?? snapshot.capturedAt,
                eventType: "created" as const,
                isDeleted: false,
                nodeId: card.nodeId,
                cardLabel: card.label,
                cardTitle: card.title,
                cardDescription: card.description,
                treeId,
                treeTitle,
                metadata: {
                    relevant: card.relevant,
                    deleted: false,
                    synthetic: true,
                },
            };
        });

        const createdNodeIdsFromDb = new Set(
            creationEventsFromDb.map((eventData: { nodeId: string }) => eventData.nodeId),
        );
        const creationEventsSyntheticMissing = creationEventsFallback.filter(
            (eventData) => !createdNodeIdsFromDb.has(eventData.nodeId),
        );

        const creationEvents = (
            creationEventsFromDb.length > 0
                ? [...creationEventsFromDb, ...creationEventsSyntheticMissing]
                : creationEventsFallback
        ).sort((a: {
            id: string;
            occurredAt: string;
        }, b: {
            id: string;
            occurredAt: string;
        }) => {
            const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
            if (delta !== 0) return delta;
            return a.id.localeCompare(b.id);
        });

        const cardCreatedAtByNodeId = new Map<string, string>();
        for (const eventData of creationEvents) {
            if (!cardCreatedAtByNodeId.has(eventData.nodeId)) {
                cardCreatedAtByNodeId.set(eventData.nodeId, eventData.occurredAt);
            }
        }

        const pillsByTreeId = new Map<string, {
            treeId: string;
            treeTitle: string;
            occurredAt: string;
            events: Array<{
                id: string;
                occurredAt: string;
                eventType: "created";
                isDeleted: boolean;
                nodeId: string;
                cardLabel: string;
                cardTitle: string;
                cardDescription: string;
                metadata: unknown;
            }>;
        }>();

        for (const eventData of creationEvents) {
            const resolvedTreeId = eventData.treeId;
            if (!resolvedTreeId) continue;
            const resolvedTreeTitle = eventData.treeTitle ?? "Activity";

            const existing = pillsByTreeId.get(resolvedTreeId);
            if (!existing) {
                pillsByTreeId.set(resolvedTreeId, {
                    treeId: resolvedTreeId,
                    treeTitle: resolvedTreeTitle || "Tree",
                    occurredAt: eventData.occurredAt,
                    events: [{
                        id: eventData.id,
                        occurredAt: eventData.occurredAt,
                        eventType: eventData.eventType,
                        isDeleted: eventData.isDeleted,
                        nodeId: eventData.nodeId,
                        cardLabel: eventData.cardLabel,
                        cardTitle: eventData.cardTitle,
                        cardDescription: eventData.cardDescription,
                        metadata: eventData.metadata,
                    }],
                });
                continue;
            }

            if (new Date(eventData.occurredAt).getTime() < new Date(existing.occurredAt).getTime()) {
                existing.occurredAt = eventData.occurredAt;
            }
            existing.events.push({
                id: eventData.id,
                occurredAt: eventData.occurredAt,
                eventType: eventData.eventType,
                isDeleted: eventData.isDeleted,
                nodeId: eventData.nodeId,
                cardLabel: eventData.cardLabel,
                cardTitle: eventData.cardTitle,
                cardDescription: eventData.cardDescription,
                metadata: eventData.metadata,
            });
        }

        const connectionFirstSeenAtByEdgeId = new Map<string, string>();
        for (const row of connectionEventsRes.rows) {
            if (!connectionFirstSeenAtByEdgeId.has(row.edge_id)) {
                connectionFirstSeenAtByEdgeId.set(row.edge_id, row.occurred_at);
            }
        }

        const activeConnections = Array.from(snapshotGraph.connections.values()).map((connection) => ({
            edge_id: connection.edgeId,
            occurred_at: connectionFirstSeenAtByEdgeId.get(connection.edgeId) ?? effectiveAt.toISOString(),
            source_node_id: connection.sourceNodeId,
            target_node_id: connection.targetNodeId,
            source_label: connection.sourceLabel,
            target_label: connection.targetLabel,
            source_title: connection.sourceTitle,
            target_title: connection.targetTitle,
            connection_label: connection.label || null,
            connection_kind: connection.kind,
        }));

        const treeOfCard = (cardNodeId: string, cardLabel: string): string | null => {
            const fromSnapshot = snapshotGraph.treeByCardId.get(cardNodeId);
            if (typeof fromSnapshot === "string" && fromSnapshot.trim() !== "") return fromSnapshot;
            if (cardLabel === "activity") return cardNodeId;
            return null;
        };

        const rawCrossTreeConnections = activeConnections
            .map((row) => {
                const sourceTreeId = treeOfCard(row.source_node_id, row.source_label);
                const targetTreeId = treeOfCard(row.target_node_id, row.target_label);
                return {
                    id: row.edge_id,
                    occurredAt: row.occurred_at,
                    label: row.connection_label ?? "",
                    kind: row.connection_kind,
                    sourceNodeId: row.source_node_id,
                    targetNodeId: row.target_node_id,
                    sourceCardTitle: row.source_title,
                    sourceCardLabel: row.source_label,
                    targetCardTitle: row.target_title,
                    targetCardLabel: row.target_label,
                    sourceTreeId,
                    targetTreeId,
                };
            })
            .filter((connection) => {
                if (connection.sourceCardLabel === "blueprint_component") return false;
                if (connection.targetCardLabel === "blueprint_component") return false;
                if (!connection.sourceTreeId || !connection.targetTreeId) return false;
                return connection.sourceTreeId !== connection.targetTreeId;
            });
        const crossTreeConnectionsByKey = new Map<string, typeof rawCrossTreeConnections[number]>();
        for (const connection of rawCrossTreeConnections) {
            const normalizedLabel = String(connection.label ?? "").trim().toLowerCase();
            const normalizedNodePair = [connection.sourceNodeId, connection.targetNodeId]
                .sort((a, b) => a.localeCompare(b))
                .join("::");
            const normalizedTreePair = [connection.sourceTreeId ?? "", connection.targetTreeId ?? ""]
                .sort((a, b) => a.localeCompare(b))
                .join("::");
            const dedupeKey = `${normalizedTreePair}|${normalizedNodePair}|${connection.kind}|${normalizedLabel}`;
            if (crossTreeConnectionsByKey.has(dedupeKey)) continue;
            crossTreeConnectionsByKey.set(dedupeKey, connection);
        }
        const crossTreeConnections = Array.from(crossTreeConnectionsByKey.values())
            .sort((a, b) => {
                const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                if (delta !== 0) return delta;
                return a.id.localeCompare(b.id);
            });

        const timelineBlueprintEvents = extractBlueprintEventsFromTimeline(snapshot.timeline);
        const blueprintByComponentNodeId = new Map(
            timelineBlueprintEvents.map((event) => [event.componentNodeId, event] as const),
        );

        const blueprintLinks = activeConnections
            .map((row) => {
                const sourceIsBlueprint = row.source_label === "blueprint_component";
                const targetIsBlueprint = row.target_label === "blueprint_component";
                if (!sourceIsBlueprint && !targetIsBlueprint) return null;

                const componentNodeId = sourceIsBlueprint ? row.source_node_id : row.target_node_id;
                const cardNodeId = sourceIsBlueprint ? row.target_node_id : row.source_node_id;
                const cardLabel = sourceIsBlueprint ? row.target_label : row.source_label;
                const cardTitle = sourceIsBlueprint ? row.target_title : row.source_title;
                const blueprintEvent = blueprintByComponentNodeId.get(componentNodeId);
                if (!blueprintEvent) return null;
                const cardCreatedAt = cardCreatedAtByNodeId.get(cardNodeId) ?? row.occurred_at;

                return {
                    id: row.edge_id,
                    kind: row.connection_kind,
                    label: row.connection_label ?? "",
                    cardNodeId,
                    cardLabel,
                    cardTitle,
                    cardCreatedAt,
                    blueprintEventId: blueprintEvent.id,
                    blueprintEventName: blueprintEvent.name,
                    blueprintOccurredAt: blueprintEvent.occurredAt,
                    componentNodeId,
                };
            })
            .filter((link): link is NonNullable<typeof link> => link !== null);

        const boundsRes = await app.pg.query<{ min_at: string | null; max_at: string | null }>(
            `
            SELECT
                MIN(captured_at) AS min_at,
                MAX(captured_at) AS max_at
            FROM document_state_revisions
            WHERE document_id = $1
            `,
            [id],
        );

        const bounds = boundsRes.rows[0];
        const minAt = bounds?.min_at ?? snapshot.capturedAt;
        const maxAt = bounds?.max_at ?? snapshot.capturedAt;

        const pills = Array.from(pillsByTreeId.values())
            .map((pill) => ({
                ...pill,
                events: [...pill.events].sort((a, b) => {
                    const delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
                    if (delta !== 0) return delta;
                    return a.id.localeCompare(b.id);
                }),
            }))
            .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

        return reply.send({
            at: effectiveAt.toISOString(),
            minAt,
            maxAt,
            pills,
            events: creationEvents,
            crossTreeConnections,
            blueprintLinks,
        });
    });

    /**
     * Query nodes using natural language + structured filters + semantic vector search
     * POST /api/state/:id/query-nodes
     */
    app.post("/state/:id/query-nodes", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as QueryNodesBody;
        const rawQuery = typeof body?.query === "string" ? body.query.trim() : "";
        const requestedLimit = typeof body?.limit === "number" ? body.limit : Number(body?.limit);
        const requestedMinScore = typeof body?.minScore === "number" ? body.minScore : Number(body?.minScore);
        const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 60;
        const envMinScore = Number(process.env.NODE_QUERY_MIN_SCORE ?? 0.2);
        const minScore = Number.isFinite(requestedMinScore)
            ? Math.max(-1, Math.min(1, requestedMinScore))
            : (Number.isFinite(envMinScore) ? Math.max(-1, Math.min(1, envMinScore)) : 0.2);
        const scopeNodeIds = Array.isArray(body?.scopeNodeIds)
            ? body.scopeNodeIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : undefined;
        let parsedAt: Date | null = null;
        if (typeof body?.at === "string" && body.at.trim() !== "") {
            parsedAt = new Date(body.at);
            if (Number.isNaN(parsedAt.getTime())) {
                return reply.status(400).send({ error: "Invalid at timestamp" });
            }
        }

        if (!rawQuery) {
            return reply.status(400).send({ error: "Missing query" });
        }

        const snapshot = await loadSnapshotAt(app.pg, id, parsedAt);
        if (!snapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        let candidateNodes = extractCardNodesForSearch(snapshot.state);
        if (scopeNodeIds) {
            const scopeSet = new Set(scopeNodeIds);
            candidateNodes = candidateNodes.filter((node) => scopeSet.has(node.id));
        }

        const parsed = await parseNaturalLanguageNodeQuery(openAiClient, rawQuery, app.log);
        const structuredFilteredNodes = applyStructuredFilters(candidateNodes, parsed.structuredFilters);
        const structuredNodeIds = structuredFilteredNodes.map((node) => node.id);

        if (structuredNodeIds.length === 0) {
            return reply.send({
                parsed,
                matchedNodeIds: [],
                usedVectorSearch: false,
            });
        }

        const semanticQuery = parsed.semanticQuery.trim();
        if (!semanticQuery) {
            return reply.send({
                parsed,
                matchedNodeIds: structuredNodeIds.slice(0, limit),
                usedVectorSearch: false,
            });
        }

        if (parsedAt) {
            return reply.send({
                parsed,
                matchedNodeIds: rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit),
                usedVectorSearch: false,
            });
        }

        if (!openAiClient) {
            return reply.send({
                parsed,
                matchedNodeIds: rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit),
                usedVectorSearch: false,
            });
        }

        const embeddingTable = await app.pg.query<{ table_name: string | null }>(
            `
            SELECT to_regclass('public.document_node_embeddings') AS table_name
            `,
        );

        if (!embeddingTable.rows[0]?.table_name) {
            return reply.send({
                parsed,
                matchedNodeIds: rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit),
                usedVectorSearch: false,
            });
        }

        let semanticVector: number[] | null = null;
        try {
            const embeddingResponse = await openAiClient.embeddings.create({
                model: embeddingModel,
                input: semanticQuery,
            });
            semanticVector = Array.isArray(embeddingResponse.data?.[0]?.embedding)
                ? embeddingResponse.data[0].embedding
                : null;
        } catch (error) {
            request.log.warn({ error }, "Failed to embed semantic query; falling back to structured filters only.");
        }

        if (!semanticVector) {
            return reply.send({
                parsed,
                matchedNodeIds: rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit),
                usedVectorSearch: false,
            });
        }

        const vectorLiteral = `[${semanticVector.join(",")}]`;
        const vectorRows = await app.pg.query<{ node_id: string; score: number }>(
            `
            SELECT
                node_id,
                1 - (embedding <=> $3::vector) AS score
            FROM document_node_embeddings
            WHERE doc_id = $1
              AND node_id = ANY($2::text[])
              AND 1 - (embedding <=> $3::vector) >= $5
            ORDER BY embedding <=> $3::vector
            LIMIT $4
            `,
            [id, structuredNodeIds, vectorLiteral, limit, minScore],
        );

        const vectorResultRows = vectorRows.rows as Array<{ node_id: string; score: number }>;
        const vectorMatchedIds = vectorResultRows.map((row) => row.node_id);
        const matchedNodeIds = vectorMatchedIds;

        return reply.send({
            parsed,
            matchedNodeIds,
            usedVectorSearch: true,
        });
    });

    /**
     * Chat over canvas nodes using embeddings-backed retrieval.
     * Returns an assistant reply and optionally node ids to filter on the frontend.
     * POST /api/state/:id/query-chat
     */
    app.post("/state/:id/query-chat", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as QueryChatBody;
        const rawMessage = typeof body?.message === "string" ? body.message.trim() : "";
        const requestedLimit = typeof body?.limit === "number" ? body.limit : Number(body?.limit);
        const requestedMinScore = typeof body?.minScore === "number" ? body.minScore : Number(body?.minScore);
        const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 60;
        const envMinScore = Number(process.env.NODE_QUERY_MIN_SCORE ?? 0.2);
        const minScore = Number.isFinite(requestedMinScore)
            ? Math.max(-1, Math.min(1, requestedMinScore))
            : (Number.isFinite(envMinScore) ? Math.max(-1, Math.min(1, envMinScore)) : 0.2);
        const scopeNodeIds = Array.isArray(body?.scopeNodeIds)
            ? body.scopeNodeIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
            : undefined;
        let parsedAt: Date | null = null;
        if (typeof body?.at === "string" && body.at.trim() !== "") {
            parsedAt = new Date(body.at);
            if (Number.isNaN(parsedAt.getTime())) {
                return reply.status(400).send({ error: "Invalid at timestamp" });
            }
        }

        const conversation = Array.isArray(body?.conversation)
            ? body.conversation
                .filter((message): message is { role: "user" | "assistant"; content: string } => {
                    if (!message || typeof message !== "object") return false;
                    const role = message.role;
                    const content = message.content;
                    if (role !== "user" && role !== "assistant") return false;
                    return typeof content === "string" && content.trim().length > 0;
                })
                .slice(-12)
            : [];

        if (!rawMessage) {
            return reply.status(400).send({ error: "Missing message" });
        }

        const snapshot = await loadSnapshotAt(app.pg, id, parsedAt);
        if (!snapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        let candidateNodes = extractCardNodesForSearch(snapshot.state);
        if (scopeNodeIds) {
            const scopeSet = new Set(scopeNodeIds);
            candidateNodes = candidateNodes.filter((node) => scopeSet.has(node.id));
        }

        const parsed = await parseNaturalLanguageNodeQuery(openAiClient, rawMessage, app.log);
        const structuredFilteredNodes = applyStructuredFilters(candidateNodes, parsed.structuredFilters);
        const structuredNodeIds = structuredFilteredNodes.map((node) => node.id);
        let matchedNodeIds: string[] = structuredNodeIds.slice(0, limit);
        let usedVectorSearch = false;

        if (structuredNodeIds.length > 0) {
            const semanticQuery = parsed.semanticQuery.trim();
            if (semanticQuery && parsedAt) {
                matchedNodeIds = rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit);
            } else if (semanticQuery && openAiClient) {
                const embeddingTable = await app.pg.query<{ table_name: string | null }>(
                    `
                    SELECT to_regclass('public.document_node_embeddings') AS table_name
                    `,
                );

                if (embeddingTable.rows[0]?.table_name) {
                    let semanticVector: number[] | null = null;
                    try {
                        const embeddingResponse = await openAiClient.embeddings.create({
                            model: embeddingModel,
                            input: semanticQuery,
                        });
                        semanticVector = Array.isArray(embeddingResponse.data?.[0]?.embedding)
                            ? embeddingResponse.data[0].embedding
                            : null;
                    } catch (error) {
                        request.log.warn({ error }, "Failed to embed chat query; using structured filtering only.");
                    }

                    if (semanticVector) {
                        const vectorLiteral = `[${semanticVector.join(",")}]`;
                        const vectorRows = await app.pg.query<{ node_id: string; score: number }>(
                            `
                            SELECT
                                node_id,
                                1 - (embedding <=> $3::vector) AS score
                            FROM document_node_embeddings
                            WHERE doc_id = $1
                              AND node_id = ANY($2::text[])
                              AND 1 - (embedding <=> $3::vector) >= $5
                            ORDER BY embedding <=> $3::vector
                            LIMIT $4
                            `,
                            [id, structuredNodeIds, vectorLiteral, limit, minScore],
                        );

                        matchedNodeIds = vectorRows.rows.map((row: { node_id: string }) => row.node_id);
                        usedVectorSearch = true;
                    }
                }
            }
        }

        const structuredNodeById = new Map(structuredFilteredNodes.map((node) => [node.id, node]));
        const rankedNodes: CardNodeForSearch[] = matchedNodeIds
            .map((nodeId) => structuredNodeById.get(nodeId))
            .filter((node): node is CardNodeForSearch => Boolean(node));
        const contextNodes = (rankedNodes.length > 0 ? rankedNodes : structuredFilteredNodes).slice(0, 40);

        const fallbackApplyFilter = /\b(show|list|find|filter|display|only)\b/i.test(rawMessage);
        let applyFilter = fallbackApplyFilter;
        const canvasReference = parsedAt ? "selected point in time" : "current canvas";
        let replyText = contextNodes.length > 0
            ? `I found ${contextNodes.length} relevant nodes on the ${canvasReference}.`
            : `I could not find relevant nodes on the ${canvasReference}.`;

        if (openAiClient) {
            const historyText = conversation
                .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
                .join("\n");
            const contextText = contextNodes.map((node, index) => (
                `${index + 1}. id=${node.id}; label=${node.label}; title=${truncateText(node.title, 160)}; description=${truncateText(node.description, 260)}`
            )).join("\n");

            const responsePrompt = [
                "You are an assistant for a research canvas.",
                "Use ONLY the provided node context and conversation.",
                "Decide whether the user wants to filter the canvas.",
                "Return ONLY JSON with this shape:",
                "{",
                '  "reply": "string",',
                '  "applyFilter": boolean',
                "}",
                "Rules:",
                "- applyFilter=true ONLY when user explicitly asks to show/list/filter/display nodes on the canvas.",
                "- applyFilter=false for summarization, explanation, or Q&A requests.",
                "- Keep reply concise and grounded in node context.",
                "",
                "Conversation history:",
                historyText || "(none)",
                "",
                `User message: ${rawMessage}`,
                "",
                "Retrieved nodes:",
                contextText || "(none)",
            ].join("\n");

            try {
                const response = await openAiClient.responses.create({
                    model: process.env.OPENAI_CANVAS_CHAT_MODEL || process.env.OPENAI_QUERY_PARSER_MODEL || "gpt-5-nano",
                    input: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "input_text",
                                    text: responsePrompt,
                                },
                            ],
                        },
                    ],
                });

                const rawOutput = response.output_text ?? "";
                const parsedOutput = JSON.parse(extractJsonObject(rawOutput)) as { reply?: unknown; applyFilter?: unknown };
                if (typeof parsedOutput.reply === "string" && parsedOutput.reply.trim().length > 0) {
                    replyText = parsedOutput.reply.trim();
                }
                if (typeof parsedOutput.applyFilter === "boolean") {
                    applyFilter = parsedOutput.applyFilter || fallbackApplyFilter;
                }
            } catch (error) {
                request.log.warn({ error }, "Canvas chat response generation failed; using fallback reply.");
            }
        }

        if (applyFilter && matchedNodeIds.length === 0) {
            replyText = `I applied the filter, but no matching nodes were found on the ${canvasReference}.`;
        }

        return reply.send({
            reply: replyText,
            applyFilter,
            matchedNodeIds: applyFilter ? matchedNodeIds : [],
            parsed,
            usedVectorSearch,
        });
    });

    /**
     * Compare newly generated cards against existing canvas cards using embeddings.
     * POST /api/state/:id/cards/similarity
     */
    app.post("/state/:id/cards/similarity", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        const body = request.body as CompareCardsSimilarityBody;
        const normalizeCard = (raw: SimilarityCardInput): { id: string; label: string; title: string; description: string } | null => {
            const cardId = typeof raw.id === "string" ? raw.id.trim() : "";
            if (!cardId) return null;
            const normalizedLabelRaw = typeof raw.label === "string" ? raw.label.trim().toLowerCase() : "";
            const label = normalizedLabelRaw === "task" ? "requirement" : normalizedLabelRaw;
            return {
                id: cardId,
                label,
                title: typeof raw.title === "string" ? raw.title : "",
                description: typeof raw.description === "string" ? raw.description : "",
            };
        };

        const newCards = Array.isArray(body?.newCards)
            ? body.newCards.map(normalizeCard).filter((card): card is { id: string; label: string; title: string; description: string } => Boolean(card)).slice(0, 160)
            : [];
        const existingCards = Array.isArray(body?.existingCards)
            ? body.existingCards.map(normalizeCard).filter((card): card is { id: string; label: string; title: string; description: string } => Boolean(card)).slice(0, 500)
            : [];

        if (newCards.length === 0) {
            return reply.send({ matches: [] });
        }

        if (existingCards.length === 0 || !openAiClient) {
            return reply.send({
                matches: newCards.map((card) => ({
                    newCardId: card.id,
                    existingCardId: null,
                    similarity: 0,
                })),
            });
        }

        const allCards = [...newCards, ...existingCards];
        const embeddingInputs = allCards.map((card) => embeddingTextFromCard(card));

        try {
            const embeddingResponse = await openAiClient.embeddings.create({
                model: embeddingModel,
                input: embeddingInputs,
            });

            const vectors = Array.isArray(embeddingResponse.data)
                ? embeddingResponse.data.map((item) => item.embedding).filter((v): v is number[] => Array.isArray(v))
                : [];

            if (vectors.length !== allCards.length) {
                request.log.warn(
                    { expected: allCards.length, actual: vectors.length },
                    "Unexpected similarity embeddings response length.",
                );
                return reply.send({
                    matches: newCards.map((card) => ({
                        newCardId: card.id,
                        existingCardId: null,
                        similarity: 0,
                    })),
                });
            }

            const newVectors = vectors.slice(0, newCards.length);
            const existingVectors = vectors.slice(newCards.length);

            const matches = newCards.map((newCard, index) => {
                const sourceVector = newVectors[index];
                let bestId: string | null = null;
                let bestSimilarity = 0;

                for (let i = 0; i < existingCards.length; i++) {
                    const existingCard = existingCards[i];
                    if (existingCard.label !== newCard.label) continue;

                    const similarity = cosineSimilarity(sourceVector, existingVectors[i]);
                    if (similarity > bestSimilarity) {
                        bestSimilarity = similarity;
                        bestId = existingCard.id;
                    }
                }

                return {
                    newCardId: newCard.id,
                    existingCardId: bestId,
                    similarity: Number.isFinite(bestSimilarity) ? bestSimilarity : 0,
                };
            });

            return reply.send({ matches });
        } catch (error) {
            request.log.warn({ error }, "Failed to compare card similarities with embeddings.");
            return reply.send({
                matches: newCards.map((card) => ({
                    newCardId: card.id,
                    existingCardId: null,
                    similarity: 0,
                })),
            });
        }
    });

    /**
     * Load all documents
     * GET /api/state/
     */
    app.get("/state", async (request, reply) => {
        const { rows } = await app.pg.query(
            `
            SELECT id, title, description, version, updated_at, review_only
            FROM documents
            `
        );

        return rows;
    });

    /**
     * Export a project as a portable .vi binary bundle.
     * GET /api/state/:id/export-vi
     */
    app.get("/state/:id/export-vi", async (request, reply) => {
        const { id } = request.params as { id: string };

        const documentResult = await app.pg.query<{
            id: string;
            title: string;
            description: string | null;
            state: unknown;
            timeline: unknown;
            version: number;
            created_at: string;
            updated_at: string;
        }>(
            `
            SELECT id, title, description, state, timeline, version, created_at, updated_at
            FROM documents
            WHERE id = $1
            `,
            [id],
        );

        const documentRow = documentResult.rows[0];
        if (!documentRow) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const revisionRows = await app.pg.query<{
            version: number;
            captured_at: string;
            state: unknown;
            timeline: unknown;
        }>(
            `
            SELECT version, captured_at, state, timeline
            FROM document_state_revisions
            WHERE document_id = $1
            ORDER BY captured_at ASC, version ASC, id ASC
            `,
            [id],
        );

        const revisions: ProjectViBundleV1["revisions"] = revisionRows.rows.map((row: {
            version: number;
            captured_at: string;
            state: unknown;
            timeline: unknown;
        }) => ({
            version: Number.isFinite(row.version) ? Math.max(1, Math.trunc(row.version)) : 1,
            capturedAt: new Date(row.captured_at).toISOString(),
            state: row.state ?? {},
            timeline: row.timeline ?? {},
        }));

        const fileRows = await app.pg.query<{
            id: string;
            name: string;
            mime_type: string | null;
            ext: string | null;
            size_bytes: number | null;
            sha256: string | null;
            created_at: string;
            storage_bucket: string | null;
            storage_key: string | null;
        }>(
            `
            SELECT
                id,
                name,
                mime_type,
                ext,
                size_bytes,
                sha256,
                created_at,
                storage_bucket,
                storage_key
            FROM document_files
            WHERE document_id = $1
            ORDER BY created_at ASC
            `,
            [id],
        );

        const files: ProjectViBundleV1["files"] = [];
        for (const row of fileRows.rows) {
            if (!row.storage_bucket || !row.storage_key) {
                return reply.status(500).send({
                    error: `File "${row.name}" is missing storage metadata and cannot be exported.`,
                });
            }

            const object = await app.s3.send(
                new GetObjectCommand({
                    Bucket: row.storage_bucket,
                    Key: row.storage_key,
                }),
            );

            const body = object.Body as Readable | undefined;
            if (!body) {
                return reply.status(500).send({
                    error: `File "${row.name}" could not be loaded from object storage.`,
                });
            }

            const bytes = await streamToBuffer(body);
            files.push({
                oldId: row.id,
                name: row.name,
                mimeType: row.mime_type,
                ext: row.ext,
                sizeBytes: row.size_bytes,
                sha256: row.sha256,
                createdAt: new Date(row.created_at).toISOString(),
                bytesBase64: bytes.toString("base64"),
            });
        }

        const embeddingTable = await app.pg.query<{ table_name: string | null }>(
            `
            SELECT to_regclass('public.document_node_embeddings') AS table_name
            `,
        );

        let embeddings: ProjectViBundleV1["embeddings"] = [];
        if (embeddingTable.rows[0]?.table_name) {
            const embeddingRows = await app.pg.query<{
                node_id: string;
                node_text: string;
                embedding: unknown;
            }>(
                `
                SELECT node_id, node_text, embedding
                FROM document_node_embeddings
                WHERE doc_id = $1
                ORDER BY node_id ASC
                `,
                [id],
            );

            embeddings = embeddingRows.rows.map((row: { node_id: string; node_text: string; embedding: unknown }) => ({
                nodeId: row.node_id,
                nodeText: row.node_text,
                embedding: parseVectorValue(row.embedding),
            }));
        }

        const githubEventRows = await app.pg.query<{
            repo_owner: string;
            repo_name: string;
            event_type: string;
            event_key: string;
            actor_login: string | null;
            title: string | null;
            url: string | null;
            occurred_at: string;
            issue_number: number | null;
            pr_number: number | null;
            commit_sha: string | null;
            branch_name: string | null;
            payload: unknown;
            inserted_at: string;
        }>(
            `
            SELECT
                repo_owner,
                repo_name,
                event_type,
                event_key,
                actor_login,
                title,
                url,
                occurred_at,
                issue_number,
                pr_number,
                commit_sha,
                branch_name,
                payload,
                inserted_at
            FROM document_github_events
            WHERE document_id = $1
            ORDER BY occurred_at ASC, event_key ASC
            `,
            [id],
        );

        const githubEvents: ProjectViBundleV1["githubEvents"] = githubEventRows.rows.map((row: {
            repo_owner: string;
            repo_name: string;
            event_type: string;
            event_key: string;
            actor_login: string | null;
            title: string | null;
            url: string | null;
            occurred_at: string;
            issue_number: number | null;
            pr_number: number | null;
            commit_sha: string | null;
            branch_name: string | null;
            payload: unknown;
            inserted_at: string;
        }) => ({
            repoOwner: row.repo_owner,
            repoName: row.repo_name,
            eventType: row.event_type,
            eventKey: row.event_key,
            actorLogin: row.actor_login,
            title: row.title,
            url: row.url,
            occurredAt: new Date(row.occurred_at).toISOString(),
            issueNumber: row.issue_number,
            prNumber: row.pr_number,
            commitSha: row.commit_sha,
            branchName: row.branch_name,
            payload: row.payload,
            insertedAt: new Date(row.inserted_at).toISOString(),
        }));

        const bundle: ProjectViBundleV1 = {
            format: "vitral-project",
            version: 1,
            exportedAt: new Date().toISOString(),
            source: {
                documentId: documentRow.id,
                title: documentRow.title,
            },
            document: {
                title: documentRow.title,
                description: documentRow.description,
                state: documentRow.state,
                timeline: documentRow.timeline,
                version: documentRow.version,
                createdAt: new Date(documentRow.created_at).toISOString(),
                updatedAt: new Date(documentRow.updated_at).toISOString(),
            },
            files,
            embeddings,
            githubEvents,
            revisions,
        };

        const encoded = encodeProjectVi(bundle);
        const fileName = `${sanitizeProjectFilename(documentRow.title)}.vi`;
        reply.header("Content-Type", "application/octet-stream");
        reply.header("Content-Disposition", `attachment; filename="${safeFilename(fileName)}"`);
        return reply.send(encoded);
    });

    /**
     * Import a portable .vi bundle as a review-only document.
     * POST /api/state/import-vi
     */
    app.post("/state/import-vi", async (request, reply) => {
        const parts = request.parts();
        let uploadedBytes: Buffer | null = null;

        for await (const part of parts) {
            if (part.type !== "file") continue;
            if (part.fieldname !== "file") continue;
            uploadedBytes = await streamToBuffer(part.file);
            break;
        }

        if (!uploadedBytes) {
            return reply.status(400).send({ error: 'Missing multipart file field "file"' });
        }

        let bundle: ProjectViBundleV1;
        try {
            bundle = decodeProjectVi(uploadedBytes);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Invalid .vi payload.";
            return reply.status(400).send({ error: message });
        }

        const bucket = process.env.S3_BUCKET;
        if (!bucket) {
            return reply.status(500).send({ error: "S3_BUCKET is not configured." });
        }

        const fileIdMap = new Map<string, string>();
        for (const file of bundle.files) {
            if (!fileIdMap.has(file.oldId)) {
                fileIdMap.set(file.oldId, crypto.randomUUID());
            }
        }

        const remappedState = remapStateFileReferences(bundle.document.state, fileIdMap);
        const timelinePayload = bundle.document.timeline ?? {};
        const nowIso = new Date().toISOString();

        const client = await app.pg.connect();
        try {
            await client.query("BEGIN");

            const createdDocument = await client.query<{
                id: string;
                title: string;
                description: string | null;
                version: number;
                updated_at: string;
                review_only: boolean;
            }>(
                `
                INSERT INTO documents (
                    title,
                    description,
                    state,
                    timeline,
                    version,
                    review_only,
                    github_owner,
                    github_repo,
                    github_default_branch,
                    github_linked_at,
                    github_last_synced_at
                )
                VALUES ($1, $2, $3::jsonb, $4::jsonb, 1, TRUE, NULL, NULL, NULL, NULL, NULL)
                RETURNING id, title, description, version, updated_at, review_only
                `,
                [
                    (bundle.document.title || "Untitled").trim() || "Untitled",
                    bundle.document.description ?? null,
                    JSON.stringify(remappedState),
                    JSON.stringify(timelinePayload),
                ],
            );

            const newDoc = createdDocument.rows[0];
            if (!newDoc) {
                throw new Error("Failed to create imported document.");
            }

            for (const file of bundle.files) {
                const newFileId = fileIdMap.get(file.oldId);
                if (!newFileId) continue;

                const bytes = Buffer.from(file.bytesBase64, "base64");
                const hash = crypto.createHash("sha256").update(bytes).digest("hex");
                const objectKey = `sha256/${hash}`;

                try {
                    await app.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
                } catch {
                    await app.s3.send(
                        new PutObjectCommand({
                            Bucket: bucket,
                            Key: objectKey,
                            Body: bytes,
                            ContentType: file.mimeType ?? "application/octet-stream",
                            Metadata: {
                                originalname: file.name,
                                sha256: hash,
                            },
                        }),
                    );
                }

                const parsedCreatedAt = new Date(file.createdAt);
                const createdAt = Number.isNaN(parsedCreatedAt.getTime())
                    ? nowIso
                    : parsedCreatedAt.toISOString();

                await client.query(
                    `
                    INSERT INTO document_files (
                        id,
                        document_id,
                        name,
                        mime_type,
                        ext,
                        size_bytes,
                        sha256,
                        storage_bucket,
                        storage_key,
                        created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz)
                    `,
                    [
                        newFileId,
                        newDoc.id,
                        file.name,
                        file.mimeType ?? null,
                        file.ext ?? (file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? null : null),
                        file.sizeBytes ?? bytes.length,
                        hash,
                        bucket,
                        objectKey,
                        createdAt,
                    ],
                );
            }

            for (const githubEvent of bundle.githubEvents) {
                const occurredAtDate = new Date(githubEvent.occurredAt);
                const occurredAt = Number.isNaN(occurredAtDate.getTime())
                    ? nowIso
                    : occurredAtDate.toISOString();
                const insertedAtDate = new Date(githubEvent.insertedAt);
                const insertedAt = Number.isNaN(insertedAtDate.getTime())
                    ? nowIso
                    : insertedAtDate.toISOString();

                await client.query(
                    `
                    INSERT INTO document_github_events (
                        document_id,
                        repo_owner,
                        repo_name,
                        event_type,
                        event_key,
                        actor_login,
                        title,
                        url,
                        occurred_at,
                        issue_number,
                        pr_number,
                        commit_sha,
                        branch_name,
                        payload,
                        inserted_at
                    )
                    VALUES (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9::timestamptz,
                        $10,
                        $11,
                        $12,
                        $13,
                        $14::jsonb,
                        $15::timestamptz
                    )
                    ON CONFLICT (document_id, event_type, event_key)
                    DO UPDATE SET
                        repo_owner = EXCLUDED.repo_owner,
                        repo_name = EXCLUDED.repo_name,
                        actor_login = EXCLUDED.actor_login,
                        title = EXCLUDED.title,
                        url = EXCLUDED.url,
                        occurred_at = EXCLUDED.occurred_at,
                        issue_number = EXCLUDED.issue_number,
                        pr_number = EXCLUDED.pr_number,
                        commit_sha = EXCLUDED.commit_sha,
                        branch_name = EXCLUDED.branch_name,
                        payload = EXCLUDED.payload,
                        inserted_at = EXCLUDED.inserted_at
                    `,
                    [
                        newDoc.id,
                        githubEvent.repoOwner,
                        githubEvent.repoName,
                        githubEvent.eventType,
                        githubEvent.eventKey,
                        githubEvent.actorLogin,
                        githubEvent.title,
                        githubEvent.url,
                        occurredAt,
                        githubEvent.issueNumber,
                        githubEvent.prNumber,
                        githubEvent.commitSha,
                        githubEvent.branchName,
                        JSON.stringify(githubEvent.payload ?? {}),
                        insertedAt,
                    ],
                );
            }

            const revisionsToPersist: ProjectViBundleV1["revisions"] = bundle.revisions.length > 0
                ? bundle.revisions
                : [{
                    version: Number.isFinite(bundle.document.version)
                        ? Math.max(1, Math.trunc(bundle.document.version))
                        : 1,
                    capturedAt: typeof bundle.document.updatedAt === "string" && bundle.document.updatedAt.trim() !== ""
                        ? bundle.document.updatedAt
                        : nowIso,
                    state: bundle.document.state ?? {},
                    timeline: bundle.document.timeline ?? {},
                }];

            for (const revision of revisionsToPersist) {
                const parsedCapturedAt = new Date(revision.capturedAt);
                const capturedAt = Number.isNaN(parsedCapturedAt.getTime())
                    ? nowIso
                    : parsedCapturedAt.toISOString();
                const revisionVersion = Number.isFinite(revision.version)
                    ? Math.max(1, Math.trunc(revision.version))
                    : 1;
                const remappedRevisionState = remapStateFileReferences(revision.state, fileIdMap);
                const revisionTimeline = revision.timeline ?? {};

                await client.query(
                    `
                    INSERT INTO document_state_revisions (
                        document_id,
                        version,
                        captured_at,
                        state,
                        timeline
                    )
                    VALUES ($1, $2, $3::timestamptz, $4::jsonb, $5::jsonb)
                    `,
                    [
                        newDoc.id,
                        revisionVersion,
                        capturedAt,
                        JSON.stringify(remappedRevisionState),
                        JSON.stringify(revisionTimeline),
                    ],
                );
            }

            const embeddingTable = await client.query<{ table_name: string | null }>(
                `
                SELECT to_regclass('public.document_node_embeddings') AS table_name
                `,
            );

            if (embeddingTable.rows[0]?.table_name && bundle.embeddings.length > 0) {
                const CHUNK_SIZE = 30;
                for (let offset = 0; offset < bundle.embeddings.length; offset += CHUNK_SIZE) {
                    const chunk = bundle.embeddings.slice(offset, offset + CHUNK_SIZE);
                    const valueSql: string[] = [];
                    const values: unknown[] = [];

                    for (const embeddingRow of chunk) {
                        if (!embeddingRow.nodeId) continue;
                        const embeddingValues = parseVectorValue(embeddingRow.embedding);
                        if (embeddingValues.length === 0) continue;

                        const base = values.length;
                        valueSql.push(
                            `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}::vector)`,
                        );
                        values.push(
                            newDoc.id,
                            embeddingRow.nodeId,
                            embeddingRow.nodeText ?? "",
                            vectorToLiteral(embeddingValues),
                        );
                    }

                    if (valueSql.length === 0) continue;

                    await client.query(
                        `
                        INSERT INTO document_node_embeddings (doc_id, node_id, node_text, embedding)
                        VALUES ${valueSql.join(", ")}
                        ON CONFLICT (doc_id, node_id) DO UPDATE
                        SET
                            node_text = EXCLUDED.node_text,
                            embedding = EXCLUDED.embedding,
                            updated_at = now()
                        `,
                        values,
                    );
                }
            }

            await client.query("COMMIT");
            return reply.status(201).send(newDoc);
        } catch (error) {
            await client.query("ROLLBACK");
            request.log.error({ error }, "Failed to import .vi project bundle.");
            return reply.status(500).send({ error: "Failed to import .vi file." });
        } finally {
            client.release();
        }
    });


    /**
     * Delete a document by id
     * DELETE /api/state/:id
     */
    app.delete("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        const result = await app.pg.query(
            `
            DELETE FROM documents
            WHERE id = $1
            RETURNING id
            `,
            [id]
        );

        if (result.rowCount === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return reply.status(204).send();
    });



    /**
     * Save (overwrite) a document by id (ideal for updating nodes and edges)
     * PUT /api/state/:id
     *
     * This is an UPSERT:
     * - if exists: update state (+ bump version)
     * - if not: create it with that id
     */
    app.put("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as SaveBody;

        const reviewOnly = await getDocumentReviewOnly(id);
        if (reviewOnly) {
            return reply.status(403).send({ error: "This is a review project and cannot be modified." });
        }

        if (!body || typeof body !== "object" || body.state === undefined) {
            return reply.status(400).send({ error: "Missing state" });
        }

        const title = body.title?.trim() ?? null;
        const description = body.description ?? null;
        let previousState: unknown = undefined;

        try {
            const existing = await app.pg.query<{ state: unknown }>(
                `
                SELECT state
                FROM documents
                WHERE id = $1
                `,
                [id],
            );
            previousState = existing.rows[0]?.state;
        } catch (error) {
            request.log.error({ error }, "Failed to read previous state for embeddings diff.");
        }

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (id, title, description, state, timeline, version)
            VALUES (
                $1,
                COALESCE($2, 'Untitled'),
                $3,
                $4::jsonb,
                $5::jsonb,
                1
            )
            ON CONFLICT (id) DO UPDATE
            SET
                title = COALESCE(EXCLUDED.title, documents.title),
                description = COALESCE(EXCLUDED.description, documents.description),
                state = EXCLUDED.state,
                timeline = EXCLUDED.timeline,
                version = documents.version + 1
            RETURNING id, title, description, version, updated_at, review_only
            `,
            [id, title, description, JSON.stringify(body.state), JSON.stringify(body.timeline ?? {})]
        );

        try {
            const updatedVersion = Number(rows[0]?.version ?? 1);
            const updatedAt = typeof rows[0]?.updated_at === "string"
                ? rows[0].updated_at
                : new Date().toISOString();
            await insertStateRevision(app.pg, id, updatedVersion, body.state, body.timeline ?? {});
            await persistProvenanceEvolution(app.pg, id, previousState, body.state, updatedAt);

            const delta = computeNodeEmbeddingDelta(previousState, body.state, id);

            if (delta.deletedNodeIds.length > 0) {
                await app.pg.query(
                    `
                    DELETE FROM document_node_embeddings
                    WHERE doc_id = $1
                      AND node_id = ANY($2::text[])
                    `,
                    [id, delta.deletedNodeIds],
                );
                nodeEmbeddingQueue.discard(id, delta.deletedNodeIds);
            }

            if (delta.upserts.length > 0) {
                nodeEmbeddingQueue.enqueue(delta.upserts);
            }
        } catch (error) {
            request.log.error({ error }, "Failed to process provenance or node embedding updates.");
        }

        return reply.status(200).send(rows[0]);
    });

    /**
     * Append a lightweight state revision snapshot for timeline playback.
     * POST /api/state/:id/revision
     */
    app.post("/state/:id/revision", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as RevisionBody;
        if (!await ensureDocumentWritable(id, reply)) return;

        if (!body || typeof body !== "object" || body.state === undefined) {
            return reply.status(400).send({ error: "Missing state" });
        }

        const versionRes = await app.pg.query<{ version: number }>(
            `
            SELECT version
            FROM documents
            WHERE id = $1
            `,
            [id],
        );
        if (versionRes.rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const version = Number(versionRes.rows[0]?.version ?? 1);
        await insertStateRevision(app.pg, id, version, body.state, body.timeline ?? {});
        return reply.status(204).send();
    });


    /**
     * Update document metadata
     * PATCH /api/state/:id
     */
    app.patch("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as { title?: string; description?: string | null };
        if (!await ensureDocumentWritable(id, reply)) return;

        const title = body.title?.trim();
        const description =
            body.description === undefined ? undefined : body.description;

        if (title === undefined && description === undefined) {
            return reply.status(400).send({ error: "Nothing to update" });
        }

        const { rows } = await app.pg.query(
            `
            UPDATE documents
            SET
            title = COALESCE($2, title),
            description = COALESCE($3, description),
            version = version + 1
            WHERE id = $1
            RETURNING id, title, description, version, updated_at, review_only
            `,
            [id, title ?? null, description ?? null]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Link Github repo to document
     * POST /api/state/:id/github/link
     */
    app.post("/state/:id/github/link", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { owner, repo } = request.body as { owner?: string; repo?: string };
        if (!await ensureDocumentWritable(id, reply)) return;

        if (!owner || !repo) {
            return reply.status(400).send({ error: "Missing owner or repo" });
        }

        // Validate repo access via GitHub API using user's OAuth token
        const ghToken = request.cookies["gh_access_token"];
        if (!ghToken) {
            return reply.status(401).send({ error: "Not connected to GitHub" });
        }

        // Verify repo exists & user has access
        const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!ghRes.ok) {
            return reply.status(403).send({ error: "Cannot access repository" });
        }

        const ghRepo = await ghRes.json();

        const { rows } = await app.pg.query(
            `
                UPDATE documents
                SET
                github_owner = $2,
                github_repo = $3,
                github_default_branch = $4,
                github_linked_at = now()
                WHERE id = $1
                RETURNING id, github_owner, github_repo, github_default_branch
            `,
            [id, owner, repo, ghRepo.default_branch]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return rows[0];
    });

    /**
     * Get linked repo to document
     * GET /api/state/:id/github
     */
    app.get("/state/:id/github", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await app.pg.query(
            `
            SELECT github_owner, github_repo, github_default_branch, github_linked_at
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        if (!rows[0].github_owner) {
            return reply.status(204).send();
        }

        return rows[0];
    });

    /**
     * Remove link between document and github
     * DELETE /api/state/:id/github/link
     */
    app.delete("/state/:id/github/link", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!await ensureDocumentWritable(id, reply)) return;

        const { rowCount } = await app.pg.query(
            `
            UPDATE documents
            SET
            github_owner = NULL,
            github_repo = NULL,
            github_default_branch = NULL,
            github_linked_at = NULL
            WHERE id = $1
            `,
            [id]
        );

        if (rowCount === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return reply.status(204).send();
    });

    /**
     * Get repo contents
     * GET /:id/github/contents
     */
    app.get("/state/:id/github/contents", async (request, reply) => {
        const { id } = request.params as { id: string };
        const { path = "" } = request.query as { path?: string };

        const token = request.cookies["gh_access_token"];
        if (!token) {
            return reply.status(401).send({ error: "Not connected to GitHub" });
        }

        // Get linked repo from DB
        const { rows } = await app.pg.query(
            `
            SELECT github_owner, github_repo
            FROM documents
            WHERE id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const { github_owner: owner, github_repo: repo } = rows[0];

        if (!owner || !repo) {
            return reply.status(400).send({ error: "No GitHub repo linked to document" });
        }

        // Build GitHub API URL
        const safePath = path
            ? "/" + encodeURIComponent(path).replace(/%2F/g, "/")
            : "";

        const url = `https://api.github.com/repos/${owner}/${repo}/contents${safePath}`;

        const ghRes = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
            },
        });

        if (!ghRes.ok) {
            const text = await ghRes.text();
            request.log.error(
                { status: ghRes.status, text, owner, repo, path },
                "GitHub contents fetch failed"
            );

            if (ghRes.status === 404) {
                return reply.status(404).send({ error: "Path not found in repository" });
            }

            return reply.status(502).send({ error: "Failed to fetch GitHub contents" });
        }

        const data = await ghRes.json();

        // GitHub returns:
        // - array for directories
        // - object for single file
        const items = Array.isArray(data) ? data : [data];

        return items.map((item: any) => ({
            name: item.name,
            path: item.path,
            type: item.type, // "file" | "dir"
            size: item.size,
            sha: item.sha,
        }));
    });

    /**
     * Create a new file for a document
     * POST /api/state/:docId/files
     */
    app.post("/state/:docId/files", async (request, reply) => {
        const { docId } = request.params as { docId: string };
        if (!await ensureDocumentWritable(docId, reply)) return;

        const parts = request.parts();

        let filePart:
            | { filename: string; mimetype: string; file: NodeJS.ReadableStream }
            | null = null;

        const fields: Record<string, string> = {};

        for await (const part of parts) {
            if (part.type === "file") {
                if (part.fieldname !== "file") continue;
                filePart = {
                    filename: part.filename,
                    mimetype: part.mimetype,
                    file: part.file,
                };

                break;
            } else {
                fields[part.fieldname] = String(part.value);
            }
        }

        if (!filePart) {
            return reply.code(400).send({ error: 'Missing multipart file field "file"' });
        }

        const id = fields.id;
        const name = fields.name ?? filePart.filename;
        const mimeType = fields.mimeType ?? filePart.mimetype;

        if (!id || !name) {
            return reply.code(400).send({ error: "Missing required fields: id, name" });
        }

        const bucket = process.env.S3_BUCKET!;

        const hasher = crypto.createHash("sha256");
        let size = 0;

        const chunks: Buffer[] = [];
        for await (const chunk of filePart.file) {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            chunks.push(buf);
            hasher.update(buf);
            size += buf.length;
        }
        const bytes = Buffer.concat(chunks);
        const hash = hasher.digest("hex");

        const objectKey = `sha256/${hash}`;

        try {
            await request.server.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
        } catch {
            await request.server.s3.send(
                new PutObjectCommand({
                    Bucket: bucket,
                    Key: objectKey,
                    Body: bytes,
                    ContentType: mimeType || "application/octet-stream",
                    Metadata: { originalname: name, sha256: hash },
                })
            );
        }

        const client = await request.server.pg.connect();
        try {
            const result = await client.query<{ id: string;created_at: string; }>(
                `
                INSERT INTO document_files (
                    id, document_id, name, mime_type, ext, size_bytes, sha256,
                    storage_bucket, storage_key, created_at
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
                ON CONFLICT (document_id, sha256)
                DO UPDATE SET
                    name = EXCLUDED.name,
                    mime_type = EXCLUDED.mime_type,
                    size_bytes = EXCLUDED.size_bytes,
                    storage_bucket = EXCLUDED.storage_bucket,
                    storage_key = EXCLUDED.storage_key
                RETURNING id, created_at
                `,
                [
                    id,
                    docId,
                    name,
                    mimeType,
                    name.includes(".") ? name.split(".").pop()?.toLowerCase() : null,
                    size,
                    hash,
                    bucket,
                    objectKey,
                ]
            );

            return reply.send({ fileId: result.rows[0]?.id, createdAt: result.rows[0]?.created_at, sha256: hash, sizeBytes: size, bucket, key: objectKey });
        } catch (e: any) {
            request.log.error({ err: e }, "Failed to insert document_files row");
            return reply.code(500).send({ error: e?.message ?? "DB insert failed" });
        } finally {
            client.release();
        }
    });

    type FileInfo = {
      id: string;
      docId: string;
      name: string;
      mime_type: string | null;
      size_bytes: number | null;
      sha256: string | null;
      created_at: string;
      storage_bucket: string | null;
      storage_key: string | null;
    };

    /**
     * Get files from a document
     * GET /api/state/:id/files
     */
    app.get("/state/:id/files", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        const client = await app.pg.connect();
        try {
            const res = await client.query<{
                id: string;
                docId: string;
                name: string;
                mime_type: string | null;
                size_bytes: number | null;
                sha256: string | null;
                created_at: string;

                storage_bucket: string | null;
                storage_key: string | null;
            }>(
                `
                SELECT
                    id,
                    document_id AS "docId",
                    name,
                    mime_type,
                    size_bytes,
                    sha256,
                    created_at,
                    storage_bucket,
                    storage_key
                FROM document_files
                WHERE document_id = $1
                ORDER BY created_at DESC
                `,
                [id]
            );

            const rows = res.rows as Array<{
                id: string;
                docId: string;
                name: string;
                mime_type: string | null;
                size_bytes: number | null;
                sha256: string | null;
                created_at: string;
                storage_bucket: string | null;
                storage_key: string | null;
            }>;

            const files = rows.map((r) => {
                const ext = r.name.includes(".")
                    ? r.name.split(".").pop()?.toLowerCase()
                    : undefined;

                return {
                    id: r.id,
                    docId: r.docId,
                    name: r.name,
                    mimeType: r.mime_type ?? undefined,
                    ext,
                    sizeBytes: r.size_bytes ?? undefined,
                    sha256: r.sha256 ?? undefined,
                    createdAt: new Date(r.created_at).toISOString(),

                    storage: {
                        bucket: r.storage_bucket!,
                        key: r.storage_key!,
                    }
                };
            });

            return reply.send({ files });
        } finally {
            client.release();
        }
    });

    /**
     * Delete a file from a document
     * DELETE /api/state/:docId/files/:id
     */
    app.delete("/state/:docId/files/:id", async (request, reply) => {
        const { docId } = request.params as { docId: string };
        const { id } = request.params as { id: string };
        if (!await ensureDocumentWritable(docId, reply)) return;

        const client = await request.server.pg.connect();
        try {
            const res = await client.query<{
                storage_bucket: string | null;
                storage_key: string | null;
            }>(
                `
                DELETE FROM document_files
                WHERE document_id = $1 AND id = $2
                RETURNING storage_bucket, storage_key
                `,
                [docId, id]
            );

            const row = res.rows[0];
            if (!row) {
                return reply.code(404).send({ error: "File not found" });
            }

            if (row.storage_bucket && row.storage_key) {
                try {
                    await request.server.s3.send(
                        new DeleteObjectCommand({
                            Bucket: row.storage_bucket,
                            Key: row.storage_key,
                        })
                    );
                } catch (error) {
                    request.log.warn({ err: error, docId, fileId: id }, "Failed to delete file object from storage");
                }
            }

            return reply.code(204).send();
        } finally {
            client.release();
        }
    });

    /**
     * Get file content for text-like content
     * GET /api/state/:docId/files/:id/content
     */
    app.get("/state/:docId/files/:id/content", async (request, reply) => {
        const { docId } = request.params as { docId: string };
        const { id } = request.params as { id: string };
        if (!isUuid(docId) || !isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document or file id" });
        }

        const client = await request.server.pg.connect();
        try {
            const res = await client.query<{
                id: string;
                docId: string;
                ext: string | null;
                name: string;
                mime_type: string | null;
                size_bytes: number | null;
                sha256: string | null;

                storage_bucket: string | null;
                storage_key: string | null;
                created_at: string;
            }>(
                `
                SELECT
                    id, document_id AS "docId", name, mime_type, ext, size_bytes, sha256, created_at,
                    storage_bucket, storage_key
                FROM document_files
                WHERE document_id = $1 AND id = $2
                LIMIT 1
                `,
                [
                    docId,
                    id
                ]
            );

            const row = res.rows[0];
            if (!row) return reply.code(404).send({ error: "File not found" });

            const ext = row.ext ?? "txt";
            const mimeType = row.mime_type ?? "application/octet-stream";

            // Only allow text-like content for this endpoint
            const isText =
                (ext && TEXT_EXTENSIONS.has(ext)) ||
                mimeType.startsWith("text/") ||
                mimeType === "application/json";

            if (!isText) {
                return reply.code(415).send({
                    error: "File is binary; use /api/files/:fileId/raw",
                    mimeType,
                    ext,
                });
            }

            // MinIO
            if (!row.storage_bucket || !row.storage_key) {
                return reply.code(500).send({ error: "Missing storage location for MinIO object" });
            }

            const obj = await request.server.s3.send(
                new GetObjectCommand({
                    Bucket: row.storage_bucket,
                    Key: row.storage_key,
                })
            );

            const body = obj.Body as Readable | undefined;
            if (!body) return reply.code(500).send({ error: "Missing object body" });

            const content = await streamToString(body, "utf8");

            return reply.send({
                fileId: row.id,
                docId: row.docId,
                name: row.name,
                mimeType,
                ext,
                sizeBytes: row.size_bytes ?? undefined,
                sha256: row.sha256 ?? undefined,
                createdAt: new Date(row.created_at).toISOString(),
                content,
            });
        } finally {
            client.release();
        }
    });

    /**
     * Get file content for binary content
     * GET api/state/:docId/files/:id/raw
     */
    app.get("/state/:docId/files/:id/raw", async (request, reply) => {
        const { docId } = request.params as { docId: string };
        const { id } = request.params as { id: string };
        if (!isUuid(docId) || !isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document or file id" });
        }

        const client = await request.server.pg.connect();
        try {
            const res = await client.query<{
                id: string;
                name: string;
                mime_type: string | null;

                storage_bucket: string | null;
                storage_key: string | null;
            }>(
                `
                SELECT id, name, mime_type, storage_bucket, storage_key
                FROM document_files
                WHERE document_id = $1 AND id = $2
                LIMIT 1
                `,
                [
                    docId,
                    id
                ]
            );

            const row = res.rows[0];
            if (!row) return reply.code(404).send({ error: "File not found" });

            const mimeType = row.mime_type ?? "application/octet-stream";
            reply.header("Content-Type", mimeType);
            reply.header("Content-Disposition", `inline; filename="${safeFilename(row.name)}"`);

            // MinIO
            if (!row.storage_bucket || !row.storage_key) {
                return reply.code(500).send({ error: "Missing storage location for MinIO object" });
            }

            const obj = await request.server.s3.send(
                new GetObjectCommand({ Bucket: row.storage_bucket, Key: row.storage_key })
            );

            const body = obj.Body as Readable | undefined;
            if (!body) return reply.code(500).send({ error: "Missing object body" });

            // Stream bytes
            return reply.send(body);
        } finally {
            client.release();
        }
    });

};
