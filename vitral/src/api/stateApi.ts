import type { fileData } from "@/config/types";

export type FlowStatePayload = {
    flow: {
        nodes: any[];
        edges: any[];
    };
};

export type DocumentResponse = {
    id: string;
    title: string;
    description: string | null;
    version: number;
    updated_at: string;
    state?: FlowStatePayload; // returned by GET
};

const API_BASE = import.meta.env.VITE_BACKEND_URL ?? "http://localhost:3000";

export async function createDocument(
    title: string,
    state: FlowStatePayload
): Promise<DocumentResponse> {
    const res = await fetch(`${API_BASE}/api/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, state }),
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

export async function saveDocument(
    docId: string,
    state: FlowStatePayload,
    title?: string
): Promise<DocumentResponse> {
    const res = await fetch(`${API_BASE}/api/state/${docId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, state }),
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

export async function updateDocumentMeta(docId: string, payload: { title?: string, description?: string }) {
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

export async function createFile(docId: string, payload: {
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    content: string;
    contentKind: "text" | "base64";
}): Promise<{ fileId: string }> {

    const res = await fetch(`${API_BASE}/state/${docId}/files`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to create file");
    }

    return res.json();
}

export async function listFiles(docId: string): Promise<{ files: fileData[] }> {
    const res = await fetch(`${API_BASE}/state/${docId}/files`, {
        method: "GET",
        credentials: "include",
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Failed to list files");
    }

    return res.json();
}

