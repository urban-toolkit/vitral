import OpenAI from "openai";

type PgQueryResult<T> = {
    rows: T[];
    rowCount?: number | null;
};

type PgQueryable = {
    query: <T = unknown>(queryText: string, values?: unknown[]) => Promise<PgQueryResult<T>>;
};

type LoggerLike = {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
};

type NodeEmbeddingWorkItem = {
    docId: string;
    nodeId: string;
    serializedNode: string;
};

type EmbeddableNode = {
    nodeId: string;
    serializedNode: string;
    hash: string;
};

type EmbeddableNodeMap = Map<string, EmbeddableNode>;

type NodeEmbeddingDelta = {
    upserts: NodeEmbeddingWorkItem[];
    deletedNodeIds: string[];
};

type CreateNodeEmbeddingQueueOptions = {
    pg: PgQueryable;
    logger: LoggerLike;
    model?: string;
    debounceMs?: number;
    batchSize?: number;
};

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_DEBOUNCE_MS = 1_500;
const DEFAULT_BATCH_SIZE = 16;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === "object" && value !== null;
}

function stableStringify(value: unknown): string {
    if (value === undefined) return "null";

    if (value === null || typeof value !== "object") {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }

    const entries = Object.entries(value as UnknownRecord)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);

    return `{${entries.join(",")}}`;
}

function readNodesFromState(state: unknown): unknown[] {
    if (!isRecord(state)) return [];
    const flow = state.flow;
    if (!isRecord(flow)) return [];
    return Array.isArray(flow.nodes) ? flow.nodes : [];
}

function normalizeNodePayload(node: UnknownRecord): UnknownRecord {
    const nodeId = typeof node.id === "string" ? node.id : "";
    const nodeType = typeof node.type === "string" ? node.type : "";
    const data = isRecord(node.data) ? node.data : {};

    const attachmentIds = Array.isArray(data.attachmentIds)
        ? data.attachmentIds.filter((value): value is string => typeof value === "string")
        : [];

    return {
        nodeId,
        nodeType,
        label: typeof data.label === "string" ? data.label : "",
        title: typeof data.title === "string" ? data.title : "",
        description: typeof data.description === "string" ? data.description : "",
        cardType: typeof data.type === "string" ? data.type : "",
        createdAt: typeof data.createdAt === "string" ? data.createdAt : "",
        origin: typeof data.origin === "string" ? data.origin : "",
        attachmentIds,
        rawData: data,
    };
}

function serializeNodeForEmbedding(nodePayload: UnknownRecord): string {
    const parts = [
        `Node ID: ${String(nodePayload.nodeId ?? "")}`,
        `Node type: ${String(nodePayload.nodeType ?? "")}`,
        `Card label: ${String(nodePayload.label ?? "")}`,
        `Card title: ${String(nodePayload.title ?? "")}`,
        `Card description: ${String(nodePayload.description ?? "")}`,
        `Card type: ${String(nodePayload.cardType ?? "")}`,
        `Created at: ${String(nodePayload.createdAt ?? "")}`,
        `Origin: ${String(nodePayload.origin ?? "")}`,
        `Attachment IDs: ${Array.isArray(nodePayload.attachmentIds) ? nodePayload.attachmentIds.join(", ") : ""}`,
        `Structured payload: ${stableStringify(nodePayload.rawData)}`,
    ];

    return parts.join("\n");
}

function extractEmbeddableNodes(state: unknown): EmbeddableNodeMap {
    const map: EmbeddableNodeMap = new Map();
    const nodes = readNodesFromState(state);

    for (const rawNode of nodes) {
        if (!isRecord(rawNode)) continue;
        const nodeId = typeof rawNode.id === "string" ? rawNode.id.trim() : "";
        if (!nodeId) continue;
        if (typeof rawNode.type === "string" && rawNode.type !== "card") continue;

        const payload = normalizeNodePayload(rawNode);
        const hash = stableStringify(payload);

        map.set(nodeId, {
            nodeId,
            serializedNode: serializeNodeForEmbedding(payload),
            hash,
        });
    }

    return map;
}

export function computeNodeEmbeddingDelta(previousState: unknown, nextState: unknown, docId: string): NodeEmbeddingDelta {
    const previousNodes = extractEmbeddableNodes(previousState);
    const nextNodes = extractEmbeddableNodes(nextState);

    const upserts: NodeEmbeddingWorkItem[] = [];
    for (const [nodeId, nextNode] of nextNodes.entries()) {
        const previousNode = previousNodes.get(nodeId);
        if (!previousNode || previousNode.hash !== nextNode.hash) {
            upserts.push({
                docId,
                nodeId,
                serializedNode: nextNode.serializedNode,
            });
        }
    }

    const deletedNodeIds: string[] = [];
    for (const nodeId of previousNodes.keys()) {
        if (!nextNodes.has(nodeId)) {
            deletedNodeIds.push(nodeId);
        }
    }

    return { upserts, deletedNodeIds };
}

