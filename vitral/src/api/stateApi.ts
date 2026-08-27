import type { filePendingUpload, fileRecord, TimelineStatePayload } from "@/config/types";
import { resolveApiBaseUrl } from "@/api/baseUrl";
import { apiCredentials } from "@/api/guestMode";
import { withDeadline } from "@/utils/abort";
import type { SimilarityMatch } from "@/pages/projectEditor/similarityDecision";
import {
    appendLocalRevision,
    createLocalDocument,
    createLocalFile,
    deleteLocalDocument,
    deleteLocalFile,
    duplicateLocalDocument,
    exportLocalDocument,
    isLocalProjectId,
    listLocalDocuments,
    listLocalFiles,
    loadLocalDocument,
    loadLocalDocumentStateAt,
    readLocalFileBlob,
    saveLocalDocument,
    updateLocalDocumentMeta,
} from "@/api/localProjectStore";

/**
 * `fetch`, with the session cookie attached — unless this is a guest.
 *
 * Every document call needs it now that projects have owners — a request without it is anonymous,
 * so the server shows it only the ownerless legacy projects and refuses every write. Three calls in
 * this file used to set `credentials` by hand and twenty did not; routing them all through here is
 * what makes "did you remember" stop being a question.
 */
function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    // A guest is nobody, and has to look like nobody to the server. Sending a cookie left behind by
    // an account — which a second tab signing in is enough to produce — makes the server answer for
    // *that account*: `can_edit: true` on its projects, and writes accepted. Omitting it is what
    // makes "a guest cannot change somebody's published project" true at the layer that decides.
    return fetch(input, { ...init, credentials: apiCredentials() });
}

/**
 * Server-only routes reached with a guest project's id.
 *
 * A guest's work never leaves the browser, so the features that are computed server-side —
 * embeddings, the assistant's retrieval, provenance — have nothing to answer with. Thrown rather
 * than silently empty so the caller can say so; `autoLinkCards` already treats a failed lookup as
 * "no matches" rather than "nothing is similar".
 */
export class LocalProjectUnsupportedError extends Error {
    constructor(what: string) {
        super(`${what} needs a project saved to your account. Sign in to use it.`);
        this.name = "LocalProjectUnsupportedError";
    }
}

export type FlowStatePayload = {
    flow: {
        nodes: unknown[];
        edges: unknown[];
    };
};

export type DocumentResponse = {
    id: string;
    title: string;
    description: string | null;
    version: number;
    updated_at: string;
    /** Legacy permanent edit lock. Superseded by publishing, kept for projects already converted. */
    review_only?: boolean;
    /** Visible to every account under Public projects. Reversible, and orthogonal to `review_only`. */
    published?: boolean;
    published_at?: string | null;
    owner_id?: string | null;
    owner_username?: string | null;
    /**
     * Whether *this viewer* may change it. Not the same as `!review_only` any more: a published
     * project is editable by its owner and read-only for everybody else, so the server works this
     * out per request rather than leaving the client to infer it.
     */
    can_edit?: boolean;
    is_owner?: boolean;
    /** Set only by the guest store: this project lives in the browser, not on the server. */
    is_local?: boolean;
    state?: FlowStatePayload; // returned by GET
    timeline?: TimelineStatePayload;
};

export type DuplicateDocumentJobStatus = "queued" | "running" | "succeeded" | "failed";

export type DuplicateDocumentJobResponse = {
    jobId: string;
    sourceDocId: string;
    status: DuplicateDocumentJobStatus;
    createdAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    result: DocumentResponse | null;
    error: string | null;
};

