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
    label: string;
    serializedNode: string;
};

type EmbeddableNode = {
    nodeId: string;
    label: string;
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

/**
 * Bumped whenever `serializeNodeForEmbedding` changes what it feeds the model. Vectors built from
 * different text are not comparable, and the `vector(1536)` type cannot tell the difference, so the
 * version rides along in the stored `model` column: a row whose signature does not match the
 * current one is treated as missing and re-embedded.
 *
 * v2 dropped the `Card label:/Card title:/Card description:` scaffolding. Those phrases were
 * identical in every card, and two cards sharing a label shared the whole first line verbatim, so a
 * large constant component sat in every vector -- lifting every pair's cosine and squeezing the gap
 * between a real match and an unrelated one.
 */
export const EMBEDDING_TEXT_VERSION = 2;

/** What goes in the `model` column: the model that produced the vector *and* the text recipe. */
export function embeddingSignature(model: string): string {
    return `${model}@v${EMBEDDING_TEXT_VERSION}`;
}

/** `task` is the legacy alias for `requirement`, matching the app's `normalizeNodeLabel`. */
export function normalizeEmbeddingLabel(raw: unknown): string {
    const normalized = String(raw ?? "").trim().toLowerCase();
    return normalized === "task" ? "requirement" : normalized;
}

/** The card shape the embedding text is built from, shared with the similarity route. */
export type EmbeddableCard = { label: string; title: string; description: string };

/** Same recipe as the queue, for callers holding a card rather than a stored node. */
export function embeddingTextForCard(card: EmbeddableCard): string {
    return serializeNodeForEmbedding({ title: card.title, description: card.description });
}

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
    const data = isRecord(node.data) ? node.data : {};

    return {
        label: normalizeEmbeddingLabel(data.label),
        title: typeof data.title === "string" ? data.title : "",
        description: typeof data.description === "string" ? data.description : "",
    };
}

/**
 * Embedding contract: only title and description are allowed, and the label is deliberately *not*
 * among them -- it is a filter on the search, not content to be matched on. Do not add any new
 * card fields here in future changes, and bump `EMBEDDING_TEXT_VERSION` whenever this changes.
 *
 * Returns `""` for a card with neither a title nor a description. Such a card has nothing to match
 * on, and the embeddings API rejects an empty input string, so callers skip it entirely.
 */
export function serializeNodeForEmbedding(nodePayload: UnknownRecord): string {
    const title = String(nodePayload.title ?? "").trim();
    const description = String(nodePayload.description ?? "").trim();
    if (title === "") return description;
    if (description === "") return title;
    return `${title}\n\n${description}`;
}

function extractEmbeddableNodes(state: unknown): EmbeddableNodeMap {
    const map: EmbeddableNodeMap = new Map();
    const nodes = readNodesFromState(state);

    for (const rawNode of nodes) {
        if (!isRecord(rawNode)) continue;
        const nodeId = typeof rawNode.id === "string" ? rawNode.id.trim() : "";
        if (!nodeId) continue;
        const nodeType = typeof rawNode.type === "string" ? rawNode.type : "";
        const data = isRecord(rawNode.data) ? rawNode.data : {};
        const label = typeof data.label === "string" ? data.label.trim().toLowerCase() : "";
        const isEmbeddableType = nodeType === "card" || nodeType === "blueprintComponent" || label === "blueprint_component";
        if (!isEmbeddableType) continue;

        const payload = normalizeNodePayload(rawNode);
        const serializedNode = serializeNodeForEmbedding(payload);
        // Nothing to embed, and nothing another card could usefully be matched against.
        if (serializedNode === "") continue;

        map.set(nodeId, {
            nodeId,
            label: String(payload.label ?? ""),
            serializedNode,
            hash: stableStringify(payload),
        });
    }

    return map;
}

/** One card of a saved document, ready to embed. Used by the similarity route's backfill. */
export type EmbeddableCardRow = { nodeId: string; label: string; text: string };

/**
 * Every card in a saved document that can be embedded, in the exact form the queue would write.
 * Sharing this with the similarity route is what keeps the index and the reader agreeing on which
 * nodes count and what text stands for them.
 */
export function extractEmbeddableCards(state: unknown): EmbeddableCardRow[] {
    return Array.from(extractEmbeddableNodes(state).values()).map((node) => ({
        nodeId: node.nodeId,
        label: node.label,
        text: node.serializedNode,
    }));
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
                label: nextNode.label,
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
    const signature = embeddingSignature(model);

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
                        `($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector, $${base + 6})`,
                    );
                    values.push(
                        item.docId,
                        item.nodeId,
                        item.label,
                        item.serializedNode,
                        vectorToPgLiteral(embedding),
                        signature,
                    );
                });

                if (valuesSql.length === 0) continue;

                await pg.query(
                    `
                    INSERT INTO document_node_embeddings (doc_id, node_id, label, node_text, embedding, model)
                    VALUES ${valuesSql.join(", ")}
                    ON CONFLICT (doc_id, node_id) DO UPDATE
                    SET
                        label = EXCLUDED.label,
                        node_text = EXCLUDED.node_text,
                        embedding = EXCLUDED.embedding,
                        model = EXCLUDED.model,
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
