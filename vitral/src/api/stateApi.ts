import type { filePendingUpload, fileRecord, TimelineStatePayload } from "@/config/types";
import { resolveApiBaseUrl } from "@/api/baseUrl";

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
    review_only?: boolean;
    state?: FlowStatePayload; // returned by GET
    timeline?: TimelineStatePayload;
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

export type CompareCardsSimilarityRequest = {
    newCards: SimilarityCardInput[];
    existingCards: SimilarityCardInput[];
};

export type CompareCardsSimilarityResponse = {
    matches: Array<{
        newCardId: string;
        existingCardId: string | null;
        similarity: number;
    }>;
};

export type SystemPaperQueryCard = {
    label?: string;
    title?: string;
    description?: string;
    text?: string;
    content?: string;
};

export type QuerySystemPapersRequest = {
    cards: SystemPaperQueryCard[];
    limit?: number;
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
    skippedFiles: string[];
    queryTerms: string[];
    results: QuerySystemPapersResult[];
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
    description?: string
): Promise<DocumentResponse> {
    const res = await fetch(`${API_BASE}/state`, {
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
    const res = await fetch(`${API_BASE}/state/${docId}`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

export async function loadDocuments(): Promise<DocumentResponse[]> {
    const res = await fetch(`${API_BASE}/state`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

export async function exportProjectVi(docId: string): Promise<Blob> {
    const res = await fetch(`${API_BASE}/state/${docId}/export-vi`, {
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

    const res = await fetch(`${API_BASE}/state/import-vi`, {
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
    const res = await fetch(`${API_BASE}/setup-templates/literature`);

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
    const res = await fetch(`${API_BASE}/state/${docId}/query-nodes`, {
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
    const res = await fetch(`${API_BASE}/system-papers/query`, {
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
    const res = await fetch(`${API_BASE}/state/${docId}`, {
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
    const res = await fetch(`${API_BASE}/state/${docId}/revision`, {
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
    const res = await fetch(`${API_BASE}/state/${docId}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
    }
}

export async function updateDocumentMeta(docId: string, payload: { title?: string, description?: string | null }) {
    const res = await fetch(`${API_BASE}/state/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        throw new Error(`Update failed: ${res.status}`);
    }

    return res.json();
}

export async function createFile(docId: string, pending: filePendingUpload): Promise<{ fileId: string, createdAt: string, sha256: string, sizeBytes: number, bucket: string, key: string }> {

    const fd = new FormData();
    fd.append("id", pending.id);
    fd.append("name", pending.name);
    fd.append("mimeType", pending.mimeType);
    fd.append("file", pending.file); // binary

    const res = await fetch(`${API_BASE}/state/${docId}/files`, {
        method: "POST",
        body: fd,
    });

    if (!res.ok) {
        throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

export async function listFiles(docId: string): Promise<{ files: fileRecord[] }> {
    const res = await fetch(`${API_BASE}/state/${docId}/files`, {
        method: "GET",
        credentials: "include",
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
    const res = await fetch(`${API_BASE}/state/${docId}/query-chat`, {
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
    const query = encodeURIComponent(at);
    const res = await fetch(`${API_BASE}/state/${docId}/state-at?at=${query}`, {
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
    const query = encodeURIComponent(at);
    const res = await fetch(`${API_BASE}/state/${docId}/knowledge/provenance?at=${query}`, {
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
): Promise<CompareCardsSimilarityResponse> {
    const res = await fetch(`${API_BASE}/state/${docId}/cards/similarity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Similarity query failed: ${res.status}`);
    }

    return res.json();
}

export async function deleteFile(docId: string, fileId: string): Promise<void> {
    const res = await fetch(`${API_BASE}/state/${docId}/files/${fileId}`, {
        method: "DELETE",
        credentials: "include",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to delete file");
    }
}

// Only text
export async function getFileContent(docId: string, fileId: string): Promise<fileRecord & {content: string}> {
    const res = await fetch(`${API_BASE}/state/${docId}/files/${fileId}/content`, {
        method: "GET",
        credentials: "include",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to get file content");
    }

    return res.json();
}