export type LiteratureSetupTemplate = {
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

export type NodeStructuredFilters = {
    labels?: string[];
    createdAtFrom?: string;
    createdAtTo?: string;
    titleContains?: string[];
    descriptionContains?: string[];
};

export type ParsedNodeQuery = {
    semanticQuery: string;
    structuredFilters?: NodeStructuredFilters;
};

export type QueryDocumentNodesRequest = {
    query: string;
    limit?: number;
    minScore?: number;
    scopeNodeIds?: string[];
    at?: string;
};

export type QueryDocumentNodesResponse = {
    parsed: ParsedNodeQuery;
    matchedNodeIds: string[];
    usedVectorSearch: boolean;
};

export type CanvasChatMessage = {
    role: "user" | "assistant";
    content: string;
};

export type QueryCanvasChatRequest = {
    message: string;
    conversation?: CanvasChatMessage[];
    limit?: number;
    minScore?: number;
    scopeNodeIds?: string[];
    at?: string;
};

export type QueryCanvasChatResponse = {
    reply: string;
    applyFilter: boolean;
    matchedNodeIds: string[];
    parsed: ParsedNodeQuery;
    usedVectorSearch: boolean;
};

export type DocumentStateAtResponse = {
    state: FlowStatePayload;
    timeline: TimelineStatePayload;
    capturedAt: string;
    version: number;
};

export type KnowledgePillEvent = {
    id: string;
    occurredAt: string;
    eventType: "created";
    isDeleted?: boolean;
    nodeId: string;
    cardLabel: string;
    cardTitle: string;
    cardDescription: string;
    treeId?: string | null;
    treeTitle?: string | null;
    metadata?: unknown;
};

export type KnowledgePill = {
    treeId: string;
    treeTitle: string;
    occurredAt: string;
    events: KnowledgePillEvent[];
};

export type KnowledgeCrossTreeConnection = {
    id: string;
    occurredAt: string;
    label: string;
    kind: "regular" | "referenced_by" | "iteration_of";
    sourceNodeId: string;
    targetNodeId: string;
    sourceCardTitle: string;
    sourceCardLabel: string;
    targetCardTitle: string;
    targetCardLabel: string;
    sourceTreeId: string;
    targetTreeId: string;
};

export type KnowledgeBlueprintLink = {
    id: string;
    kind: "regular" | "referenced_by" | "iteration_of";
    label: string;
    cardNodeId: string;
    cardLabel: string;
    cardTitle: string;
    cardCreatedAt: string;
    blueprintEventId: string;
    blueprintEventName: string;
    blueprintOccurredAt: string;
    componentNodeId: string;
};

export type KnowledgeProvenanceResponse = {
    at: string;
    minAt: string;
    maxAt: string;
    pills: KnowledgePill[];
    events: KnowledgePillEvent[];
    crossTreeConnections: KnowledgeCrossTreeConnection[];
    blueprintLinks: KnowledgeBlueprintLink[];
};

export type SimilarityCardInput = {
    id: string;
    label: string;
    title: string;
    description: string;
};

/**
 * Only the new cards go over the wire. The server already holds the rest of the canvas and searches
 * its own vector index, so shipping every existing card's text on every file drop bought nothing
 * except a payload that grew with the project (and a silent 500-card truncation at the far end).
 */
export type CompareCardsSimilarityRequest = {
    newCards: SimilarityCardInput[];
};

export type CompareCardsSimilarityResponse = {
    /**
     * `degraded` means the lookup itself failed. Distinguished from an empty match list on purpose:
     * "the embedding call broke" and "nothing on this canvas is similar" are otherwise the same
     * shape, and the first one should not quietly read as the second.
     */
    status: "ok" | "degraded" | "unavailable";
    matches: SimilarityMatch[];
};

export type SystemPaperQueryCard = {
    label?: string;
    title?: string;
    description?: string;
    text?: string;
    content?: string;
};

/**
 * Whole papers, or the components inside them.
 *
 * `paper` melts every requirement into one query and asks which system in the literature covers the
 * project. `component` takes the requirements the researcher selected on the canvas and asks which
 * individual blocks answer them — a different corpus, a different IDF, and a different answer. See
 * `backend/src/routes/system_papers.ts`.
 */
export type SystemPaperGranularity = "paper" | "component";

export type QuerySystemPapersRequest = {
    cards: SystemPaperQueryCard[];
    limit?: number;
    /** Free text, blended with the cards. Accepted by the server since before it was ever sent. */
    query?: string;
    granularity?: SystemPaperGranularity;
    /** Component mode: how many components one paper may contribute. Server default is 3. */
    perPaperCap?: number;
};

export type SystemPaper = {
    PaperTitle: string;
    Year: number;
    HighBlocks: HighBlock[];
};

export type HighBlock = {
    HighBlockName: string;
    IntermediateBlocks: IntermediateBlock[];
};

export type IntermediateBlock = {
    IntermediateBlockName: string;
    GranularBlocks: GranularBlock[];
};

export type GranularBlock = {
    GranularBlockName: string;
    ID: number;
    PaperDescription: string;
    Inputs: string[];
    Outputs: string[];
    ReferenceCitation: string;
    FeedsInto: number[];
};

export type QuerySystemPapersResult = {
    fileName: string;
    paperTitle: string;
    year: number;
    score: number;
    coverage: number;
    matchedTerms: string[];
    paper: SystemPaper;
};

export type QuerySystemPapersResponse = {
    sourceDir: string;
    totalPapers: number;
    totalComponents?: number;
    skippedFiles: string[];
    granularity?: SystemPaperGranularity;
    queryTerms: string[];
    results: QuerySystemPapersResult[];
};

/**
 * One component, carrying enough of its paper to become a canvas node on its own.
 *
 * Deliberately not a `SystemPaper` slice: the whole point of component search is to take a piece
 * without the rest of the paper, so everything the tray needs to build a `blueprintComponent` node
 * — the block path for its description, the file name and title for provenance, and `FeedsInto` so
 * a multi-component drag can rebuild the wiring between the pieces — travels on the result itself.
 */
export type QuerySystemComponentsResult = {
    fileName: string;
    paperTitle: string;
    year: number;
    highBlockName: string;
    intermediateBlockName: string;
    score: number;
    coverage: number;
    matchedTerms: string[];
    granularBlock: GranularBlock;
};

export type QuerySystemComponentsResponse = {
    sourceDir: string;
    totalPapers: number;
    totalComponents: number;
    skippedFiles: string[];
    granularity: "component";
    queryTerms: string[];
    perPaperCap: number;
    results: QuerySystemComponentsResult[];
};

const API_BASE = resolveApiBaseUrl();

function normalizeFileRecord(raw: unknown, fallbackDocId: string): fileRecord | null {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;

    const id = typeof row.id === "string" ? row.id : "";
    if (!id) return null;

    const name = typeof row.name === "string" ? row.name : "file";
    const docIdRaw = typeof row.docId === "string"
        ? row.docId
        : (typeof row.document_id === "string" ? row.document_id : "");
    const docId = docIdRaw.trim() || fallbackDocId;
    const extRaw = typeof row.ext === "string"
        ? row.ext
        : (name.includes(".") ? (name.split(".").pop() ?? "") : "");
    const ext = extRaw.toLowerCase();
    const mimeType = typeof row.mimeType === "string"
        ? row.mimeType
        : (typeof row.mime_type === "string" ? row.mime_type : "application/octet-stream");
    const sizeBytesRaw = typeof row.sizeBytes === "number"
        ? row.sizeBytes
        : (typeof row.size_bytes === "number" ? row.size_bytes : 0);
    const createdAtRaw = typeof row.createdAt === "string"
        ? row.createdAt
        : (typeof row.created_at === "string" ? row.created_at : new Date().toISOString());
    const sha256 = typeof row.sha256 === "string" ? row.sha256 : undefined;
    const storage = row.storage && typeof row.storage === "object"
        ? row.storage as { bucket?: unknown; key?: unknown }
        : {
            bucket: row.storage_bucket,
            key: row.storage_key,
        };
    const bucket = typeof storage.bucket === "string" ? storage.bucket : "";
    const key = typeof storage.key === "string" ? storage.key : "";

    return {
        id,
        docId,
        name,
        ext: ext as fileRecord["ext"],
        sizeBytes: sizeBytesRaw,
        mimeType,
        createdAt: createdAtRaw,
        sha256,
        storage: bucket && key ? { bucket, key } : undefined,
    };
}

export async function createDocument(
    title: string,
    state: FlowStatePayload,
    description?: string,
    options?: { local?: boolean },
): Promise<DocumentResponse> {
    // Creation is the one call with no id to route on, so the caller says which side it belongs
    // to — and the caller is the only one that knows whether this is a guest session.
    if (options?.local) {
        return createLocalDocument(title, state, description);
    }

    const res = await apiFetch(`${API_BASE}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, state, description }),
    });

    if (!res.ok) {
        throw new Error(`Create failed: ${res.status}`);
    }

    return res.json();
}

export async function loadDocument(docId: string): Promise<DocumentResponse> {
    if (isLocalProjectId(docId)) return loadLocalDocument(docId);

    const res = await apiFetch(`${API_BASE}/state/${docId}`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

/** The signed-in account's projects, plus the ownerless ones that predate accounts. */
export async function loadDocuments(): Promise<DocumentResponse[]> {
    const res = await apiFetch(`${API_BASE}/state`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

/** Guest projects held in this browser. Never mixed into the server list by this module. */
export async function loadLocalDocuments(): Promise<DocumentResponse[]> {
    return listLocalDocuments();
}

/** Every published project, whoever owns it. Read-only unless one of them is yours. */
export async function loadPublicDocuments(): Promise<DocumentResponse[]> {
    const res = await apiFetch(`${API_BASE}/state/public`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

export async function exportProjectVi(
    docId: string,
    options?: { includeGithubData?: boolean },
): Promise<Blob> {
    // A guest project exports as JSON, not `.vi`: the archive is assembled server-side and the
    // browser has no zip writer here. `ProjectsPage` names the download accordingly.
    if (isLocalProjectId(docId)) return exportLocalDocument(docId);

    const includeGithubData = options?.includeGithubData ?? true;
    const query = includeGithubData ? "" : "?includeGithub=0";
    const res = await apiFetch(`${API_BASE}/state/${docId}/export-vi${query}`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Export failed: ${res.status}`);
    }

    return res.blob();
}

