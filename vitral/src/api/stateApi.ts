
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