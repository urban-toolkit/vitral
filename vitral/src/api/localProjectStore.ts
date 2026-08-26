import localforage from "localforage";

import type { fileExtension, fileRecord, TimelineStatePayload } from "@/config/types";
import type { DocumentResponse, FlowStatePayload } from "@/api/stateApi";

/**
 * Guest projects, stored in the browser and never sent anywhere.
 *
 * A guest is somebody who chose "continue as a guest" on the login screen: they get the whole
 * editor, and their work stays on their machine. That is the promise the login screen makes, so
 * this module is the only place a guest project is ever written — nothing here calls the API, and
 * `stateApi` routes to it by id rather than by asking who is signed in, so a request can never
 * leak to the server because some caller forgot to check.
 *
 * IndexedDB via localforage rather than `localStorage`: a project carries file blobs and a full
 * revision history, which is megabytes, and `localStorage` is a synchronous ~5MB string store.
 */
const LOCAL_ID_PREFIX = "local-";

/** Whether `docId` names a guest project rather than one on the server. */
export function isLocalProjectId(docId: string | null | undefined): boolean {
    return typeof docId === "string" && docId.startsWith(LOCAL_ID_PREFIX);
}

export function newLocalProjectId(): string {
    return `${LOCAL_ID_PREFIX}${crypto.randomUUID()}`;
}

const documents = localforage.createInstance({ name: "vitral", storeName: "guest_documents" });
const blobs = localforage.createInstance({ name: "vitral", storeName: "guest_file_blobs" });

/**
 * How many canvas snapshots a guest project keeps.
 *
 * The server keeps every revision in Postgres; a browser cannot, and the timeline only ever reads
 * the newest snapshot at or before a point, so the oldest are the ones it can afford to lose. The
 * cap is what stops a long session from filling the origin's storage quota and failing the *next*
 * save, which would lose live work rather than history.
 */
const MAX_LOCAL_REVISIONS = 200;

type LocalRevision = {
    version: number;
    capturedAt: string;
    state: FlowStatePayload;
    timeline: TimelineStatePayload;
};

type LocalDocument = {
    id: string;
    title: string;
    description: string | null;
    version: number;
    created_at: string;
    updated_at: string;
    state: FlowStatePayload;
    timeline: TimelineStatePayload;
    revisions: LocalRevision[];
    files: fileRecord[];
};

function emptyState(): FlowStatePayload {
    return { flow: { nodes: [], edges: [] } };
}

/** The list-shaped view of a guest project, matching what the server returns for a server one. */
function toResponse(doc: LocalDocument): DocumentResponse {
    return {
        id: doc.id,
        title: doc.title,
        description: doc.description,
        version: doc.version,
        updated_at: doc.updated_at,
        review_only: false,
        // A guest project has no account behind it, so it can be neither published nor owned.
        published: false,
        owner_id: null,
        owner_username: null,
        can_edit: true,
        is_owner: true,
        is_local: true,
    };
}

async function readDocument(docId: string): Promise<LocalDocument | null> {
    return (await documents.getItem<LocalDocument>(docId)) ?? null;
}

async function writeDocument(doc: LocalDocument): Promise<void> {
    await documents.setItem(doc.id, doc);
}

export async function listLocalDocuments(): Promise<DocumentResponse[]> {
    const found: LocalDocument[] = [];
    await documents.iterate<LocalDocument, void>((value) => {
        if (value && typeof value === "object" && typeof value.id === "string") found.push(value);
    });
    found.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    return found.map(toResponse);
}

export async function createLocalDocument(
    title: string,
    state: FlowStatePayload,
    description?: string,
    timeline?: TimelineStatePayload,
): Promise<DocumentResponse> {
    const now = new Date().toISOString();
    const doc: LocalDocument = {
        id: newLocalProjectId(),
        title: title.trim() || "Untitled",
        description: description ?? null,
        version: 1,
        created_at: now,
        updated_at: now,
        state: state ?? emptyState(),
        timeline: timeline ?? ({} as TimelineStatePayload),
        revisions: [],
        files: [],
    };
    await writeDocument(doc);
    return toResponse(doc);
}