export async function importProjectVi(file: File): Promise<DocumentResponse> {
    const fd = new FormData();
    fd.append("file", file);

    const res = await apiFetch(`${API_BASE}/state/import-vi`, {
        method: "POST",
        body: fd,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Import failed: ${res.status}`);
    }

    return res.json();
}

export async function loadLiteratureSetupTemplates(): Promise<LiteratureSetupTemplate[]> {
    const res = await apiFetch(`${API_BASE}/setup-templates/literature`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    const payload = await res.json() as { templates?: LiteratureSetupTemplate[] };
    return Array.isArray(payload.templates) ? payload.templates : [];
}

export async function queryDocumentNodes(
    docId: string,
    payload: QueryDocumentNodesRequest,
): Promise<QueryDocumentNodesResponse> {
    if (isLocalProjectId(docId)) throw new LocalProjectUnsupportedError("Searching the canvas");

    const res = await apiFetch(`${API_BASE}/state/${docId}/query-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Query failed: ${res.status}`);
    }

    return res.json();
}

export async function querySystemPapers(
    payload: QuerySystemPapersRequest,
): Promise<QuerySystemPapersResponse> {
    return postSystemPapersQuery(payload);
}

/**
 * The component-granularity twin of `querySystemPapers`. Same route, different corpus and different
 * result shape, so it is a separate function rather than a union the caller has to narrow.
 */
export async function querySystemComponents(
    payload: Omit<QuerySystemPapersRequest, "granularity">,
): Promise<QuerySystemComponentsResponse> {
    return postSystemPapersQuery({ ...payload, granularity: "component" });
}

async function postSystemPapersQuery<T>(payload: QuerySystemPapersRequest): Promise<T> {
    const res = await apiFetch(`${API_BASE}/system-papers/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Query failed: ${res.status}`);
    }

    return res.json();
}

export async function saveDocument(
    docId: string,
    state: FlowStatePayload,
    timeline: TimelineStatePayload,
    title?: string
): Promise<DocumentResponse> {
    if (isLocalProjectId(docId)) return saveLocalDocument(docId, { title, state, timeline });

    const res = await apiFetch(`${API_BASE}/state/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, state, timeline }),
    });

    if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
    }

    return res.json();
}

