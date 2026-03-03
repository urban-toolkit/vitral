import type { filePendingUpload, fileRecord, TimelineStatePayload } from "@/config/types";

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
};

export type QueryDocumentNodesResponse = {
    parsed: ParsedNodeQuery;
    matchedNodeIds: string[];
    usedVectorSearch: boolean;
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

const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export async function createDocument(
    title: string,
    state: FlowStatePayload,
    description?: string
): Promise<DocumentResponse> {
    const res = await fetch(`${API_BASE}/api/state`, {
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
    const res = await fetch(`${API_BASE}/api/state/${docId}`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

export async function loadDocuments(): Promise<DocumentResponse[]> {
    const res = await fetch(`${API_BASE}/api/state`);

    if (!res.ok) {
        throw new Error(`Load failed: ${res.status}`);
    }

    return res.json();
}

export async function loadLiteratureSetupTemplates(): Promise<LiteratureSetupTemplate[]> {
    const res = await fetch(`${API_BASE}/api/setup-templates/literature`);

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
    const res = await fetch(`${API_BASE}/api/state/${docId}/query-nodes`, {
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
    const res = await fetch(`${API_BASE}/api/system-papers/query`, {
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
    const res = await fetch(`${API_BASE}/api/state/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, state, timeline }),
    });

    if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
    }

    return res.json();
}

export async function deleteDocument(docId: string) {
    const res = await fetch(`${API_BASE}/api/state/${docId}`, {
        method: "DELETE",
    });

    if (!res.ok) {
        throw new Error(`Delete failed: ${res.status}`);
    }
}

export async function updateDocumentMeta(docId: string, payload: { title?: string, description?: string | null }) {
    const res = await fetch(`${API_BASE}/api/state/${docId}`, {
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

    const res = await fetch(`${API_BASE}/api/state/${docId}/files`, {
        method: "POST",
        body: fd,
    });

    if (!res.ok) {
        throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

export async function listFiles(docId: string): Promise<{ files: fileRecord[] }> {
    const res = await fetch(`${API_BASE}/api/state/${docId}/files`, {
        method: "GET",
        credentials: "include",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to list files");
    }

    return res.json();
}

// Only text
export async function getFileContent(docId: string, fileId: string): Promise<fileRecord & {content: string}> {
    const res = await fetch(`${API_BASE}/api/state/${docId}/files/${fileId}/content`, {
        method: "GET",
        credentials: "include",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to get file content");
    }

    return res.json();
}