function vectorToPgLiteral(values: number[]): string {
    return `[${values.join(",")}]`;
}

export function createNodeEmbeddingQueue({
    pg,
    logger,
    model = process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    debounceMs = Number(process.env.NODE_EMBEDDINGS_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS),
    batchSize = Number(process.env.NODE_EMBEDDINGS_BATCH_SIZE ?? DEFAULT_BATCH_SIZE),
}: CreateNodeEmbeddingQueueOptions) {
    const apiKey = process.env.OPENAI_API_KEY;
    const openai = apiKey ? new OpenAI({ apiKey }) : null;

    const pending = new Map<string, NodeEmbeddingWorkItem>();
    let timer: NodeJS.Timeout | null = null;
    let flushing = false;
    let didWarnMissingApiKey = false;
    let tableCheckDone = false;
    let tableExists = false;
    const resolvedDebounceMs = Number.isFinite(debounceMs) && debounceMs >= 0
        ? debounceMs
        : DEFAULT_DEBOUNCE_MS;
    const resolvedBatchSize = Number.isFinite(batchSize) && batchSize > 0
        ? Math.floor(batchSize)
        : DEFAULT_BATCH_SIZE;

    const ensureEmbeddingTableExists = async (): Promise<boolean> => {
        if (tableCheckDone) return tableExists;

        try {
            const res = await pg.query<{ table_name: string | null }>(
                `
                SELECT to_regclass('public.document_node_embeddings') AS table_name
                `,
            );
            tableExists = Boolean(res.rows[0]?.table_name);
        } catch (error) {
            logger.error(
                { error, component: "node-embeddings" },
                "Failed checking document_node_embeddings table availability.",
            );
            tableExists = false;
        } finally {
            tableCheckDone = true;
        }

        if (!tableExists) {
            logger.warn(
                { component: "node-embeddings" },
                "document_node_embeddings table missing; run DB migrations to enable embeddings.",
            );
        }

        return tableExists;
    };

    const enqueue = (items: NodeEmbeddingWorkItem[]) => {
        for (const item of items) {
            pending.set(`${item.docId}:${item.nodeId}`, item);
        }
        scheduleFlush();
    };

    const discard = (docId: string, nodeIds: string[]) => {
        for (const nodeId of nodeIds) {
            pending.delete(`${docId}:${nodeId}`);
        }
    };

    const scheduleFlush = () => {
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = null;
            void flush();
        }, resolvedDebounceMs);
    };

    const flush = async () => {
        if (flushing) return;
        if (pending.size === 0) return;

        if (!openai) {
            if (!didWarnMissingApiKey) {
                logger.warn(
                    { component: "node-embeddings" },
                    "OPENAI_API_KEY missing; skipping node embedding generation.",
                );
                didWarnMissingApiKey = true;
            }
            pending.clear();
            return;
        }

        const embeddingTableReady = await ensureEmbeddingTableExists();
        if (!embeddingTableReady) {
            pending.clear();
            return;
        }

        flushing = true;
        const snapshot = Array.from(pending.values());
        pending.clear();

        try {
            for (let i = 0; i < snapshot.length; i += resolvedBatchSize) {
                const chunk = snapshot.slice(i, i + resolvedBatchSize);
                const input = chunk.map((item) => item.serializedNode);
                const response = await openai.embeddings.create({
                    model,
                    input,
                });

                if (!Array.isArray(response.data) || response.data.length !== chunk.length) {
                    logger.warn(
                        {
                            expected: chunk.length,
                            actual: Array.isArray(response.data) ? response.data.length : -1,
                            component: "node-embeddings",
                        },
                        "Unexpected embeddings response length; skipping chunk.",
                    );
                    continue;
                }

                const valuesSql: string[] = [];
                const values: unknown[] = [];

                chunk.forEach((item, index) => {
                    const embedding = response.data[index]?.embedding;
                    if (!Array.isArray(embedding)) return;

                    const base = values.length;
                    valuesSql.push(
                        `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}::vector)`,
                    );
                    values.push(
                        item.docId,
                        item.nodeId,
                        item.serializedNode,
                        vectorToPgLiteral(embedding),
                    );
                });

                if (valuesSql.length === 0) continue;

                await pg.query(
                    `
                    INSERT INTO document_node_embeddings (doc_id, node_id, node_text, embedding)
                    VALUES ${valuesSql.join(", ")}
                    ON CONFLICT (doc_id, node_id) DO UPDATE
                    SET
                        node_text = EXCLUDED.node_text,
                        embedding = EXCLUDED.embedding,
                        updated_at = now()
                    `,
                    values,
                );
            }

            logger.info(
                { count: snapshot.length, component: "node-embeddings" },
                "Node embeddings updated.",
            );
        } catch (error) {
            logger.error(
                { error, component: "node-embeddings" },
                "Failed to generate or store node embeddings.",
            );
        } finally {
            flushing = false;
            if (pending.size > 0) {
                scheduleFlush();
            }
        }
    };

    return {
        enqueue,
        discard,
    };
}