export async function appendDocumentRevisionSnapshot(
    docId: string,
    state: FlowStatePayload,
    timeline: TimelineStatePayload,
): Promise<void> {
    if (isLocalProjectId(docId)) {
        await appendLocalRevision(docId, { state, timeline });
        return;
    }

    const res = await apiFetch(`${API_BASE}/state/${docId}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, timeline }),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Revision snapshot failed: ${res.status}`);
    }
}

export async function deleteDocument(docId: string) {
    if (isLocalProjectId(docId)) return deleteLocalDocument(docId);

    const res = await apiFetch(`${API_BASE}/state/${docId}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
    }
}

export async function startDuplicateDocument(docId: string): Promise<DuplicateDocumentJobResponse> {
    // Copying a guest project is a local write, not a background job — but the caller polls, so it
    // gets back a job that has already succeeded rather than a second code path to special-case.
    if (isLocalProjectId(docId)) {
        const copy = await duplicateLocalDocument(docId);
        const now = new Date().toISOString();
        return {
            jobId: `local-${copy.id}`,
            sourceDocId: docId,
            status: "succeeded",
            createdAt: now,
            startedAt: now,
            finishedAt: now,
            result: copy,
            error: null,
        };
    }

    const res = await apiFetch(`${API_BASE}/state/${docId}/duplicate`, {
        method: "POST",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Duplicate start failed: ${res.status}`);
    }

    return res.json();
}

