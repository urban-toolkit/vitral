import type { FastifyPluginAsync } from "fastify";
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { PassThrough, type Readable, type Writable } from "node:stream";
import path from "node:path";
import OpenAI from "openai";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { streamToBuffer, streamToString } from "../utils/streams.js";
import { safeFilename } from "../utils/files.js";
import {
    computeNodeEmbeddingDelta,
    createNodeEmbeddingQueue,
    embeddingSignature,
    embeddingTextForCard,
    extractEmbeddableCards,
    normalizeEmbeddingLabel,
} from "../services/nodeEmbeddings.js";
import {
    applyStructuredFilters,
    applyStructuredFiltersWithFallback,
    canonicalCardLabel,
    CARD_LABEL_GLOSSARY,
    isCardLabel,
    extractCardNodesForSearch,
    extractCardRelationsForSearch,
    parseNaturalLanguageNodeQuery,
    type CardNodeForSearch,
} from "../services/nodeSearch.js";
import {
    diffProvenanceSnapshots,
    extractProvenanceSnapshot,
    resolveTreeForCard,
    type ProvenanceConnection,
    type ProvenanceSnapshot,
} from "../services/canvasProvenance.js";
import {
    createProjectViCompressStream,
    createProjectViHeader,
    decodeProjectVi,
    type ProjectViBundleV1,
} from "../utils/projectVi.js";

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
};

type SimilarityCard = { id: string; label: string; title: string; description: string };
type SimilarityStatus = "ok" | "degraded" | "unavailable";
type SimilarityCohortRow = { node_id: string; sim: number; median: number; mad: number; sampled: number };
type SimilarityMatch = {
    newCardId: string;
    candidates: Array<{ existingCardId: string; similarity: number }>;
    baseline: { median: number; mad: number; sampled: number } | null;
};

/** Cards generated from one file. Well past what any single extraction produces. */
const SIMILARITY_MAX_NEW_CARDS = 160;
/** Nearest slice of a label cohort used for both the candidates and the baseline statistics. */
const SIMILARITY_COHORT_LIMIT = 512;
/** How many candidates the client gets to reason about. It needs the runner-up, not just the best. */
const SIMILARITY_CANDIDATE_LIMIT = 8;
/** Inputs per embeddings request, matching the queue's batching. */
const SIMILARITY_EMBED_CHUNK = 96;
/** Ceiling on one backfill pass, so a never-embedded project converges over a few drops. */
const SIMILARITY_HEAL_LIMIT = 512;

const TEXT_EXTENSIONS = new Set([
    "txt", "json", "ipynb", "csv", "py", "js", "ts", "tsx", "jsx", "html", "css", "md",
]);
/**
 * How many relations between the retrieved cards the responder is shown.
 *
 * A bound rather than a budget: the context set is already capped, so this only bites on a densely
 * connected neighbourhood, where the first few dozen relations say as much about the shape as all of
 * them would.
 */
const CANVAS_CHAT_CONTEXT_RELATION_LIMIT = 60;

const DUPLICATE_FILES_INSERT_CHUNK_SIZE = 250;
const DUPLICATE_REVISIONS_INSERT_CHUNK_SIZE = 50;
const DEFAULT_VI_EXPORT_FILE_FETCH_CONCURRENCY = 4;
const MAX_VI_EXPORT_FILE_FETCH_CONCURRENCY = 16;
const EXPORT_REVISIONS_BATCH_SIZE = 50;
const EXPORT_EMBEDDINGS_BATCH_SIZE = 250;
const EXPORT_GITHUB_EVENTS_BATCH_SIZE = 250;

/**
 * Row shapes for the streaming export's keyset-paged sections.
 *
 * These are named rather than inlined into `app.pg.query<...>()` so the result
 * variable can be annotated: the page cursor is assigned from the rows and then
 * fed back into the next query's parameters, and without an annotation the
 * compiler tries to narrow the cursor through that assignment and hits a cycle.
 */
type ExportedRows<T> = { rows: T[] };

type ExportedEmbeddingRow = {
    node_id: string;
    node_text: string;
    embedding: unknown;
};

type ExportedGithubEventRow = {
    repo_owner: string;
    repo_name: string;
    event_type: string;
    event_key: string;
    actor_login: string | null;
    title: string | null;
    url: string | null;
    occurred_at: string;
    /** See `ExportedRevisionRow.cursor_captured_at`. */
    cursor_occurred_at: string;
    issue_number: number | null;
    pr_number: number | null;
    commit_sha: string | null;
    branch_name: string | null;
    payload: string | null;
    inserted_at: string;
};

type ExportedRevisionRow = {
    id: string;
    version: number;
    captured_at: string;
    /**
     * The page cursor, and the reason it is a separate `::text` column.
     *
     * `captured_at` is a microsecond `timestamptz`, but `pg` hands it over as a
     * JS `Date`, which only holds milliseconds. Feeding that back as the cursor
     * rounds it *down*, so every row sharing the truncated millisecond stays
     * greater than the cursor and comes back on the next page — the export never
     * reaches the end of the log. Postgres' own text rendering keeps the
     * microseconds, so this column round-trips exactly.
     */
    cursor_captured_at: string;
    state: string | null;
    timeline: string | null;
};

/**
 * A keyset page whose cursor does not move re-reads the same rows forever, and
 * because the export streams as it goes, that failure is an endless download
 * rather than an error anyone can see. Every paged section checks its cursor
 * moved, so the same class of bug surfaces as a failed export instead.
 */
function assertCursorAdvanced(section: string, previous: string | null, next: string): void {
    if (previous !== null && previous === next) {
        throw new Error(`Export cursor for ${section} did not advance past ${next}; aborting to avoid an endless stream.`);
    }
}

const DUPLICATE_JOB_RETENTION_MS = 60 * 60 * 1000;
const MAX_DUPLICATE_JOBS = 500;
const DUPLICATE_JOB_ERROR_MESSAGE = "Failed to duplicate project.";
// Defaults preserve the pre-refactor no-regression behavior (retrieval cap 200,
// default 60, context nodes 40). Operators can still tune these down via the
// CANVAS_CHAT_* env vars below.
const DEFAULT_CANVAS_CHAT_RETRIEVAL_LIMIT = 60;
const MAX_CANVAS_CHAT_RETRIEVAL_LIMIT = 200;
const DEFAULT_CANVAS_CHAT_CONTEXT_NODE_LIMIT = 40;
const MAX_CANVAS_CHAT_CONTEXT_NODE_LIMIT = 200;

type DuplicatedDocumentSummary = {
    id: string;
    title: string;
    description: string | null;
    version: number;
    updated_at: string;
    review_only: boolean;
};

type DuplicateJobStatus = "queued" | "running" | "succeeded" | "failed";

type DuplicateJobRecord = {
    jobId: string;
    sourceDocId: string;
    /** Who asked for the copy, and therefore who owns it. `null` for an unauthenticated caller. */
    ownerId: string | null;
    status: DuplicateJobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    result: DuplicatedDocumentSummary | null;
    error: string | null;
};

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

type ScoredNode = { id: string; score: number };

/**
 * Keyword scoring, with the scores kept.
 *
 * Two callers want two different things out of this and they cannot share one return type: a
 * *ranking* that is never empty (the exits with no embeddings) and a *match* that can be
 * (`lexicalFilterIds`, feeding the canvas filter). Scoring once and letting each take what it needs
 * is the only way those two stay consistent with each other.
 */
function rankNodesBySemanticQueryScored(
    nodes: CardNodeForSearch[],
    semanticQuery: string,
    limit: number,
): ScoredNode[] {
    const normalized = semanticQuery.trim().toLowerCase();
    // No query is no evidence: every card ranks equally, and none of them *matched*.
    if (!normalized) return nodes.slice(0, limit).map((node) => ({ id: node.id, score: 0 }));
    const tokens = (normalized.match(/[a-z0-9]{2,}/g) ?? [])
        .filter((token, index, array) => array.indexOf(token) === index);
    if (tokens.length === 0) return nodes.slice(0, limit).map((node) => ({ id: node.id, score: 0 }));

    /*
     * The card kinds the query names, in the ontology's own words.
     *
     * This ranker only ever compares literal substrings, so "what did we learn" scored nothing at all
     * against a card labelled `insight` — the user had to type the internal word. `canonicalCardLabel`
     * is the same table the structured parser uses, so the two agree about what "findings" means, and
     * a query that names a kind now lifts that kind on every path that has no embeddings to consult:
     * historical playback, no client, no index, a failed embed.
     */
    const requestedLabels = new Set<string>();
    for (const token of tokens) {
        const canonical = canonicalCardLabel(token);
        // `isCardLabel`, not `canonical !== token`: the latter is only true when a *synonym* fired, so
        // a user who typed the ontology's own word ("insight", "requirement") got no bonus at all
        // while one who typed "findings" did. `canonicalCardLabel` returns its input unchanged when
        // nothing matched, so this admits exactly the seven labels and nothing else.
        if (isCardLabel(canonical)) requestedLabels.add(canonical);
    }

    const scored = nodes.map((node) => {
        const title = node.title.toLowerCase();
        const description = node.description.toLowerCase();
        const label = node.label.toLowerCase();
        let score = 0;
        if (title.includes(normalized)) score += 14;
        if (description.includes(normalized)) score += 8;
        if (label.includes(normalized)) score += 6;
        // Worth the same as naming the label outright: the user did name it, in their own words.
        if (requestedLabels.has(label)) score += 6;
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
        .slice(0, limit);
}

/** The same ranking as ids. Never empty for a non-empty input: a ranking, not a match. */
function rankNodesBySemanticQuery(
    nodes: CardNodeForSearch[],
    semanticQuery: string,
    limit: number,
): string[] {
    return rankNodesBySemanticQueryScored(nodes, semanticQuery, limit).map((entry) => entry.id);
}

/**
 * The score below which a keyword hit is not evidence that a card is *about* something.
 *
 * The ranker above is a **ranking**: it scores every card and returns them all in order, which is
 * what the paths with no embeddings need — the alternative there is answering "nothing" whenever a
 * question is not phrased in the cards' own words. But `matchedNodeIds` is also the set the canvas is
 * filtered to, and a ranking used as a filter narrows nothing: every card scores, most of them zero,
 * and the "filter" comes back holding the whole canvas.
 *
 * So the filter takes only cards that cleared a bar a coincidence cannot. Five is the value of one
 * title token, one label match or one synonym match; a card reached only by stopwords in its
 * description scores two apiece and needs three of them, which is a fair bar for "this card is about
 * that". The tokenizer has no stopword list, so this is what stands in for one.
 */
const MIN_LEXICAL_FILTER_SCORE = 5;

/** The keyword ranking as a **match**: only cards that actually earned it. May be empty. */
function lexicalFilterIds(
    nodes: CardNodeForSearch[],
    semanticQuery: string,
    limit: number,
): string[] {
    return rankNodesBySemanticQueryScored(nodes, semanticQuery, limit)
        .filter((entry) => entry.score >= MIN_LEXICAL_FILTER_SCORE)
        .map((entry) => entry.id);
}

/**
 * The vector ranking first, then anything the keyword ranking found that it did not.
 *
 * Not a replacement, because the two rankings fail in different ways and neither is a superset. The
 * vector query can only ever return a card that *has an embedding row* and clears `minScore`, so it
 * silently omits a card written in the last second (the embedding queue is debounced), a card whose
 * enqueue threw, every card in a freshly imported project, and every card at all when the text
 * version has moved on. It also returns nothing whatsoever when a question is phrased unlike anything
 * on the canvas, which is a statement about the threshold rather than about the project.
 *
 * Appending rather than choosing costs nothing when the vector pass did well -- its results stay in
 * front, in its order -- and is the difference between an answer and a shrug when it did not.
 */
function unionRankedNodeIds(
    vectorIds: readonly string[],
    lexicalIds: readonly string[],
    limit: number,
): string[] {
    const seen = new Set<string>(vectorIds);
    const merged = [...vectorIds];
    for (const id of lexicalIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
    }
    return merged.slice(0, limit);
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

/**
 * Splice a `jsonb::text` column straight into the export stream.
 *
 * The export used to let `pg` parse each snapshot into a JS object graph and
 * then `JSON.stringify` it back out — two full passes over ~100 MB, and 1204
 * live object graphs on the heap, to reproduce bytes Postgres had already
 * rendered. Selecting `::text` and passing it through skips both. The extra
 * whitespace `jsonb::text` emits costs nothing once compressed.
 */
function jsonbText(raw: unknown): string {
    return typeof raw === "string" && raw.trim() !== "" ? raw : "null";
}

/** As `jsonbText`, but for the columns the bundle guarantees as objects. */
function jsonbObjectText(raw: unknown): string {
    const text = jsonbText(raw);
    return text === "null" ? "{}" : text;
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

/**
 * pgvector renders a vector as `[0.1,0.2,...]`, which is already the JSON the
 * bundle wants — no reason to parse it into numbers and re-print them. Falls
 * back to `parseVectorValue` if a driver ever hands the column over parsed.
 */
function vectorText(raw: unknown): string {
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed;
    }
    return JSON.stringify(parseVectorValue(raw));
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

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
    // An unset-but-declared env var arrives as "" (Number("") === 0), and "0"/negatives
    // are not positive ints; all of these must fall back to the default, not collapse to 1.
    if (value === undefined || value.trim() === "") return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.floor(parsed);
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
    if (items.length === 0) return [];
    const normalizedChunkSize = Math.max(1, Math.trunc(chunkSize));
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += normalizedChunkSize) {
        chunks.push(items.slice(index, index + normalizedChunkSize));
    }
    return chunks;
}

async function mapWithConcurrencyLimit<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const normalizedConcurrency = Math.max(1, Math.min(items.length, Math.trunc(concurrency)));
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const workers = Array.from({ length: normalizedConcurrency }, async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= items.length) return;
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    });

    await Promise.all(workers);
    return results;
}

