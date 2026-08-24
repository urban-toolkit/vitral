import type { fileRecord } from "@/config/types";
import { resolveApiBaseUrl } from "@/api/baseUrl";

export const API_BASE = resolveApiBaseUrl();

/**
 * The raw-content URL for a file, or `""` when the record carries no usable document id.
 *
 * Shared by the thumbnail in `FilePreview` and the renderers in `FileDocumentView`, which have to
 * make the same "is this id real" judgement — a project loaded from an older export can carry the
 * literal string `"undefined"` there.
 */
export function resolveRawFileUrl(file: fileRecord): string {
    const docId = typeof file.docId === "string" ? file.docId.trim() : "";
    if (docId === "" || docId === "undefined") return "";
    return `${API_BASE}/state/${docId}/files/${file.id}/raw`;
}