export async function loadDuplicateDocumentJob(jobId: string): Promise<DuplicateDocumentJobResponse> {
    const res = await apiFetch(`${API_BASE}/state/duplicate-jobs/${jobId}`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Duplicate job failed: ${res.status}`);
    }

    return res.json();
}

export async function updateDocumentMeta(docId: string, payload: { title?: string, description?: string | null }) {
    if (isLocalProjectId(docId)) return updateLocalDocumentMeta(docId, payload);

    const res = await apiFetch(`${API_BASE}/state/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(`Update failed: ${res.status}`);
    }

    return res.json();
}

/**
 * Publish or unpublish a project.
 *
 * This replaces `convertDocumentToReviewOnly` everywhere in the UI. The two are not the same
 * operation: publishing is reversible and only changes who can *see* the project, while
 * review-only was a permanent lock that stopped even its author editing it. The old call stays
 * exported because the projects already converted with it still report `review_only`.
 */
export async function setDocumentPublished(
    docId: string,
    published: boolean,
): Promise<DocumentResponse> {
    if (isLocalProjectId(docId)) {
        throw new LocalProjectUnsupportedError("Publishing a project");
    }

    const res = await apiFetch(`${API_BASE}/state/${docId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ published }),
    });

    if (!res.ok) {
        let message = "";
        try {
            const payload = await res.json() as { error?: string };
            message = typeof payload?.error === "string" ? payload.error : "";
        } catch {
            message = "";
        }
        throw new Error(message || `Publish failed: ${res.status}`);
    }

    return res.json();
}

export async function createFile(
    docId: string,
    pending: filePendingUpload,
    createdAt?: string,
    signal?: AbortSignal,
): Promise<{ fileId: string, createdAt: string, sha256: string, sizeBytes: number, bucket: string, key: string }> {

    const fd = new FormData();
    fd.append("id", pending.id);
    fd.append("name", pending.name);
    fd.append("mimeType", pending.mimeType);
    if (typeof createdAt === "string" && createdAt.trim() !== "") {
        fd.append("createdAt", createdAt.trim());
    }
    if (isLocalProjectId(docId)) {
        const record = await createLocalFile(docId, {
            name: pending.name,
            ext: pending.ext,
            mimeType: pending.mimeType,
            sizeBytes: pending.file.size,
            blob: pending.file,
        }, createdAt);
        // Same shape the upload route returns. `bucket`/`key` are empty strings rather than
        // invented values: nothing about a guest file lives in object storage, and a plausible-
        // looking key would be a lie the export path would then try to follow.
        return {
            fileId: record.id,
            createdAt: record.createdAt,
            sha256: "",
            sizeBytes: record.sizeBytes,
            bucket: "",
            key: "",
        };
    }

    fd.append("file", pending.file); // binary

    const res = await apiFetch(`${API_BASE}/state/${docId}/files`, {
        method: "POST",
        body: fd,
        signal,
    });

    if (!res.ok) {
        throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

export async function listFiles(docId: string): Promise<{ files: fileRecord[] }> {
    if (isLocalProjectId(docId)) return listLocalFiles(docId);

    const res = await apiFetch(`${API_BASE}/state/${docId}/files`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to list files");
    }

    const payload = await res.json() as { files?: unknown[] };
    const rows = Array.isArray(payload.files) ? payload.files : [];
    const files = rows
        .map((row) => normalizeFileRecord(row, docId))
        .filter((row): row is fileRecord => row !== null);

    return { files };
}

export async function queryCanvasChat(
    docId: string,
    payload: QueryCanvasChatRequest,
): Promise<QueryCanvasChatResponse> {
    if (isLocalProjectId(docId)) throw new LocalProjectUnsupportedError("The canvas assistant");

    const res = await apiFetch(`${API_BASE}/state/${docId}/query-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Query failed: ${res.status}`);
    }

    return res.json();
}

export async function loadDocumentStateAt(
    docId: string,
    at: string,
): Promise<DocumentStateAtResponse> {
    if (isLocalProjectId(docId)) return loadLocalDocumentStateAt(docId, at);

    const query = encodeURIComponent(at);
    const res = await apiFetch(`${API_BASE}/state/${docId}/state-at?at=${query}`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Load state-at failed: ${res.status}`);
    }

    return res.json();
}

