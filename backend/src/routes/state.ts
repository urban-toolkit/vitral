import type { FastifyPluginAsync } from "fastify";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import type { Readable } from "node:stream";
import path from "node:path";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { streamToString } from "../utils/streams.ts";
import { safeFilename } from "../utils/files.ts";
import { computeNodeEmbeddingDelta, createNodeEmbeddingQueue } from "../services/nodeEmbeddings.ts";
import { applyStructuredFilters, extractCardNodesForSearch, parseNaturalLanguageNodeQuery, type CardNodeForSearch } from "../services/nodeSearch.ts";

type SaveBody = {
    title?: string;
    description?: string | null;
    state: unknown;
    timeline: unknown;
};

type QueryNodesBody = {
    query?: string;
    limit?: number;
    minScore?: number;
    scopeNodeIds?: string[];
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

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (title, description, state)
            VALUES ($1, $2, $3::jsonb)
            RETURNING id, title, description, version, updated_at
            `,
            [title, description, JSON.stringify(body.state)]
        );

        try {
            const createdDocId = rows[0]?.id as string | undefined;
            if (createdDocId) {
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
            SELECT id, title, description, state, timeline, version, updated_at
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

        if (!rawQuery) {
            return reply.status(400).send({ error: "Missing query" });
        }

        const docRes = await app.pg.query<{ state: unknown }>(
            `
            SELECT state
            FROM documents
            WHERE id = $1
            `,
            [id],
        );

        if (docRes.rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        let candidateNodes = extractCardNodesForSearch(docRes.rows[0]?.state);
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

        if (!openAiClient) {
            return reply.send({
                parsed,
                matchedNodeIds: structuredNodeIds.slice(0, limit),
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
                matchedNodeIds: structuredNodeIds.slice(0, limit),
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
                matchedNodeIds: structuredNodeIds.slice(0, limit),
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

        const docRes = await app.pg.query<{ state: unknown }>(
            `
            SELECT state
            FROM documents
            WHERE id = $1
            `,
            [id],
        );

        if (docRes.rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        let candidateNodes = extractCardNodesForSearch(docRes.rows[0]?.state);
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
            if (semanticQuery && openAiClient) {
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

                        matchedNodeIds = vectorRows.rows.map((row) => row.node_id);
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
        let replyText = contextNodes.length > 0
            ? `I found ${contextNodes.length} relevant nodes on the canvas.`
            : "I could not find relevant nodes on the current canvas.";

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
            replyText = "I applied the filter, but no matching nodes were found on the current canvas.";
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
            SELECT id, title, description, version, updated_at
            FROM documents
            `
        );

        return rows;
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
            RETURNING id, title, description, version, updated_at
            `,
            [id, title, description, JSON.stringify(body.state), JSON.stringify(body.timeline)]
        );

        try {
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
            request.log.error({ error }, "Failed to process node embedding updates.");
        }

        return reply.status(200).send(rows[0]);
    });


    /**
     * Update document metadata
     * PATCH /api/state/:id
     */
    app.patch("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as { title?: string; description?: string | null };

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
            RETURNING id, title, description, version, updated_at
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
