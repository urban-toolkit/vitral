import type { fileRecord } from "@/config/types";
import { resolveApiBaseUrl } from "@/api/baseUrl";
import { isLocalProjectId, readLocalFileBlob } from "@/api/localProjectStore";

export const API_BASE = resolveApiBaseUrl();

/**
 * Object URLs minted for guest attachments, keyed by `docId:fileId`.
 *
 * A guest's files are blobs in IndexedDB with no URL of their own, and `resolveRawFileUrl` has to
 * answer synchronously — every `<img src>` and every preview calls it during render. So the URL is
 * created once, asynchronously, the first time a file is asked for, and the cache is what makes
 * every later render hit. They are deliberately never revoked: the same file is re-rendered
 * whenever the canvas redraws, and a revoked URL would blank an image that is still on screen.
 */
const localObjectUrls = new Map<string, string>();
const pendingLocalUrls = new Set<string>();

function localFileKey(docId: string, fileId: string): string {
    return `${docId}:${fileId}`;
}

/**
 * Warms the object URL for a guest file and reports whether anything new arrived, so a caller can
 * re-render once the URL exists. Resolves to `false` when the file is already cached or missing.
 */
export async function ensureLocalFileUrl(file: fileRecord): Promise<boolean> {
    const docId = typeof file.docId === "string" ? file.docId.trim() : "";
    if (!isLocalProjectId(docId)) return false;

    const key = localFileKey(docId, file.id);
    if (localObjectUrls.has(key) || pendingLocalUrls.has(key)) return false;

    pendingLocalUrls.add(key);
    try {
        const blob = await readLocalFileBlob(docId, file.id);
        if (!blob) return false;
        localObjectUrls.set(key, URL.createObjectURL(blob));
        return true;
    } finally {
        pendingLocalUrls.delete(key);
    }
}

/**
 * The raw-content URL for a file, or `""` when the record carries no usable document id.
 *
 * Shared by the thumbnail in `FilePreview` and the renderers in `FileDocumentView`, which have to
 * make the same "is this id real" judgement — a project loaded from an older export can carry the
 * literal string `"undefined"` there.
 *
 * A guest project's files never reached the server, so there is no route to point at: those resolve
 * to a `blob:` URL from the cache above, and to `""` until `ensureLocalFileUrl` has filled it.
 */
export function resolveRawFileUrl(file: fileRecord): string {
    const docId = typeof file.docId === "string" ? file.docId.trim() : "";
    if (docId === "" || docId === "undefined") return "";

    if (isLocalProjectId(docId)) {
        const cached = localObjectUrls.get(localFileKey(docId, file.id));
        if (cached) return cached;
        void ensureLocalFileUrl(file);
        return "";
    }

    return `${API_BASE}/state/${docId}/files/${file.id}/raw`;
}