async function writeChunk(writable: Writable, chunk: string | Buffer): Promise<void> {
    if (writable.write(chunk)) return;
    await once(writable, "drain");
}

function pruneDuplicateJobs(duplicateJobs: Map<string, DuplicateJobRecord>): void {
    const now = Date.now();
    for (const [jobId, job] of duplicateJobs) {
        const finishedAtMs = job.finishedAt ? Date.parse(job.finishedAt) : null;
        if (finishedAtMs !== null && Number.isFinite(finishedAtMs)) {
            if (finishedAtMs + DUPLICATE_JOB_RETENTION_MS < now) {
                duplicateJobs.delete(jobId);
            }
        }
    }

    while (duplicateJobs.size > MAX_DUPLICATE_JOBS) {
        const oldestKey = duplicateJobs.keys().next().value as string | undefined;
        if (!oldestKey) break;
        duplicateJobs.delete(oldestKey);
    }
}

function createDuplicateJob(sourceDocId: string, ownerId: string | null): DuplicateJobRecord {
    return {
        jobId: crypto.randomUUID(),
        sourceDocId,
        ownerId,
        status: "queued",
        createdAt: new Date().toISOString(),
        startedAt: null,
        finishedAt: null,
        result: null,
        error: null,
    };
}

function remapFileReferencesInValue(value: unknown, fileIdMap: Map<string, string>): unknown {
    if (Array.isArray(value)) {
        let changed = false;
        const nextItems = value.map((item) => {
            const nextItem = remapFileReferencesInValue(item, fileIdMap);
            if (nextItem !== item) changed = true;
            return nextItem;
        });
        return changed ? nextItems : value;
    }

    if (!isRecord(value)) return value;

    let changed = false;
    const nextValue: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(value)) {
        let mapped: unknown = raw;

        if (key === "attachmentIds" && Array.isArray(raw)) {
            const currentAttachmentIds = raw.filter((entry): entry is string => typeof entry === "string");
            const nextAttachmentIds = currentAttachmentIds.map((entry) => fileIdMap.get(entry) ?? entry);
            mapped = arraysEqual(currentAttachmentIds, nextAttachmentIds) ? raw : nextAttachmentIds;
        } else if ((key === "origin" || key === "fileId") && typeof raw === "string") {
            mapped = fileIdMap.get(raw) ?? raw;
        } else {
            mapped = remapFileReferencesInValue(raw, fileIdMap);
        }

        if (mapped !== raw) changed = true;
        nextValue[key] = mapped;
    }

    return changed ? nextValue : value;
}

/**
 * A revision as duplication reads it: every column already a string.
 *
 * Named rather than inlined for the reason the export's own row types give — the keyset cursor is
 * assigned out of the rows and fed back into the next query's parameters, and without an annotation
 * the compiler tries to narrow the cursor through that assignment and hits a cycle.
 */
type DuplicatedRevisionRow = {
    id: string;
    version: number;
    /**
     * Selected but unused, and it has to be.
     *
     * A bare name in `ORDER BY` resolves against the **output** column list before the input one, so
     * aliasing the text form back onto `captured_at` would silently make the sort lexicographic over
     * rendered timestamps rather than chronological over the column. That is the same trap the export
     * sidesteps by naming its text copy `cursor_captured_at`, and here it would be worse than a
     * cosmetic reordering: the keyset predicate compares the real `timestamptz`, so an order that
     * disagreed with it would skip rows between pages.
     */
    captured_at: string;
    /** `::text`, so the microseconds survive: `pg` hands a `timestamptz` back as a millisecond `Date`. */
    cursor_captured_at: string;
    state: string;
    timeline: string;
};

/**
 * Every `uuid`-shaped run in a state document. Anchored to nothing: the map lookup below is what
 * decides whether a match means anything, so this only has to be a cheap over-approximation.
 */
const UUID_IN_TEXT = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/**
 * `remapStateFileReferences`, over the serialized form.
 *
 * The object walk above it exists because a copy needs new `document_files` rows, so every reference
 * to a source file id has to be repointed. Doing that by rebuilding the graph costs a parse, a full
 * structural rebuild and a re-print of every byte of a project's history; doing it on the text costs
 * one scan. **Only ids that are actually in the map are rewritten** — the pattern is a filter for the
 * lookup, not the decision — so nothing else in the document can be touched by accident.
 *
 * It rewrites a matching id wherever it appears, where the object walk only visited
 * `attachmentIds`/`origin`/`fileId` under `flow.nodes`. That is a harmless superset rather than a
 * repair: today those three keys are the only place a file id is stored — no edge carries one — so
 * the two agree on every state this codebase writes. The wider scope is simply what a text pass can
 * cheaply guarantee, and it stays correct if a fourth key is ever added, because a file id is a
 * `crypto.randomUUID()` that exists for no other purpose. Only ids present in the map are touched.
 */
function remapFileReferencesInStateText(stateText: string, fileIdMap: Map<string, string>): string {
    if (fileIdMap.size === 0 || !stateText) return stateText;
    return stateText.replace(UUID_IN_TEXT, (match) => fileIdMap.get(match) ?? match);
}

function remapStateFileReferences(state: unknown, fileIdMap: Map<string, string>): unknown {
    if (!isRecord(state)) return state;
    const flow = state.flow;
    if (!isRecord(flow)) return state;
    if (!Array.isArray(flow.nodes)) return state;

    let changed = false;
    const remappedNodes = flow.nodes.map((rawNode) => {
        const remappedNode = remapFileReferencesInValue(rawNode, fileIdMap);
        if (remappedNode !== rawNode) changed = true;
        return remappedNode;
    });

    if (!changed) return state;

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
    title: string | null;
    description: string | null;
};