export async function loadLocalDocument(docId: string): Promise<DocumentResponse> {
    const doc = await readDocument(docId);
    if (!doc) throw new Error("That project is not in this browser.");
    return {
        ...toResponse(doc),
        state: doc.state,
        timeline: doc.timeline,
    };
}

export async function saveLocalDocument(
    docId: string,
    payload: { title?: string; description?: string | null; state: FlowStatePayload; timeline?: TimelineStatePayload },
): Promise<DocumentResponse> {
    const existing = await readDocument(docId);
    const now = new Date().toISOString();

    // Mirrors the server's `PUT /state/:id`, which is an upsert: a save can be the first thing that
    // ever happens to an id.
    const doc: LocalDocument = existing ?? {
        id: docId,
        title: "Untitled",
        description: null,
        version: 0,
        created_at: now,
        updated_at: now,
        state: emptyState(),
        timeline: {} as TimelineStatePayload,
        revisions: [],
        files: [],
    };

    doc.title = payload.title?.trim() || doc.title;
    doc.description = payload.description ?? doc.description;
    doc.state = payload.state;
    if (payload.timeline !== undefined) doc.timeline = payload.timeline;
    doc.version += 1;
    doc.updated_at = now;

    await writeDocument(doc);
    return toResponse(doc);
}

export async function updateLocalDocumentMeta(
    docId: string,
    payload: { title?: string; description?: string | null },
): Promise<DocumentResponse> {
    const doc = await readDocument(docId);
    if (!doc) throw new Error("That project is not in this browser.");
    if (payload.title !== undefined) doc.title = payload.title.trim() || doc.title;
    if (payload.description !== undefined) doc.description = payload.description;
    doc.version += 1;
    doc.updated_at = new Date().toISOString();
    await writeDocument(doc);
    return toResponse(doc);
}

export async function deleteLocalDocument(docId: string): Promise<void> {
    const doc = await readDocument(docId);
    if (doc) {
        for (const file of doc.files) {
            await blobs.removeItem(`${docId}:${file.id}`);
        }
    }
    await documents.removeItem(docId);
}

export async function duplicateLocalDocument(docId: string): Promise<DocumentResponse> {
    const source = await readDocument(docId);
    if (!source) throw new Error("That project is not in this browser.");

    const now = new Date().toISOString();
    const copyId = newLocalProjectId();
    const fileIdByOldId = new Map<string, string>();
    const copiedFiles: fileRecord[] = [];

    for (const file of source.files) {
        const newFileId = crypto.randomUUID();
        fileIdByOldId.set(file.id, newFileId);
        const blob = await blobs.getItem<Blob>(`${docId}:${file.id}`);
        if (blob) await blobs.setItem(`${copyId}:${newFileId}`, blob);
        copiedFiles.push({ ...file, id: newFileId, docId: copyId });
    }

    // The canvas references its attachments by id, so a copy whose blobs were re-keyed has to have
    // those references rewritten or every card in it points at a file that is not there.
    const rewritten = JSON.parse(JSON.stringify(source.state)) as FlowStatePayload;
    for (const node of rewritten.flow?.nodes ?? []) {
        const data = (node as { data?: Record<string, unknown> }).data;
        if (!data) continue;
        if (Array.isArray(data.attachmentIds)) {
            data.attachmentIds = data.attachmentIds.map((id) => (
                typeof id === "string" ? (fileIdByOldId.get(id) ?? id) : id
            ));
        }
        if (typeof data.origin === "string") {
            data.origin = fileIdByOldId.get(data.origin) ?? data.origin;
        }
    }

    const copy: LocalDocument = {
        ...source,
        id: copyId,
        title: `${source.title} (copy)`,
        version: 1,
        created_at: now,
        updated_at: now,
        state: rewritten,
        // History belongs to the original: the copy's snapshots would all claim to predate it.
        revisions: [],
        files: copiedFiles,
    };

    await writeDocument(copy);
    return toResponse(copy);
}