export async function loadKnowledgeProvenance(
    docId: string,
    at: string,
): Promise<KnowledgeProvenanceResponse> {
    // Provenance is derived server-side as revisions land, so a guest project has none. Empty
    // rather than an error: the knowledge timeline renders nothing and everything else works.
    if (isLocalProjectId(docId)) return { events: [], trees: [] } as unknown as KnowledgeProvenanceResponse;

    const query = encodeURIComponent(at);
    const res = await apiFetch(`${API_BASE}/state/${docId}/knowledge/provenance?at=${query}`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Load provenance failed: ${res.status}`);
    }

    return res.json();
}

export async function compareCardsSimilarity(
    docId: string,
    payload: CompareCardsSimilarityRequest,
    signal?: AbortSignal,
): Promise<CompareCardsSimilarityResponse> {
    // `degraded`, not an empty match list: "the lookup is unavailable" and "nothing is similar" have
    // to stay distinguishable (contract 22), and `autoLinkCards` already returns early on this.
    if (isLocalProjectId(docId)) {
        return { status: "degraded", matches: [] } as unknown as CompareCardsSimilarityResponse;
    }

    const res = await apiFetch(`${API_BASE}/state/${docId}/cards/similarity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: withDeadline(signal, 30_000),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Similarity query failed: ${res.status}`);
    }

    return res.json();
}

export async function deleteFile(docId: string, fileId: string): Promise<void> {
    if (isLocalProjectId(docId)) return deleteLocalFile(docId, fileId);

    const res = await apiFetch(`${API_BASE}/state/${docId}/files/${fileId}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to delete file");
    }
}

// Only text
export async function getFileContent(docId: string, fileId: string): Promise<fileRecord & {content: string}> {
    if (isLocalProjectId(docId)) {
        const { files } = await listLocalFiles(docId);
        const record = files.find((file) => file.id === fileId);
        const blob = await readLocalFileBlob(docId, fileId);
        if (!record || !blob) throw new Error("Failed to get file content");
        return { ...record, content: await blob.text() };
    }

    const res = await apiFetch(`${API_BASE}/state/${docId}/files/${fileId}/content`, {
        method: "GET",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to get file content");
    }

    return res.json();
}