type LoadedSnapshot = {
    state: unknown;
    timeline: unknown;
    capturedAt: string;
    version: number;
    /**
     * What the project is called and what its author says it is for.
     *
     * Read off the `documents` row this function already selects, so it costs nothing, and carried
     * on every snapshot rather than only the current one: a revision is a state of *this* project,
     * and the project's name does not change with the playhead. The canvas assistant needs both to
     * answer "what is this study about" at all.
     */
    title: string | null;
    description: string | null;
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
    const toTimeMs = (value: string): number | null => {
        const ms = Date.parse(value);
        return Number.isNaN(ms) ? null : ms;
    };

    const current = await pg.query<DocumentSnapshotRow>(
        `
        SELECT state, timeline, updated_at, version, title, description
        FROM documents
        WHERE id = $1
        `,
        [docId],
    );
    if (current.rows.length === 0) return null;
    const currentRow = current.rows[0];
    const currentSnapshot: LoadedSnapshot = {
        state: currentRow.state,
        timeline: currentRow.timeline,
        capturedAt: currentRow.updated_at,
        version: currentRow.version,
        title: currentRow.title,
        description: currentRow.description,
    };

    if (!parsedAt) {
        const latestRevision = await pg.query<{
            state: unknown;
            timeline: unknown;
            captured_at: string;
            version: number;
        }>(
            `
            SELECT state, timeline, captured_at, version
            FROM document_state_revisions
            WHERE document_id = $1
            ORDER BY captured_at DESC
            LIMIT 1
            `,
            [docId],
        );
        if (latestRevision.rows.length === 0) return currentSnapshot;

        const revisionRow = latestRevision.rows[0];
        const revisionSnapshot: LoadedSnapshot = {
            state: revisionRow.state,
            timeline: revisionRow.timeline,
            capturedAt: revisionRow.captured_at,
            version: revisionRow.version,
            // A revision is a state of this project, so it keeps the project's own name and goal.
            title: currentRow.title,
            description: currentRow.description,
        };
        const currentMs = toTimeMs(currentSnapshot.capturedAt);
        const revisionMs = toTimeMs(revisionSnapshot.capturedAt);
        if (currentMs === null) return revisionSnapshot;
        if (revisionMs === null) return currentSnapshot;
        return revisionMs > currentMs ? revisionSnapshot : currentSnapshot;
    }

    const latestRevisionAtOrBefore = await pg.query<{
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

    const currentMs = toTimeMs(currentSnapshot.capturedAt);
    const parsedAtMs = parsedAt.getTime();
    const currentValidForAt = currentMs !== null && currentMs <= parsedAtMs;

    if (latestRevisionAtOrBefore.rows.length > 0) {
        const revisionRow = latestRevisionAtOrBefore.rows[0];
        const revisionSnapshot: LoadedSnapshot = {
            state: revisionRow.state,
            timeline: revisionRow.timeline,
            capturedAt: revisionRow.captured_at,
            version: revisionRow.version,
            // A revision is a state of this project, so it keeps the project's own name and goal.
            title: currentRow.title,
            description: currentRow.description,
        };
        if (!currentValidForAt) return revisionSnapshot;
        const revisionMs = toTimeMs(revisionSnapshot.capturedAt);
        if (revisionMs === null) return currentSnapshot;
        return revisionMs > (currentMs ?? Number.MIN_SAFE_INTEGER)
            ? revisionSnapshot
            : currentSnapshot;
    }

    if (currentValidForAt) return currentSnapshot;

    const earliestRevision = await pg.query<{
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
    if (earliestRevision.rows.length > 0) {
        const row = earliestRevision.rows[0];
        return {
            state: row.state,
            timeline: row.timeline,
            capturedAt: row.captured_at,
            version: row.version,
            title: currentRow.title,
            description: currentRow.description,
        };
    }

    return currentSnapshot;
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
    const hasChanges =
        diff.cardCreated.length > 0 ||
        diff.cardUpdated.length > 0 ||
        diff.cardDeleted.length > 0 ||
        diff.connectionCreated.length > 0 ||
        diff.connectionUpdated.length > 0 ||
        diff.connectionDeleted.length > 0;
    if (!hasChanges) return;

    for (const card of diff.cardCreated) {
        const tree = resolveTreeForCard(currentSnapshot, card.nodeId);
        const createdAt = card.createdAt || occurredAt;
        await insertCardEvent(pg, {
            docId,
            occurredAt: createdAt,
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
        const createdAt = card.createdAt || occurredAt;
        await upsertCardCreationEventState(pg, {
            docId,
            occurredAt: createdAt,
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
        const createdAt = card.createdAt || occurredAt;
        await upsertCardCreationEventState(pg, {
            docId,
            occurredAt: createdAt,
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

    /**
     * The three facts every access decision needs. `owner_id` is NULL for projects created before
     * accounts existed; those stay everybody's, which is what keeps an in-flight study working the
     * day login is switched on.
     */
    type DocumentAccessRow = {
        review_only: boolean;
        published: boolean;
        owner_id: string | null;
    };

    const getDocumentAccess = async (docId: string): Promise<DocumentAccessRow | null> => {
        const result = await app.pg.query<DocumentAccessRow>(
            `
            SELECT review_only, published, owner_id
            FROM documents
            WHERE id = $1
            `,
            [docId],
        );
        if (result.rows.length === 0) return null;
        const row = result.rows[0];
        return {
            review_only: Boolean(row.review_only),
            published: Boolean(row.published),
            owner_id: row.owner_id ?? null,
        };
    };

    /** Owned by nobody (legacy) or owned by this caller. */
    const isDocumentOwner = (access: DocumentAccessRow, userId: string | null): boolean => (
        access.owner_id === null || (userId !== null && access.owner_id === userId)
    );

    /**
     * Publishing is *visibility*, and it is what makes a project readable by someone who does not
     * own it. It deliberately grants no write: a published project stays editable by its owner and
     * read-only for everyone else, which is the difference between it and `review_only` — a
     * permanent lock that applies to the owner too.
     */
    const canReadDocument = (access: DocumentAccessRow, userId: string | null): boolean => (
        access.published || isDocumentOwner(access, userId)
    );

    const canWriteDocument = (access: DocumentAccessRow, userId: string | null): boolean => (
        !access.review_only && isDocumentOwner(access, userId)
    );

    /**
     * 404 for a document that does not exist *and* for one this caller may not read.
     *
     * The two are the same answer on purpose: a 403 on a private project confirms the id names
     * something real, which turns `GET /state/:id` into a way of enumerating other people's work.
     */
    const ensureDocumentReadable = async (
        docId: string,
        request: any,
        reply: any,
    ): Promise<DocumentAccessRow | null> => {
        const access = await getDocumentAccess(docId);
        if (!access) {
            reply.status(404).send({ error: "Document not found" });
            return null;
        }
        const user = await app.currentUser(request);
        if (!canReadDocument(access, user?.id ?? null)) {
            reply.status(404).send({ error: "Document not found" });
            return null;
        }
        return access;
    };

    /**
     * Same shape as before — `if (!await ensureDocumentWritable(id, request, reply)) return;` — with
     * ownership folded in beside the review-only check. Every existing caller keeps working; the
     * added `request` argument is what lets it see who is asking.
     */
    const ensureDocumentWritable = async (
        docId: string,
        request: any,
        reply: any,
    ): Promise<boolean> => {
        const access = await getDocumentAccess(docId);
        if (!access) {
            reply.status(404).send({ error: "Document not found" });
            return false;
        }
        const user = await app.currentUser(request);
        if (!canReadDocument(access, user?.id ?? null)) {
            // Unreadable and unwritable are the same 404 for the same reason as above.
            reply.status(404).send({ error: "Document not found" });
            return false;
        }
        if (access.review_only) {
            reply.status(403).send({ error: "This is a review project and cannot be modified." });
            return false;
        }
        if (!isDocumentOwner(access, user?.id ?? null)) {
            reply.status(403).send({
                error: "This project belongs to someone else. Duplicate it to make changes.",
            });
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
        // A project belongs to whoever made it. Signed out, `owner_id` is NULL and the project
        // behaves like the pre-accounts ones — visible and editable by anyone with the link.
        const creator = await app.currentUser(request);

        const { rows } = await app.pg.query(
            `
            INSERT INTO documents (title, description, state, timeline, owner_id)
            VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
            RETURNING id, title, description, version, updated_at, review_only, published, owner_id
            `,
            [title, description, JSON.stringify(body.state), JSON.stringify(timeline), creator?.id ?? null]
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

        const { rows } = await app.pg.query<{
            id: string;
            title: string;
            description: string | null;
            review_only: boolean;
            published: boolean;
            published_at: string | null;
            owner_id: string | null;
            owner_username: string | null;
        }>(
            `
            SELECT
                d.id, d.title, d.description, d.review_only,
                d.published, d.published_at, d.owner_id,
                u.username AS owner_username
            FROM documents d
            LEFT JOIN app_users u ON u.id = d.owner_id
            WHERE d.id = $1
            `,
            [id]
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const viewer = await app.currentUser(request);
        const access = {
            review_only: Boolean(rows[0].review_only),
            published: Boolean(rows[0].published),
            owner_id: rows[0].owner_id ?? null,
        };
        // Same 404 as a missing document: a 403 here would confirm that this id names somebody's
        // real, private project.
        if (!canReadDocument(access, viewer?.id ?? null)) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const snapshot = await loadSnapshotAt(app.pg, id, null);
        if (!snapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return {
            ...rows[0],
            // What the editor actually needs to know. `review_only` alone stopped being the whole
            // answer once a project could be somebody else's: opening a published project you do
            // not own is read-only for you and fully editable for them.
            can_edit: canWriteDocument(access, viewer?.id ?? null),
            is_owner: isDocumentOwner(access, viewer?.id ?? null),
            state: snapshot.state,
            timeline: snapshot.timeline,
            version: snapshot.version,
            updated_at: snapshot.capturedAt,
        };
    });

    /**
     * Load the closest saved canvas snapshot at or before a timestamp.
     * GET /api/state/:id/state-at?at=ISO
     */
    app.get("/state/:id/state-at", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!await ensureDocumentReadable(id, request, reply)) return;
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
        if (!await ensureDocumentReadable(id, request, reply)) return;
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
        const snapshotAt = await loadSnapshotAt(app.pg, id, effectiveAt);
        if (!snapshotAt) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const currentSnapshot = await loadSnapshotAt(app.pg, id, null);
        if (!currentSnapshot) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const snapshotGraph = extractProvenanceSnapshot(currentSnapshot.state, { at: effectiveAt });
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
        if (isRecord(currentSnapshot.state) && isRecord(currentSnapshot.state.flow) && Array.isArray(currentSnapshot.state.flow.nodes)) {
            for (const rawNode of currentSnapshot.state.flow.nodes) {
                if (!isRecord(rawNode)) continue;
                const nodeId = typeof rawNode.id === "string" ? rawNode.id : "";
                if (!nodeId) continue;
                if (!snapshotGraph.cards.has(nodeId)) continue;
                const data = isRecord(rawNode.data) ? rawNode.data : {};
                const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
                const parsed = new Date(createdAt);
                fallbackCreatedAtByNodeId.set(
                    nodeId,
                    Number.isNaN(parsed.getTime()) ? effectiveAt.toISOString() : parsed.toISOString(),
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
                occurredAt: fallbackCreatedAtByNodeId.get(card.nodeId) ?? effectiveAt.toISOString(),
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

        const timelineBlueprintEvents = extractBlueprintEventsFromTimeline(snapshotAt.timeline);
        const blueprintByComponentNodeId = new Map(
            timelineBlueprintEvents.map((event) => [event.componentNodeId, event] as const),
        );

        const blueprintLinks = activeConnections
            .map((row) => {
                const targetIsBlueprint = row.target_label === "blueprint_component";
                const sourceIsCard =
                    row.source_label === "person" ||
                    row.source_label === "activity" ||
                    row.source_label === "requirement" ||
                    row.source_label === "concept" ||
                    row.source_label === "insight" ||
                    row.source_label === "object";
                // Enforce directional links only: card -> blueprint component.
                if (!targetIsBlueprint || !sourceIsCard) return null;

                const componentNodeId = row.target_node_id;
                const cardNodeId = row.source_node_id;
                const cardLabel = row.source_label;
                const cardTitle = row.source_title;
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
        const minAt = bounds?.min_at ?? snapshotAt.capturedAt;
        const maxAt = bounds?.max_at ?? snapshotAt.capturedAt;

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
        // The same relaxation the chat handler uses, and needed here for the same reason plus one
        // more: `handleToggleLabelWithQueryRefresh` re-runs the *chat message* through this route
        // every time a sidebar chip is toggled while a chat filter is up. Left as it was, a filter
        // the chat had just found would blank the canvas on the next chip click.
        const structuredFilteredNodes = applyStructuredFiltersWithFallback(
            candidateNodes,
            parsed.structuredFilters,
        ).nodes;
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
        // Every other exit above falls back to `rankNodesBySemanticQuery`; this one used to take the
        // vector answer or nothing, so the one path with embeddings working was the only path that
        // could return an empty list for a question the project answers.
        //
        // `lexicalFilterIds`, not the ranking: this array *is* the canvas filter, and the ranking
        // scores every card in scope, so unioning it in would pad the filter out to the whole canvas
        // and `minScore` would stop bounding anything. Only keyword hits that earned their place fill
        // in behind the vector answer.
        const matchedNodeIds = unionRankedNodeIds(
            vectorMatchedIds,
            lexicalFilterIds(structuredFilteredNodes, semanticQuery, limit),
            limit,
        );

        return reply.send({
            parsed,
            matchedNodeIds,
            usedVectorSearch: vectorMatchedIds.length > 0,
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
        const maxChatRetrievalLimit = parsePositiveIntEnv(
            process.env.CANVAS_CHAT_MAX_RETRIEVAL_LIMIT,
            MAX_CANVAS_CHAT_RETRIEVAL_LIMIT,
        );
        const defaultChatRetrievalLimit = Math.min(
            parsePositiveIntEnv(process.env.CANVAS_CHAT_DEFAULT_RETRIEVAL_LIMIT, DEFAULT_CANVAS_CHAT_RETRIEVAL_LIMIT),
            maxChatRetrievalLimit,
        );
        const contextNodeLimit = Math.min(
            parsePositiveIntEnv(process.env.CANVAS_CHAT_CONTEXT_NODE_LIMIT, DEFAULT_CANVAS_CHAT_CONTEXT_NODE_LIMIT),
            parsePositiveIntEnv(process.env.CANVAS_CHAT_MAX_CONTEXT_NODE_LIMIT, MAX_CANVAS_CHAT_CONTEXT_NODE_LIMIT),
            maxChatRetrievalLimit,
        );
        const limit = Number.isFinite(requestedLimit)
            ? Math.max(1, Math.min(maxChatRetrievalLimit, Math.floor(requestedLimit)))
            : defaultChatRetrievalLimit;
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

        const parsed = await parseNaturalLanguageNodeQuery(openAiClient, rawMessage, app.log, conversation);
        /*
         * Structured filters, given up on one rung at a time.
         *
         * They used to be applied once and absolutely, and everything downstream was gated on the
         * result being non-empty: an inferred `titleContains` that matched nothing meant no embedding
         * search ran at all and the reply was "I could not find relevant nodes on the current canvas"
         * for a question the project could plainly answer. `applyStructuredFiltersWithFallback` keeps
         * the narrowest rung that still matches something, so a wrong guess costs precision rather
         * than the whole answer, and `relaxed` lets the reply say the question was read broadly.
         */
        const filtered = applyStructuredFiltersWithFallback(candidateNodes, parsed.structuredFilters);
        const structuredFilteredNodes = filtered.nodes;
        const structuredNodeIds = structuredFilteredNodes.map((node) => node.id);
        let matchedNodeIds: string[] = structuredNodeIds.slice(0, limit);
        /** What the reply model is shown, in order. Deliberately wider than `matchedNodeIds`. */
        let contextRankedIds: string[] = matchedNodeIds;
        let usedVectorSearch = false;

        if (structuredNodeIds.length > 0) {
            const semanticQuery = parsed.semanticQuery.trim();

            /*
             * Lexical ranking is the floor under every path, and this is the fix the chat handler
             * needed most.
             *
             * `/query` calls `rankNodesBySemanticQuery` on all four of its non-vector exits -- reading
             * history, no OpenAI client, no embeddings table, embedding failed. Chat, sharing the same
             * parse-and-filter code above, called it on the history branch only. On every other
             * non-vector path it handed the reply model `structuredFilteredNodes` in **document
             * order**, truncated at `contextNodeLimit`: an arbitrary forty cards, with no relation to
             * what was asked.
             *
             * That is exactly the reported symptom. Whether the right card was in the prompt came down
             * to where it happened to sit in `flow.nodes` -- unless the structured filter had narrowed
             * the set first, which needs the user to name a card type out loud. Naming the type
             * "worked" because it was the only thing steering retrieval at all.
             *
             * It also settles a contract: `docs/functional-contract.md` requires that with embeddings
             * missing or failing, "query/chat still return ranked results". Half of that was true.
             *
             * Ranking first and letting the vector pass refine it means every exit below is ranked
             * by construction, including ones added later.
             *
             * **Two rankings, because they answer two questions.** `contextRankedIds` orders what the
             * reply model is shown and should be generous — the model can say a card is irrelevant,
             * and a card missing from the prompt cannot be discussed at all. `matchedNodeIds` is the
             * set the *canvas is filtered to*, and there generosity is the failure: the keyword
             * ranking scores every card in scope, so folding it in wholesale hands back the whole
             * canvas under the name of a filter.
             */
            if (semanticQuery) {
                contextRankedIds = rankNodesBySemanticQuery(structuredFilteredNodes, semanticQuery, limit);
                // With no vector pass this ranking is all there is, and returning it whole is the
                // documented behaviour for a deployment without embeddings.
                matchedNodeIds = contextRankedIds;
            }

            if (semanticQuery && !parsedAt && openAiClient) {
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

                        const ranked = vectorRows.rows.map((row: { node_id: string }) => row.node_id);
                        // The vector answer in front, the keyword one behind it -- see
                        // `unionRankedNodeIds` for why neither ranking is a superset of the other.
                        // The context takes the whole keyword ranking; the filter takes only the
                        // keyword hits that scored.
                        contextRankedIds = unionRankedNodeIds(ranked, contextRankedIds, limit);
                        matchedNodeIds = unionRankedNodeIds(
                            ranked,
                            lexicalFilterIds(structuredFilteredNodes, semanticQuery, limit),
                            limit,
                        );
                        usedVectorSearch = ranked.length > 0;
                    }
                }
            }
        }

        const structuredNodeById = new Map(structuredFilteredNodes.map((node) => [node.id, node]));
        const rankedNodes: CardNodeForSearch[] = contextRankedIds
            .map((nodeId) => structuredNodeById.get(nodeId))
            .filter((node): node is CardNodeForSearch => Boolean(node));
        const contextNodes = (rankedNodes.length > 0 ? rankedNodes : structuredFilteredNodes).slice(0, contextNodeLimit);

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

            /*
             * What the canvas holds, not only what was retrieved.
             *
             * "How many insights do I have?", "what kinds of cards are in here?", "is there anything
             * about X yet?" are ordinary questions about a study, and a model shown twenty retrieved
             * cards and nothing else must either guess or refuse. The tally is free -- the candidate
             * set is already in hand -- and it is the difference between an assistant that can say
             * "you have 4 insights, and these two are about X" and one that can only quote what
             * retrieval happened to surface.
             */
            const tally = new Map<string, number>();
            for (const node of candidateNodes) {
                const label = node.label || "unlabelled";
                tally.set(label, (tally.get(label) ?? 0) + 1);
            }
            const inventoryText = tally.size > 0
                ? Array.from(tally.entries())
                    .sort((a, b) => b[1] - a[1])
                    .map(([label, count]) => `${label}: ${count}`)
                    .join(", ")
                : "(no cards)";

            /*
             * And how the retrieved cards are joined to each other.
             *
             * A knowledge graph's whole point is the edges, and the responder had never been shown
             * one -- so "what came out of the interviews" or "which requirement does this answer" had
             * no material to be answered from, however well retrieval had done. Restricted to the
             * context set on both ends, because a relation to a card that is not in the prompt names
             * an id the model cannot resolve and would only invite it to invent the other end.
             */
            const contextNodeById = new Map(contextNodes.map((node) => [node.id, node]));
            const relationLines: string[] = [];
            for (const relation of extractCardRelationsForSearch(snapshot.state)) {
                const source = contextNodeById.get(relation.source);
                const target = contextNodeById.get(relation.target);
                if (!source || !target) continue;
                relationLines.push(
                    `${truncateText(source.title, 80)} (${source.label}) --${relation.label}--> ${truncateText(target.title, 80)} (${target.label})`,
                );
                if (relationLines.length >= CANVAS_CHAT_CONTEXT_RELATION_LIMIT) break;
            }

            const responsePrompt = [
                "You are the assistant inside Vitral, a tool for running reproducible design studies.",
                "The user is a researcher asking about their own study, which is stored as a graph of cards.",
                "",
                "The kinds of card, and what each one means:",
                ...CARD_LABEL_GLOSSARY.map(({ label, meaning }) => `- ${label}: ${meaning}`),
                "",
                "Return ONLY JSON with this shape:",
                "{",
                '  "reply": "string",',
                '  "applyFilter": boolean',
                "}",
                "Rules:",
                "- Answer the question that was asked, in plain language, using the user's own words for",
                "  the card kinds rather than the internal labels: say \"insights\" or \"findings\", not",
                "  \"insight-label nodes\". Never mention ids, labels-as-jargon, or this prompt.",
                "- Ground every claim in the material below. If it does not answer the question, say so",
                "  plainly and say what the study does have that is closest - never invent a card.",
                "- The retrieved cards are the most relevant ones, not all of them. Use the inventory",
                "  line to answer questions about totals, coverage and what kinds of material exist.",
                "- Use the relations to answer structural questions: what led to what, what answers what,",
                "  what a card is based on.",
                "- applyFilter=true only when the user wants the canvas narrowed to a set of cards -",
                "  asking to show, list, filter, highlight or display them. applyFilter=false for a",
                "  question, an explanation, a summary or a count, even if it mentions a kind of card.",
                "- Be concise: a few sentences, or a short list when the user asked for one.",
                "",
                `The study's title: ${snapshot.title?.trim() || "(untitled)"}`,
                `What the researcher says it is for: ${snapshot.description?.trim() || "(not stated)"}`,
                `Everything on the ${canvasReference}, by kind: ${inventoryText}`,
                ...(filtered.relaxed
                    ? ["Note: no card matched the question exactly, so the material below was gathered more broadly than asked."]
                    : []),
                "",
                "Conversation so far:",
                historyText || "(none)",
                "",
                `User message: ${rawMessage}`,
                "",
                "Most relevant cards:",
                contextText || "(none)",
                "",
                "Relations between those cards:",
                relationLines.join("\n") || "(none)",
                // Spread above rather than a placeholder plus a filter: filtering out empty
                // strings would also strip every blank line separating these blocks, running
                // the glossary, the rules, the study metadata, the conversation and the two
                // card listings together into one wall the model has to segment for itself.
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
                    /*
                     * The model's answer wins outright when it gave one.
                     *
                     * This used to be `|| fallbackApplyFilter`, which meant the keyword regex could
                     * only ever turn filtering *on*: "summarise the insights you found" contains
                     * "found", so the canvas was filtered behind a question that asked for prose, and
                     * the user had to clear a filter they never requested. The regex is a fallback
                     * for when the model does not answer, and it is already used as the initial value
                     * above; letting it override a considered `false` made it a veto instead.
                     */
                    applyFilter = parsedOutput.applyFilter;
                }
            } catch (error) {
                request.log.warn({ error }, "Canvas chat response generation failed; using fallback reply.");
            }
        }

        // Only when there is genuinely nothing: with the relaxation ladder and the vector fallback
        // above, an empty match now means the project itself holds nothing to show, which is worth
        // saying plainly rather than overwriting a good answer with a complaint about the filter.
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

    // --- Card similarity: retrieval helpers. ---

    /**
     * Embeds in bounded chunks. The queue has always chunked; this path used to send every card in
     * one request, which both risks the per-request token ceiling and fails all-or-nothing.
     * Returns null when any chunk comes back the wrong shape, so the caller can report `degraded`
     * instead of publishing zeros that look like "nothing matched".
     */
    const embedTexts = async (texts: string[]): Promise<number[][] | null> => {
        if (!openAiClient || texts.length === 0) return texts.length === 0 ? [] : null;

        const vectors: number[][] = [];
        for (let start = 0; start < texts.length; start += SIMILARITY_EMBED_CHUNK) {
            const chunk = texts.slice(start, start + SIMILARITY_EMBED_CHUNK);
            const response = await openAiClient.embeddings.create({
                model: embeddingModel,
                input: chunk,
            });
            const data = Array.isArray(response.data) ? response.data : [];
            if (data.length !== chunk.length) return null;
            for (const item of data) {
                if (!Array.isArray(item.embedding)) return null;
                vectors.push(item.embedding);
            }
        }
        return vectors;
    };

    /**
     * Embeds and stores any card in this document that the index is missing at the current
     * signature, and returns how many it wrote.
     *
     * "Missing" covers every way the index falls behind at once: a card saved inside the queue's
     * debounce window, a card edited since it was embedded, a project duplicated before its rows
     * carried a label, and -- the big one -- every card in every project the first time it is seen
     * after `EMBEDDING_TEXT_VERSION` changes. Old vectors are not deleted; they simply stop
     * matching the signature and are overwritten in place.
     */
    const healDocumentEmbeddings = async (
        docId: string,
        signature: string,
        logger: Pick<typeof app.log, "info" | "warn">,
    ): Promise<number> => {
        const stateRow = await app.pg.query<{ state: unknown }>(
            `SELECT state FROM documents WHERE id = $1::uuid`,
            [docId],
        );
        const state = stateRow.rows[0]?.state;
        if (!state) return 0;

        const embeddable = extractEmbeddableCards(state);
        if (embeddable.length === 0) return 0;

        const current = await app.pg.query<{ node_id: string }>(
            `
            SELECT node_id
            FROM document_node_embeddings
            WHERE doc_id = $1::uuid
              AND model = $2
              AND node_id = ANY($3::text[])
            `,
            [docId, signature, embeddable.map((card) => card.nodeId)],
        );
        const fresh = new Set(current.rows.map((row) => row.node_id));
        const stale = embeddable.filter((card) => !fresh.has(card.nodeId));
        if (stale.length === 0) return 0;

        // A project that has never been embedded would otherwise make one drop pay for the whole
        // backlog. Capping means it converges over a few passes instead, and nothing waits on it:
        // the cards are already on the canvas by the time this route is called.
        const batch = stale.slice(0, SIMILARITY_HEAL_LIMIT);
        const vectors = await embedTexts(batch.map((card) => card.text));
        if (!vectors) {
            logger.warn({ component: "cards-similarity", pending: batch.length }, "Embedding backfill failed.");
            return 0;
        }

        const valuesSql: string[] = [];
        const values: unknown[] = [];
        batch.forEach((card, index) => {
            const base = values.length;
            valuesSql.push(`($${base + 1}::uuid, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector, $${base + 6})`);
            values.push(docId, card.nodeId, card.label, card.text, `[${vectors[index].join(",")}]`, signature);
        });

        await app.pg.query(
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

        if (stale.length > batch.length) {
            logger.info(
                { component: "cards-similarity", written: batch.length, remaining: stale.length - batch.length },
                "Embedding backfill capped; will continue on the next pass.",
            );
        }
        return batch.length;
    };
    /**
     * Candidate matches for newly generated cards, from the stored embedding index.
     * POST /api/state/:id/cards/similarity
     *
     * This route only *retrieves and calibrates*; it never decides whether an edge should exist.
     * That decision needs the live canvas graph (chronology, existing similarity degree), which the
     * client has and the saved snapshot may not, so it lives in `similarityDecision.ts` there.
     *
     * Two things come back per new card: the nearest few cards of the same label, and the shape of
     * the distribution they were drawn from. The distribution is the point. A raw cosine from
     * `text-embedding-3-small` has no absolute meaning -- unrelated short texts sit comfortably at
     * 0.7 -- so the only defensible question is whether a match stands out from its own cohort, and
     * that bar has to move as a project grows and its cards get more alike.
     */
    app.post("/state/:id/cards/similarity", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        const body = request.body as CompareCardsSimilarityBody;
        const normalizeCard = (raw: SimilarityCardInput): SimilarityCard | null => {
            const cardId = typeof raw.id === "string" ? raw.id.trim() : "";
            if (!cardId) return null;
            return {
                id: cardId,
                label: normalizeEmbeddingLabel(raw.label),
                title: typeof raw.title === "string" ? raw.title : "",
                description: typeof raw.description === "string" ? raw.description : "",
            };
        };

        const newCards = Array.isArray(body?.newCards)
            ? body.newCards
                .map(normalizeCard)
                .filter((card): card is SimilarityCard => Boolean(card))
                // A card with neither title nor description has nothing to match on, and the
                // embeddings API rejects an empty input string.
                .filter((card) => embeddingTextForCard(card) !== "")
                .slice(0, SIMILARITY_MAX_NEW_CARDS)
            : [];

        const emptyResult = (status: SimilarityStatus) => reply.send({
            status,
            matches: newCards.map((card) => ({
                newCardId: card.id,
                candidates: [],
                baseline: null,
            })),
        });

        if (newCards.length === 0) return reply.send({ status: "ok", matches: [] });
        if (!openAiClient) return emptyResult("unavailable");

        const startedAt = Date.now();
        const signature = embeddingSignature(embeddingModel);

        try {
            const embeddingTableReady = await app.pg.query<{ table_name: string | null }>(
                `SELECT to_regclass('public.document_node_embeddings') AS table_name`,
            );
            if (!embeddingTableReady.rows[0]?.table_name) return emptyResult("unavailable");

            // --- Bring the index up to date for this document. ---
            //
            // The client no longer ships the whole canvas on every drop: the server already has it.
            // What it does have to handle is an index that has fallen behind -- a card saved inside
            // the embedding queue's debounce window, a card whose text changed, or every card in
            // the project the first time it is seen after the embedding recipe was versioned.
            // Embedding the stragglers here (and storing them) means the gap closes by itself
            // instead of quietly returning worse matches forever.
            const healed = await healDocumentEmbeddings(id, signature, request.log);

            // --- Embed the new cards. They are not saved yet, so they are never in the index. ---
            const newVectors = await embedTexts(newCards.map((card) => embeddingTextForCard(card)));
            if (!newVectors) return emptyResult("degraded");

            const newCardIds = newCards.map((card) => card.id);
            const matches: SimilarityMatch[] = [];

            for (let index = 0; index < newCards.length; index += 1) {
                const card = newCards[index];
                const vectorLiteral = `[${newVectors[index].join(",")}]`;

                // One query does the whole job: pull the nearest slice of this card's label cohort
                // through the vector index, then read both the top candidates and the cohort's
                // centre and spread off it. Scoring happens in Postgres, so what crosses the wire
                // is a handful of ids and three numbers rather than every vector in the project.
                //
                // Capping the cohort at the nearest N biases the median upward on a large project,
                // which only ever makes the outlier test harder to pass. Erring strict is the right
                // direction here, and below the cap the cohort is exact.
                const { rows } = await app.pg.query<SimilarityCohortRow>(
                    `
                    WITH cohort AS (
                        SELECT node_id, 1 - (embedding <=> $2::vector) AS sim
                        FROM document_node_embeddings
                        WHERE doc_id = $1::uuid
                          AND label = $3
                          AND model = $4
                          AND NOT (node_id = ANY($5::text[]))
                        ORDER BY embedding <=> $2::vector
                        LIMIT $6
                    ),
                    centre AS (
                        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY sim) AS median
                        FROM cohort
                    ),
                    spread AS (
                        SELECT
                            percentile_cont(0.5) WITHIN GROUP (ORDER BY abs(cohort.sim - centre.median)) AS mad,
                            count(*)::int AS sampled
                        FROM cohort CROSS JOIN centre
                    )
                    SELECT cohort.node_id, cohort.sim, centre.median, spread.mad, spread.sampled
                    FROM cohort CROSS JOIN centre CROSS JOIN spread
                    ORDER BY cohort.sim DESC
                    LIMIT $7
                    `,
                    [
                        id,
                        vectorLiteral,
                        card.label,
                        signature,
                        newCardIds,
                        SIMILARITY_COHORT_LIMIT,
                        SIMILARITY_CANDIDATE_LIMIT,
                    ],
                );

                const first = rows[0];
                matches.push({
                    newCardId: card.id,
                    candidates: rows.map((row) => ({
                        existingCardId: row.node_id,
                        similarity: Number(row.sim),
                    })),
                    baseline: first
                        ? {
                            median: Number(first.median),
                            mad: Number(first.mad),
                            sampled: Number(first.sampled),
                        }
                        : null,
                });
            }

            request.log.info(
                {
                    component: "cards-similarity",
                    newCards: newCards.length,
                    healed,
                    withCandidates: matches.filter((match) => match.candidates.length > 0).length,
                    durationMs: Date.now() - startedAt,
                },
                "Card similarity candidates retrieved.",
            );

            return reply.send({ status: "ok", matches });
        } catch (error) {
            // `degraded` rather than an empty match list: "the lookup broke" and "nothing was
            // similar" are the same shape otherwise, and the client would silently treat a failed
            // embedding call as a canvas with no relationships in it.
            request.log.warn({ error }, "Failed to retrieve card similarity candidates.");
            return emptyResult("degraded");
        }
    });

    /**
     * Load all documents
     * GET /api/state/
     */
    app.get("/state", async (request, reply) => {
        const viewer = await app.currentUser(request);

        // Mine, plus every project created before accounts existed. Somebody else's private work
        // is not in this list at all — it reaches you through `/state/public` once they publish it.
        const { rows } = await app.pg.query(
            `
            SELECT
                d.id, d.title, d.description, d.version, d.updated_at,
                d.review_only, d.published, d.published_at, d.owner_id,
                u.username AS owner_username
            FROM documents d
            LEFT JOIN app_users u ON u.id = d.owner_id
            WHERE d.owner_id IS NULL OR d.owner_id = $1
            ORDER BY d.updated_at DESC
            `,
            [viewer?.id ?? null],
        );

        return rows.map((row: any) => ({ ...row, can_edit: !row.review_only }));
    });

    /**
     * Every published project, whoever owns it.
     * GET /api/state/public
     *
     * Registered before `/state/:id` would matter if Fastify matched by declaration order, but it
     * does not — its router puts static segments ahead of parameterised ones, so `public` can never
     * be read as a document id.
     */
    app.get("/state/public", async (request, reply) => {
        const viewer = await app.currentUser(request);

        const { rows } = await app.pg.query(
            `
            SELECT
                d.id, d.title, d.description, d.version, d.updated_at,
                d.review_only, d.published, d.published_at, d.owner_id,
                u.username AS owner_username
            FROM documents d
            LEFT JOIN app_users u ON u.id = d.owner_id
            WHERE d.published
            ORDER BY d.published_at DESC NULLS LAST, d.updated_at DESC
            `,
        );

        const viewerId = viewer?.id ?? null;
        return rows.map((row: any) => {
            // Deliberately *not* the `owner_id === null` allowance that `isDocumentOwner` grants
            // elsewhere. That rule exists so pre-accounts projects stay editable by whoever finds
            // them; applied here it would tell a signed-out viewer — a guest — that they own a
            // published project, and offer them an Unpublish button the server would refuse.
            const mine = viewerId !== null && row.owner_id === viewerId;
            return {
                ...row,
                // A published project is read-only for its readers and still editable by its owner,
                // which is the whole difference between publishing and `review_only`.
                can_edit: !row.review_only && mine,
                // The projects page uses this to keep your own published work out of the "Public
                // projects" shelf — it is already in your list above, with its own controls.
                is_owner: mine,
            };
        });
    });

    const duplicateJobs = new Map<string, DuplicateJobRecord>();

    const duplicateProjectWithFullFidelity = async (
        sourceDocId: string,
        logger: Pick<typeof app.log, "info" | "error">,
        ownerId: string | null,
    ): Promise<DuplicatedDocumentSummary> => {
        const duplicateStartedAt = Date.now();

        /*
         * Where the time actually goes, per stage.
         *
         * Contract 7 already pins that this path logs counts, bytes and total elapsed time, and that
         * total is what says duplication is slow without ever saying *which part* is. The stages have
         * very different shapes — a set-based `INSERT ... SELECT` for GitHub events and embeddings, a
         * paged read-and-write for revisions, S3-free metadata rows for files — and guessing between
         * them from one number is how a read path gets optimised while the write path is the cost.
         */
        const stageMs: Record<string, number> = {};
        const timeStage = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
            const startedAt = Date.now();
            try {
                return await run();
            } finally {
                stageMs[name] = (stageMs[name] ?? 0) + (Date.now() - startedAt);
            }
        };

        const client = await app.pg.connect();
        try {
            await client.query("BEGIN");

            const sourceDocumentResult = await client.query<{
                id: string;
                title: string;
                description: string | null;
                state: unknown;
                timeline: unknown;
                version: number;
                review_only: boolean;
                github_owner: string | null;
                github_repo: string | null;
                github_default_branch: string | null;
                github_linked_at: string | null;
                github_last_synced_at: string | null;
            }>(
                `
                SELECT
                    id,
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
                FROM documents
                WHERE id = $1
                `,
                [sourceDocId],
            );
            const sourceDocument = sourceDocumentResult.rows[0];
            if (!sourceDocument) {
                throw new Error("Document not found");
            }

            const sourceFilesResult = await client.query<{
                id: string;
                name: string;
                mime_type: string | null;
                ext: string | null;
                size_bytes: number | null;
                sha256: string | null;
                /** Ordered on, never read: see `DuplicatedRevisionRow.captured_at` for why it is selected. */
                created_at: string;
                created_at_text: string;
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
                    -- ::text for the same reason the revision cursor needs it: pg hands a
                    -- timestamptz back as a millisecond Date, and binding that to the copy's
                    -- created_at silently rounds away the microseconds that rows written by now()
                    -- carry. This column is the files' own ordering key, so a copy that rounds it
                    -- can order two same-millisecond uploads differently from the original.
                    created_at,
                    created_at::text AS created_at_text,
                    storage_bucket,
                    storage_key
                FROM document_files
                WHERE document_id = $1
                ORDER BY created_at ASC, id ASC
                `,
                [sourceDocId],
            );
            const sourceFileCount = sourceFilesResult.rows.length;
            const sourceTotalFileBytes = sourceFilesResult.rows.reduce(
                (sum, fileRow) => sum + Math.max(0, fileRow.size_bytes ?? 0),
                0,
            );

            const fileIdMap = new Map<string, string>();
            for (const sourceFile of sourceFilesResult.rows) {
                fileIdMap.set(sourceFile.id, crypto.randomUUID());
            }

            const remappedState = remapStateFileReferences(sourceDocument.state, fileIdMap);
            const sourceTitle = (sourceDocument.title ?? "").trim() || "Untitled";
            const duplicatedTitle = `${sourceTitle} (copy)`;
            const sourceVersion = Number.isFinite(sourceDocument.version)
                ? Math.max(1, Math.trunc(sourceDocument.version))
                : 1;

            const duplicatedDocumentResult = await client.query<DuplicatedDocumentSummary>(
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
                    github_last_synced_at,
                    owner_id
                )
                -- published is left to its FALSE default on purpose: duplicating somebody
                -- else's public project must not republish it under your name.
                VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz, $12)
                RETURNING id, title, description, version, updated_at, review_only, published, owner_id
                `,
                [
                    duplicatedTitle,
                    sourceDocument.description ?? null,
                    JSON.stringify(remappedState ?? {}),
                    JSON.stringify(sourceDocument.timeline ?? {}),
                    sourceVersion,
                    sourceDocument.review_only === true,
                    sourceDocument.github_owner ?? null,
                    sourceDocument.github_repo ?? null,
                    sourceDocument.github_default_branch ?? null,
                    sourceDocument.github_linked_at ?? null,
                    sourceDocument.github_last_synced_at ?? null,
                    ownerId,
                ],
            );
            const duplicatedDocument = duplicatedDocumentResult.rows[0];
            if (!duplicatedDocument) {
                throw new Error("Failed to create duplicated document.");
            }

            await timeStage("files", async () => {
            for (const sourceFileChunk of chunkItems(sourceFilesResult.rows, DUPLICATE_FILES_INSERT_CHUNK_SIZE)) {
                const placeholders: string[] = [];
                const values: unknown[] = [];

                for (const sourceFile of sourceFileChunk) {
                    const nextFileId = fileIdMap.get(sourceFile.id);
                    if (!nextFileId) continue;
                    const offset = values.length;
                    values.push(
                        nextFileId,
                        duplicatedDocument.id,
                        sourceFile.name,
                        sourceFile.mime_type,
                        sourceFile.ext,
                        sourceFile.size_bytes,
                        sourceFile.sha256,
                        sourceFile.storage_bucket,
                        sourceFile.storage_key,
                        sourceFile.created_at_text,
                    );
                    placeholders.push(
                        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}::timestamptz)`,
                    );
                }

                if (placeholders.length === 0) continue;

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
                    VALUES ${placeholders.join(",\n")}
                    `,
                    values,
                );
            }
            });

            const sourceRevisionCountRes = await client.query<{ count: string }>(
                `
                SELECT COUNT(*)::text AS count
                FROM document_state_revisions
                WHERE document_id = $1
                `,
                [sourceDocId],
            );
            const sourceRevisionCountRaw = Number(sourceRevisionCountRes.rows[0]?.count ?? 0);
            const sourceRevisionCount = Number.isFinite(sourceRevisionCountRaw)
                ? Math.max(0, Math.trunc(sourceRevisionCountRaw))
                : 0;
            logger.info({
                docId: sourceDocId,
                sourceFileCount,
                sourceTotalFileBytes,
                sourceRevisionCount,
            }, "Starting project duplication.");

            /*
             * The revision log, copied the way the export already reads it.
             *
             * Two changes, both taken from `GET /state/:id/export-vi`, which learned them on the same
             * data and wrote them down in AGENTS.md contract 7.
             *
             * **`state::text`, not `state`.** `pg` parses a `jsonb` column into a live JS object
             * graph, `remapStateFileReferences` then rebuilt every one of those graphs, and
             * `JSON.stringify` reprinted them — three passes over every byte of history, in Node,
             * with the heap to match. On the reference 1204-revision project that is ~106 MB and 1204
             * object graphs, twice. The export deleted exactly this and said so; duplication kept it.
             * As text, the same remap is one regular-expression scan and the bytes are never anything
             * but a string.
             *
             * **Keyset, not `OFFSET`.** `LIMIT/OFFSET` inside a loop makes Postgres re-sort the whole
             * log once per batch — quadratic in the number of revisions, on the one table that grows
             * without bound. The cursor is carried as `::text` for the reason contract 7 gives: `pg`
             * hands a `timestamptz` back as a millisecond `Date`, and feeding that in rounds the
             * cursor *down*, so rows sharing that millisecond repeat forever. `assertCursorAdvanced`
             * turns that mistake into a failed duplication rather than an endless one.
             *
             * The same `captured_at::text` is what gets inserted, so the copy keeps the microseconds
             * the millisecond round trip used to shave off.
             */
            let copiedRevisions = 0;
            await timeStage("revisions", async () => {
            let afterCapturedAt: string | null = null;
            let afterVersion: number | null = null;
            let afterId: string | null = null;
            for (;;) {
                const sourceRevisionChunkRes: { rows: DuplicatedRevisionRow[] } = await client.query<DuplicatedRevisionRow>(
                    `
                    SELECT
                        id,
                        version,
                        captured_at,
                        captured_at::text AS cursor_captured_at,
                        state::text AS state,
                        timeline::text AS timeline
                    FROM document_state_revisions
                    WHERE document_id = $1
                      AND (
                          $3::timestamptz IS NULL
                          OR (captured_at, version, id) > ($3::timestamptz, $4::integer, $5::uuid)
                      )
                    ORDER BY captured_at ASC, version ASC, id ASC
                    LIMIT $2
                    `,
                    [sourceDocId, DUPLICATE_REVISIONS_INSERT_CHUNK_SIZE, afterCapturedAt, afterVersion, afterId],
                );
                const sourceRevisionChunk = sourceRevisionChunkRes.rows;
                if (sourceRevisionChunk.length === 0) break;

                const placeholders: string[] = [];
                const values: unknown[] = [];

                for (const sourceRevision of sourceRevisionChunk) {
                    const remappedRevisionState = remapFileReferencesInStateText(sourceRevision.state, fileIdMap);
                    const revisionVersion = Number.isFinite(sourceRevision.version)
                        ? Math.max(1, Math.trunc(sourceRevision.version))
                        : 1;
                    const offset = values.length;
                    values.push(
                        duplicatedDocument.id,
                        revisionVersion,
                        sourceRevision.cursor_captured_at,
                        remappedRevisionState,
                        sourceRevision.timeline,
                    );
                    placeholders.push(
                        `($${offset + 1}, $${offset + 2}, $${offset + 3}::timestamptz, $${offset + 4}::jsonb, $${offset + 5}::jsonb)`,
                    );
                }

                await client.query(
                    `
                    INSERT INTO document_state_revisions (
                        document_id,
                        version,
                        captured_at,
                        state,
                        timeline
                    )
                    VALUES ${placeholders.join(",\n")}
                    `,
                    values,
                );
                copiedRevisions += sourceRevisionChunk.length;

                if (sourceRevisionChunk.length < DUPLICATE_REVISIONS_INSERT_CHUNK_SIZE) break;
                const lastRevision = sourceRevisionChunk[sourceRevisionChunk.length - 1];
                // The whole cursor, not its first component: revisions written inside one
                // transaction share `now()` to the microsecond, so a page that is entirely one
                // timestamp advances `version`/`id` while `captured_at` stands still. Comparing the
                // timestamp alone would abort a duplication that was making perfect progress.
                assertCursorAdvanced(
                    "duplicate revisions",
                    afterCapturedAt === null ? null : `${afterCapturedAt}|${afterVersion}|${afterId}`,
                    `${lastRevision.cursor_captured_at}|${lastRevision.version}|${lastRevision.id}`,
                );
                afterCapturedAt = lastRevision.cursor_captured_at;
                afterVersion = lastRevision.version;
                afterId = lastRevision.id;
            }
            });

            await timeStage("githubEvents", () => client.query(
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
                SELECT
                    $1::uuid AS document_id,
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
                WHERE document_id = $2::uuid
                ORDER BY occurred_at ASC, event_key ASC
                `,
                [duplicatedDocument.id, sourceDocId],
            ));

            const embeddingTable = await client.query<{ table_name: string | null }>(
                `
                SELECT to_regclass('public.document_node_embeddings') AS table_name
                `,
            );

            if (embeddingTable.rows[0]?.table_name) {
                await timeStage("embeddings", () => client.query(
                    `
                    INSERT INTO document_node_embeddings (doc_id, node_id, label, node_text, embedding, model)
                    SELECT $1::uuid, node_id, label, node_text, embedding, model
                    FROM document_node_embeddings
                    WHERE doc_id = $2::uuid
                    ON CONFLICT (doc_id, node_id) DO UPDATE
                    SET
                        label = EXCLUDED.label,
                        node_text = EXCLUDED.node_text,
                        embedding = EXCLUDED.embedding,
                        model = EXCLUDED.model,
                        updated_at = now()
                    `,
                    [duplicatedDocument.id, sourceDocId],
                ));
            }

            await timeStage("commit", () => client.query("COMMIT"));
            logger.info({
                sourceDocId,
                duplicatedDocId: duplicatedDocument.id,
                elapsedMs: Date.now() - duplicateStartedAt,
                stageMs,
                sourceFileCount,
                sourceTotalFileBytes,
                sourceRevisionCount,
                copiedRevisions,
            }, "Project duplication completed.");
            return duplicatedDocument;
        } catch (error) {
            await client.query("ROLLBACK");
            logger.error({ error, docId: sourceDocId, elapsedMs: Date.now() - duplicateStartedAt }, "Failed to duplicate project.");
            throw error;
        } finally {
            client.release();
        }
    };

    const runDuplicateJob = async (jobId: string): Promise<void> => {
        const job = duplicateJobs.get(jobId);
        if (!job) return;

        job.status = "running";
        job.startedAt = new Date().toISOString();
        job.error = null;
        job.result = null;

        try {
            const duplicatedDocument = await duplicateProjectWithFullFidelity(
                job.sourceDocId,
                app.log,
                job.ownerId,
            );
            const current = duplicateJobs.get(jobId);
            if (!current) return;
            current.status = "succeeded";
            current.finishedAt = new Date().toISOString();
            current.result = duplicatedDocument;
            current.error = null;
        } catch (error) {
            const current = duplicateJobs.get(jobId);
            if (!current) return;
            current.status = "failed";
            current.finishedAt = new Date().toISOString();
            current.result = null;
            current.error = error instanceof Error && error.message.trim() !== ""
                ? error.message
                : DUPLICATE_JOB_ERROR_MESSAGE;
        } finally {
            pruneDuplicateJobs(duplicateJobs);
        }
    };

    /**
     * Start async project duplication with full state/history/assets fidelity.
     * POST /api/state/:id/duplicate
     */
    app.post("/state/:id/duplicate", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }
        // A *read* gate, not a write one: copying someone's published project is the intended way
        // to build on it. But it has to be one you were allowed to see — this used to check only
        // that the id existed, which made a guessed id enough to copy a private project wholesale.
        if (!await ensureDocumentReadable(id, request, reply)) return;

        const duplicator = await app.currentUser(request);

        pruneDuplicateJobs(duplicateJobs);
        // Coalescing is per *duplicator*, not per source.
        //
        // Matching on `sourceDocId` alone handed a second account the first account's job. The
        // comment above says copying somebody's published project is the intended flow, so two people
        // duplicating the same project at once is a real path — and the second one polled a job that
        // succeeded, refetched their list, and found nothing, because the copy was created under
        // `createDuplicateJob(id, duplicator?.id)` for the *first* account. The window is exactly the
        // duration this endpoint takes, so making duplication faster makes the bug rarer rather than
        // gone.
        const duplicatorId = duplicator?.id ?? null;
        for (const existingJob of duplicateJobs.values()) {
            if (existingJob.sourceDocId !== id) continue;
            if (existingJob.ownerId !== duplicatorId) continue;
            if (existingJob.status === "queued" || existingJob.status === "running") {
                return reply.status(202).send(existingJob);
            }
        }

        const job = createDuplicateJob(id, duplicatorId);
        duplicateJobs.set(job.jobId, job);
        setImmediate(() => {
            void runDuplicateJob(job.jobId);
        });
        return reply.status(202).send(job);
    });

    /**
     * Poll async project duplication status.
     * GET /api/state/duplicate-jobs/:jobId
     */
    app.get("/state/duplicate-jobs/:jobId", async (request, reply) => {
        const { jobId } = request.params as { jobId: string };
        if (!isUuid(jobId)) {
            return reply.status(400).send({ error: "Invalid duplicate job id" });
        }

        pruneDuplicateJobs(duplicateJobs);
        const job = duplicateJobs.get(jobId);
        if (!job) {
            return reply.status(404).send({ error: "Duplicate job not found" });
        }

        if (job.status === "queued" || job.status === "running") {
            reply.header("Retry-After", "1");
        }
        return reply.send(job);
    });

    /**
     * Export a project as a portable .vi binary bundle.
     * GET /api/state/:id/export-vi
     */
    app.get("/state/:id/export-vi", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!await ensureDocumentReadable(id, request, reply)) return;
        const { includeGithub } = request.query as { includeGithub?: string | string[] };
        const exportStartedAt = Date.now();
        const includeGithubData = (() => {
            // Fastify yields a string, or a string[] for a repeated query param; use the
            // last provided value so any explicit "exclude" is honored rather than dropped.
            const raw = Array.isArray(includeGithub) ? includeGithub[includeGithub.length - 1] : includeGithub;
            if (typeof raw === "string") {
                const normalized = raw.trim().toLowerCase();
                if (normalized === "0" || normalized === "false" || normalized === "no") return false;
            }
            return true;
        })();

        const documentResult = await app.pg.query<{
            id: string;
            title: string;
            description: string | null;
            state: string | null;
            timeline: string | null;
            version: number;
            created_at: string;
            updated_at: string;
        }>(
            `
            SELECT
                id,
                title,
                description,
                state::text AS state,
                timeline::text AS timeline,
                version,
                created_at,
                updated_at
            FROM documents
            WHERE id = $1
            `,
            [id],
        );

        const documentRow = documentResult.rows[0];
        if (!documentRow) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const revisionCountRes = await app.pg.query<{ count: string }>(
            `
            SELECT COUNT(*)::text AS count
            FROM document_state_revisions
            WHERE document_id = $1
            `,
            [id],
        );
        const revisionCountRaw = Number(revisionCountRes.rows[0]?.count ?? 0);
        const revisionCount = Number.isFinite(revisionCountRaw)
            ? Math.max(0, Math.trunc(revisionCountRaw))
            : 0;

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
        const totalFileBytes = fileRows.rows.reduce(
            (sum, row) => sum + Math.max(0, row.size_bytes ?? 0),
            0,
        );
        const exportFileFetchConcurrencyRaw = Number(
            process.env.VI_EXPORT_FILE_FETCH_CONCURRENCY ?? DEFAULT_VI_EXPORT_FILE_FETCH_CONCURRENCY,
        );
        const exportFileFetchConcurrency = Number.isFinite(exportFileFetchConcurrencyRaw)
            ? Math.min(MAX_VI_EXPORT_FILE_FETCH_CONCURRENCY, Math.max(1, Math.trunc(exportFileFetchConcurrencyRaw)))
            : DEFAULT_VI_EXPORT_FILE_FETCH_CONCURRENCY;

        request.log.info({
            docId: id,
            revisionCount,
            fileCount: fileRows.rows.length,
            totalFileBytes,
            exportFileFetchConcurrency,
            includeGithubData,
        }, "Starting project export.");

        const maxTotalFileBytesRaw = Number(process.env.VI_EXPORT_MAX_TOTAL_FILE_BYTES ?? 0);
        const maxTotalFileBytes = Number.isFinite(maxTotalFileBytesRaw) ? Math.max(0, Math.trunc(maxTotalFileBytesRaw)) : 0;
        if (maxTotalFileBytes > 0 && totalFileBytes > maxTotalFileBytes) {
            return reply.status(413).send({
                error: `Project assets exceed export limit (${totalFileBytes} bytes > ${maxTotalFileBytes} bytes).`,
            });
        }

        for (const row of fileRows.rows) {
            if (!row.storage_bucket || !row.storage_key) {
                return reply.status(500).send({
                    error: `File "${row.name}" is missing storage metadata and cannot be exported.`,
                });
            }
        }

        const embeddingTable = await app.pg.query<{ table_name: string | null }>(
            `
            SELECT to_regclass('public.document_node_embeddings') AS table_name
            `,
        );
        const hasEmbeddingTable = Boolean(embeddingTable.rows[0]?.table_name);

        const fileName = `${sanitizeProjectFilename(documentRow.title)}.vi`;
        reply.header("Content-Type", "application/octet-stream");
        reply.header("Content-Disposition", `attachment; filename="${safeFilename(fileName)}"`);

        const responseStream = new PassThrough();
        const bundleStream = createProjectViCompressStream();
        const headerBytes = createProjectViHeader();
        let encodedBytes = headerBytes.length;
        let rawBytes = 0;

        bundleStream.on("data", (chunk: Buffer) => {
            encodedBytes += chunk.length;
        });
        bundleStream.on("error", (error) => {
            request.log.error({ error, docId: id }, "Streaming project export failed.");
            if (!responseStream.destroyed) responseStream.destroy(error);
        });

        responseStream.write(headerBytes);
        bundleStream.pipe(responseStream);

        const write = async (chunk: string | Buffer): Promise<void> => {
            rawBytes += Buffer.byteLength(chunk);
            await writeChunk(bundleStream, chunk);
        };

        void (async () => {
            try {
                await write('{"format":"vitral-project","version":1');
                await write(`,"exportedAt":${JSON.stringify(new Date().toISOString())}`);
                await write(
                    `,"source":{"documentId":${JSON.stringify(documentRow.id)},"title":${JSON.stringify(documentRow.title)}}`,
                );
                await write(
                    `,"document":{"title":${JSON.stringify(documentRow.title)}`
                    + `,"description":${JSON.stringify(documentRow.description ?? null)}`
                    + `,"state":${jsonbText(documentRow.state)}`
                    + `,"timeline":${jsonbText(documentRow.timeline)}`
                    + `,"version":${JSON.stringify(documentRow.version)}`
                    + `,"createdAt":${JSON.stringify(new Date(documentRow.created_at).toISOString())}`
                    + `,"updatedAt":${JSON.stringify(new Date(documentRow.updated_at).toISOString())}}`,
                );

                await write(',"files":[');
                let firstFile = true;
                for (const metadataChunk of chunkItems(fileRows.rows, exportFileFetchConcurrency)) {
                    const fileEntries = await mapWithConcurrencyLimit(
                        metadataChunk,
                        exportFileFetchConcurrency,
                        async (row) => {
                            const object = await app.s3.send(
                                new GetObjectCommand({
                                    Bucket: row.storage_bucket!,
                                    Key: row.storage_key!,
                                }),
                            );
                            const body = object.Body as Readable | undefined;
                            if (!body) {
                                throw new Error(`File "${row.name}" could not be loaded from object storage.`);
                            }
                            const bytes = await streamToBuffer(body);
                            return {
                                oldId: row.id,
                                name: row.name,
                                mimeType: row.mime_type,
                                ext: row.ext,
                                sizeBytes: row.size_bytes,
                                sha256: row.sha256,
                                createdAt: new Date(row.created_at).toISOString(),
                                bytesBase64: bytes.toString("base64"),
                            };
                        },
                    );

                    for (const entry of fileEntries) {
                        if (!firstFile) await write(",");
                        await write(JSON.stringify(entry));
                        firstFile = false;
                    }
                }
                await write("]");

                await write(',"embeddings":[');
                let firstEmbedding = true;
                if (hasEmbeddingTable) {
                    // Keyset, not OFFSET: with OFFSET, batch N makes Postgres sort and walk
                    // the first N*batch rows again, so paging a long table is quadratic.
                    let afterNodeId: string | null = null;
                    for (;;) {
                        const embeddingRows: ExportedRows<ExportedEmbeddingRow> = await app.pg.query<ExportedEmbeddingRow>(
                            `
                            SELECT node_id, node_text, embedding::text AS embedding
                            FROM document_node_embeddings
                            WHERE doc_id = $1
                              AND ($3::text IS NULL OR node_id > $3::text)
                            ORDER BY node_id ASC
                            LIMIT $2
                            `,
                            [id, EXPORT_EMBEDDINGS_BATCH_SIZE, afterNodeId],
                        );
                        if (embeddingRows.rows.length === 0) break;

                        for (const row of embeddingRows.rows) {
                            if (!firstEmbedding) await write(",");
                            await write(
                                `{"nodeId":${JSON.stringify(row.node_id)}`
                                + `,"nodeText":${JSON.stringify(row.node_text ?? "")}`
                                + `,"embedding":${vectorText(row.embedding)}}`,
                            );
                            firstEmbedding = false;
                        }

                        if (embeddingRows.rows.length < EXPORT_EMBEDDINGS_BATCH_SIZE) break;
                        const nextNodeId = embeddingRows.rows[embeddingRows.rows.length - 1].node_id;
                        assertCursorAdvanced("embeddings", afterNodeId, nextNodeId);
                        afterNodeId = nextNodeId;
                    }
                }
                await write("]");

                await write(',"githubEvents":[');
                if (includeGithubData) {
                    let firstGithubEvent = true;
                    let afterOccurredAt: string | null = null;
                    let afterEventKey: string | null = null;
                    for (;;) {
                        const githubEventRows: ExportedRows<ExportedGithubEventRow> = await app.pg.query<ExportedGithubEventRow>(
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
                                occurred_at::text AS cursor_occurred_at,
                                issue_number,
                                pr_number,
                                commit_sha,
                                branch_name,
                                payload::text AS payload,
                                inserted_at
                            FROM document_github_events
                            WHERE document_id = $1
                              AND (
                                  $3::timestamptz IS NULL
                                  OR (occurred_at, event_key) > ($3::timestamptz, $4::text)
                              )
                            ORDER BY occurred_at ASC, event_key ASC
                            LIMIT $2
                            `,
                            [id, EXPORT_GITHUB_EVENTS_BATCH_SIZE, afterOccurredAt, afterEventKey],
                        );
                        if (githubEventRows.rows.length === 0) break;

                        for (const row of githubEventRows.rows) {
                            if (!firstGithubEvent) await write(",");
                            await write(
                                `{"repoOwner":${JSON.stringify(row.repo_owner)}`
                                + `,"repoName":${JSON.stringify(row.repo_name)}`
                                + `,"eventType":${JSON.stringify(row.event_type)}`
                                + `,"eventKey":${JSON.stringify(row.event_key)}`
                                + `,"actorLogin":${JSON.stringify(row.actor_login ?? null)}`
                                + `,"title":${JSON.stringify(row.title ?? null)}`
                                + `,"url":${JSON.stringify(row.url ?? null)}`
                                + `,"occurredAt":${JSON.stringify(new Date(row.occurred_at).toISOString())}`
                                + `,"issueNumber":${JSON.stringify(row.issue_number ?? null)}`
                                + `,"prNumber":${JSON.stringify(row.pr_number ?? null)}`
                                + `,"commitSha":${JSON.stringify(row.commit_sha ?? null)}`
                                + `,"branchName":${JSON.stringify(row.branch_name ?? null)}`
                                + `,"payload":${jsonbObjectText(row.payload)}`
                                + `,"insertedAt":${JSON.stringify(new Date(row.inserted_at).toISOString())}}`,
                            );
                            firstGithubEvent = false;
                        }

                        if (githubEventRows.rows.length < EXPORT_GITHUB_EVENTS_BATCH_SIZE) break;
                        const lastGithubEvent = githubEventRows.rows[githubEventRows.rows.length - 1];
                        assertCursorAdvanced(
                            "githubEvents",
                            `${afterOccurredAt}|${afterEventKey}`,
                            `${lastGithubEvent.cursor_occurred_at}|${lastGithubEvent.event_key}`,
                        );
                        afterOccurredAt = lastGithubEvent.cursor_occurred_at;
                        afterEventKey = lastGithubEvent.event_key;
                    }
                }
                await write("]");

                // The revision log is the bulk of any large export — on a 1204-revision
                // project it is ~100 MB of the ~135 MB bundle. Both things that made it
                // expensive are avoided here: the snapshots stream as text rather than
                // round-tripping through JS objects, and paging is keyset rather than
                // OFFSET so Postgres does not re-sort the log once per batch.
                await write(',"revisions":[');
                let firstRevision = true;
                let afterCapturedAt: string | null = null;
                let afterVersion: number | null = null;
                let afterId: string | null = null;
                for (;;) {
                    const revisionRows: ExportedRows<ExportedRevisionRow> = await app.pg.query<ExportedRevisionRow>(
                        `
                        SELECT
                            id,
                            version,
                            captured_at,
                            captured_at::text AS cursor_captured_at,
                            state::text AS state,
                            timeline::text AS timeline
                        FROM document_state_revisions
                        WHERE document_id = $1
                          AND (
                              $3::timestamptz IS NULL
                              OR (captured_at, version, id) > ($3::timestamptz, $4::integer, $5::uuid)
                          )
                        ORDER BY captured_at ASC, version ASC, id ASC
                        LIMIT $2
                        `,
                        [id, EXPORT_REVISIONS_BATCH_SIZE, afterCapturedAt, afterVersion, afterId],
                    );
                    if (revisionRows.rows.length === 0) break;

                    for (const row of revisionRows.rows) {
                        const version = Number.isFinite(row.version) ? Math.max(1, Math.trunc(row.version)) : 1;
                        if (!firstRevision) await write(",");
                        await write(
                            `{"version":${version}`
                            + `,"capturedAt":${JSON.stringify(new Date(row.captured_at).toISOString())}`
                            + `,"state":${jsonbObjectText(row.state)}`
                            + `,"timeline":${jsonbObjectText(row.timeline)}}`,
                        );
                        firstRevision = false;
                    }

                    if (revisionRows.rows.length < EXPORT_REVISIONS_BATCH_SIZE) break;
                    const lastRevision = revisionRows.rows[revisionRows.rows.length - 1];
                    assertCursorAdvanced(
                        "revisions",
                        `${afterCapturedAt}|${afterVersion}|${afterId}`,
                        `${lastRevision.cursor_captured_at}|${lastRevision.version}|${lastRevision.id}`,
                    );
                    afterCapturedAt = lastRevision.cursor_captured_at;
                    afterVersion = lastRevision.version;
                    afterId = lastRevision.id;
                }
                await write("]}");

                bundleStream.end();
                await finished(bundleStream);
                request.log.info({
                    docId: id,
                    encodedBytes,
                    rawBytes,
                    compressionRatio: rawBytes > 0 ? Number((rawBytes / encodedBytes).toFixed(1)) : null,
                    elapsedMs: Date.now() - exportStartedAt,
                    revisionCount,
                    fileCount: fileRows.rows.length,
                    totalFileBytes,
                    includeGithubData,
                }, "Project export completed.");
            } catch (error) {
                request.log.error({ error, docId: id }, "Project export failed while streaming.");
                bundleStream.destroy(error instanceof Error ? error : new Error(String(error)));
                if (!responseStream.destroyed) {
                    responseStream.destroy(error instanceof Error ? error : new Error(String(error)));
                }
            }
        })();

        return reply.send(responseStream);
    });

    /**
     * Import a portable .vi bundle as a review-only document.
     * POST /api/state/import-vi
     */
    app.post("/state/import-vi", async (request, reply) => {
        // An imported project belongs to whoever imported it, exactly as a created one does.
        // Without this it landed ownerless, which put a private bundle into the shared legacy
        // pool that every account can see and edit.
        const importer = await app.currentUser(request);
        const importerId = importer?.id ?? null;

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
                    github_last_synced_at,
                    owner_id
                )
                VALUES ($1, $2, $3::jsonb, $4::jsonb, 1, TRUE, NULL, NULL, NULL, NULL, NULL, $5)
                RETURNING id, title, description, version, updated_at, review_only, published, owner_id
                `,
                [
                    (bundle.document.title || "Untitled").trim() || "Untitled",
                    bundle.document.description ?? null,
                    JSON.stringify(remappedState),
                    JSON.stringify(timelinePayload),
                    importerId,
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
        if (!await ensureDocumentWritable(id, request, reply)) return;

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

        // This route creates as well as updates, so a missing document is not a refusal — it is
        // the insert branch, and the caller becomes its owner. An existing one goes through the
        // same gate as every other write.
        const existingAccess = await getDocumentAccess(id);
        const writer = await app.currentUser(request);
        if (existingAccess) {
            if (!canReadDocument(existingAccess, writer?.id ?? null)) {
                return reply.status(404).send({ error: "Document not found" });
            }
            if (existingAccess.review_only) {
                return reply.status(403).send({ error: "This is a review project and cannot be modified." });
            }
            if (!isDocumentOwner(existingAccess, writer?.id ?? null)) {
                return reply.status(403).send({
                    error: "This project belongs to someone else. Duplicate it to make changes.",
                });
            }
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
            INSERT INTO documents (id, title, description, state, timeline, version, owner_id)
            VALUES (
                $1,
                COALESCE($2, 'Untitled'),
                $3,
                $4::jsonb,
                $5::jsonb,
                1,
                $6
            )
            ON CONFLICT (id) DO UPDATE
            SET
                title = COALESCE(EXCLUDED.title, documents.title),
                description = COALESCE(EXCLUDED.description, documents.description),
                state = EXCLUDED.state,
                timeline = EXCLUDED.timeline,
                version = documents.version + 1
            RETURNING id, title, description, version, updated_at, review_only, published, owner_id
            `,
            [
                id,
                title,
                description,
                JSON.stringify(body.state),
                JSON.stringify(body.timeline ?? {}),
                // Only meaningful on the insert branch: the UPDATE above deliberately leaves
                // `owner_id` alone, so saving a legacy ownerless project does not quietly claim it.
                writer?.id ?? null,
            ]
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
        if (!await ensureDocumentWritable(id, request, reply)) return;

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

        let previousState: unknown = undefined;
        try {
            const latestRevisionRes = await app.pg.query<{ state: unknown }>(
                `
                SELECT state
                FROM document_state_revisions
                WHERE document_id = $1
                ORDER BY captured_at DESC
                LIMIT 1
                `,
                [id],
            );
            if (latestRevisionRes.rows.length > 0) {
                previousState = latestRevisionRes.rows[0].state;
            } else {
                const currentStateRes = await app.pg.query<{ state: unknown }>(
                    `
                    SELECT state
                    FROM documents
                    WHERE id = $1
                    `,
                    [id],
                );
                previousState = currentStateRes.rows[0]?.state;
            }
        } catch (error) {
            request.log.error({ error }, "Failed to read previous revision state for provenance delta.");
        }

        const version = Number(versionRes.rows[0]?.version ?? 1);
        await insertStateRevision(app.pg, id, version, body.state, body.timeline ?? {});
        try {
            await persistProvenanceEvolution(
                app.pg,
                id,
                previousState,
                body.state,
                new Date().toISOString(),
            );
        } catch (error) {
            request.log.error({ error }, "Failed to persist provenance from revision snapshot.");
        }
        return reply.status(204).send();
    });


    /**
     * Update document metadata
     * PATCH /api/state/:id
     */
    app.patch("/state/:id", async (request, reply) => {
        const { id } = request.params as { id: string };
        const body = request.body as { title?: string; description?: string | null };
        if (!await ensureDocumentWritable(id, request, reply)) return;

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
     * Publish or unpublish a project.
     * POST /api/state/:id/publish   { published: boolean }
     *
     * Publishing is reversible and is only about *visibility*: it puts the project in
     * `GET /state/public` for every account, read-only for all of them, and leaves it fully
     * editable for whoever owns it. That is what separates it from `review-only` below, which is a
     * permanent lock that applies to the owner too — kept for the projects already converted with
     * it, and no longer offered anywhere in the UI.
     */
    app.post("/state/:id/publish", async (request, reply) => {
        const { id } = request.params as { id: string };
        if (!isUuid(id)) {
            return reply.status(400).send({ error: "Invalid document id" });
        }

        const body = (request.body ?? {}) as { published?: unknown };
        if (typeof body.published !== "boolean") {
            return reply.status(400).send({ error: "Missing published flag" });
        }

        const access = await getDocumentAccess(id);
        if (!access) {
            return reply.status(404).send({ error: "Document not found" });
        }

        const user = await app.currentUser(request);
        // Publishing is an outward-facing act, so it is the one thing an ownerless legacy project
        // cannot do anonymously: somebody has to be answerable for what appears in the public list.
        if (!user) {
            return reply.status(401).send({ error: "Sign in to publish a project." });
        }
        if (access.owner_id !== null && access.owner_id !== user.id) {
            return reply.status(403).send({ error: "Only the owner can publish this project." });
        }

        const { rows } = await app.pg.query(
            `
            UPDATE documents
            SET
                published = $2,
                published_at = CASE WHEN $2 THEN COALESCE(published_at, now()) ELSE NULL END,
                -- Publishing an ownerless legacy project claims it, because the public list has to
                -- be able to say who put it there.
                owner_id = COALESCE(owner_id, $3)
            WHERE id = $1
            RETURNING id, title, description, version, updated_at, review_only, published, published_at, owner_id
            `,
            [id, body.published, user.id],
        );

        if (rows.length === 0) {
            return reply.status(404).send({ error: "Document not found" });
        }

        return { ...rows[0], owner_username: user.username, can_edit: !rows[0].review_only };
    });

    /**
     * Convert a document to permanent review-only mode.
     * POST /api/state/:id/review-only
     *
     * Superseded by publish/unpublish above and no longer reachable from the UI. It stays because
     * projects already converted with it must keep behaving the way they were converted to.
     */
    app.post("/state/:id/review-only", async (request, reply) => {
        const { id } = request.params as { id: string };

        const { rows } = await app.pg.query(
            `
            UPDATE documents
            SET
                review_only = TRUE,
                version = CASE WHEN review_only THEN version ELSE version + 1 END
            WHERE id = $1
            RETURNING id, title, description, version, updated_at, review_only
            `,
            [id],
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
        if (!await ensureDocumentWritable(id, request, reply)) return;

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
        if (!await ensureDocumentWritable(id, request, reply)) return;

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
        if (!await ensureDocumentWritable(docId, request, reply)) return;

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
        const createdAtField = typeof fields.createdAt === "string"
            ? fields.createdAt.trim()
            : "";
        const parsedCreatedAt = createdAtField !== "" ? new Date(createdAtField) : null;
        const createdAt = parsedCreatedAt && !Number.isNaN(parsedCreatedAt.getTime())
            ? parsedCreatedAt.toISOString()
            : new Date().toISOString();

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
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)
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
                    createdAt,
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
        if (!await ensureDocumentReadable(id, request, reply)) return;
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
        if (!await ensureDocumentWritable(docId, request, reply)) return;

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