export async function appendLocalRevision(
    docId: string,
    payload: { state: FlowStatePayload; timeline?: TimelineStatePayload; capturedAt?: string },
): Promise<void> {
    const doc = await readDocument(docId);
    if (!doc) return;

    doc.revisions.push({
        version: doc.version,
        capturedAt: payload.capturedAt ?? new Date().toISOString(),
        state: payload.state,
        timeline: payload.timeline ?? doc.timeline,
    });
    if (doc.revisions.length > MAX_LOCAL_REVISIONS) {
        doc.revisions.splice(0, doc.revisions.length - MAX_LOCAL_REVISIONS);
    }
    await writeDocument(doc);
}

/** The newest snapshot at or before `at`, falling back to the live state. Mirrors `loadSnapshotAt`. */
export async function loadLocalDocumentStateAt(docId: string, at: string | null) {
    const doc = await readDocument(docId);
    if (!doc) throw new Error("That project is not in this browser.");

    const cutoff = at ? new Date(at).getTime() : Number.POSITIVE_INFINITY;
    let best: LocalRevision | null = null;
    for (const revision of doc.revisions) {
        const capturedAt = new Date(revision.capturedAt).getTime();
        if (!Number.isFinite(capturedAt) || capturedAt > cutoff) continue;
        if (!best || capturedAt >= new Date(best.capturedAt).getTime()) best = revision;
    }

    return {
        state: best?.state ?? doc.state,
        timeline: best?.timeline ?? doc.timeline,
        version: best?.version ?? doc.version,
        capturedAt: best?.capturedAt ?? doc.updated_at,
    };
}

// --- Files ------------------------------------------------------------------------------------

export async function listLocalFiles(docId: string): Promise<{ files: fileRecord[] }> {
    const doc = await readDocument(docId);
    return { files: doc?.files ?? [] };
}

export async function createLocalFile(
    docId: string,
    file: { name: string; ext: fileExtension; mimeType: string; sizeBytes: number; blob: Blob },
    createdAt?: string,
): Promise<fileRecord> {
    const doc = await readDocument(docId);
    if (!doc) throw new Error("That project is not in this browser.");

    const record: fileRecord = {
        id: crypto.randomUUID(),
        docId,
        name: file.name,
        ext: file.ext,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createdAt: createdAt ?? new Date().toISOString(),
    };

    await blobs.setItem(`${docId}:${record.id}`, file.blob);
    doc.files.push(record);
    doc.updated_at = new Date().toISOString();
    await writeDocument(doc);
    return record;
}

export async function deleteLocalFile(docId: string, fileId: string): Promise<void> {
    const doc = await readDocument(docId);
    if (!doc) return;
    doc.files = doc.files.filter((file) => file.id !== fileId);
    await blobs.removeItem(`${docId}:${fileId}`);
    await writeDocument(doc);
}

export async function readLocalFileBlob(docId: string, fileId: string): Promise<Blob | null> {
    return (await blobs.getItem<Blob>(`${docId}:${fileId}`)) ?? null;
}

/**
 * A guest project as a single JSON file.
 *
 * The server's `.vi` is a zip built by `utils/projectVi.ts`, which a browser cannot assemble
 * without a zip library the app does not carry. This is deliberately a different, simpler format
 * with a different extension, so nobody mistakes it for one the importer accepts.
 */
export async function exportLocalDocument(docId: string): Promise<Blob> {
    const doc = await readDocument(docId);
    if (!doc) throw new Error("That project is not in this browser.");

    const files: Array<fileRecord & { dataUrl?: string }> = [];
    for (const file of doc.files) {
        const blob = await blobs.getItem<Blob>(`${docId}:${file.id}`);
        if (!blob) {
            files.push({ ...file });
            continue;
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
            reader.readAsDataURL(blob);
        });
        files.push({ ...file, dataUrl });
    }

    const payload = {
        format: "vitral-guest-project",
        version: 1,
        exportedAt: new Date().toISOString(),
        document: {
            title: doc.title,
            description: doc.description,
            state: doc.state,
            timeline: doc.timeline,
        },
        files,
    };

    return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}
