import type { llmCardData, nodeType, cardType, llmConnectionData, edgeType, DesignStudyEvent, fileExtension, fileRecord } from '@/config/types';
import type { filePendingUpload } from '@/config/types';
import { readAsDataURL } from './FileParser';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

async function resizeAndCompressImageToJpeg(
    file: File,
    opts?: { maxLongSide?: number; quality?: number }
): Promise<{ file: File; ext: fileExtension }> {
    const maxLongSide = opts?.maxLongSide ?? 1536; //px
    const quality = opts?.quality ?? 0.78;

    // If it's already reasonably small, avoid extra work/quality loss.
    if ((file.type === "image/jpeg" || file.type === "image/jpg") && file.size <= 2 * 1024 * 1024) {
        return { file, ext: "jpg" };
    }

    const bitmap = await createImageBitmap(file);
    try {
        const srcW = bitmap.width;
        const srcH = bitmap.height;

        const scale = Math.min(1, maxLongSide / Math.max(srcW, srcH));
        const dstW = Math.max(1, Math.round(srcW * scale));
        const dstH = Math.max(1, Math.round(srcH * scale));

        const makeBlob = async (): Promise<Blob> => {
            if (typeof OffscreenCanvas !== "undefined") {
                const canvas = new OffscreenCanvas(dstW, dstH);
                const ctx = canvas.getContext("2d");
                if (!ctx) throw new Error("Could not get 2D context");
                ctx.drawImage(bitmap, 0, 0, dstW, dstH);
                return await canvas.convertToBlob({ type: "image/jpeg", quality });
            }

            const canvas = document.createElement("canvas");
            canvas.width = dstW;
            canvas.height = dstH;
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Could not get 2D context");
            ctx.drawImage(bitmap, 0, 0, dstW, dstH);

            const blob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(
                    (b) => (b ? resolve(b) : reject(new Error("JPEG encode failed"))),
                    "image/jpeg",
                    quality
                );
            });

            return blob;
        };

        const blob = await makeBlob();

        const base = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
        const outFile = new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });

        return { file: outFile, ext: "jpg" };
    } finally {
        bitmap.close?.();
    }
}

function downloadDebugImage(file: File) {
    if (!(import.meta as any).env?.DEV) return;

    try {
        const url = URL.createObjectURL(file);
        const a = document.createElement("a");

        const base = file.name.includes(".") ? file.name.slice(0, file.name.lastIndexOf(".")) : file.name;
        a.href = url;
        a.download = `${base}-compressed-debug.jpg`;

        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (err) {
        console.warn("Failed to trigger debug image download", err);
    }
}

function base64ToFile(base64: string, mimeType: string, filename: string): File {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new File([bytes], filename, { type: mimeType });
}

type NotebookImage = { id: string; mime: string; base64: string };

function normalizeNbText(v: any): string {
    if (v == null) return "";
    if (Array.isArray(v)) return (v as any[]).map(normalizeNbText).join("");
    return String(v);
}

function truncateText(s: string, maxChars: number): string {
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars) + `\n...[truncated ${s.length - maxChars} chars]`;
}

async function readTextCapped(file: File, opts?: { maxBytes?: number; maxChars?: number }): Promise<string> {
    const maxBytes = opts?.maxBytes ?? 512 * 1024; // 512KB
    const maxChars = opts?.maxChars ?? 120_000;

    const blob = file.size > maxBytes ? file.slice(0, maxBytes) : file;
    let text = await blob.text();

    if (file.size > maxBytes) {
        text += `\n...[truncated ${file.size - maxBytes} bytes]`;
    }

    return truncateText(text, maxChars);
}

function ipynbToCompactText(nb: any, opts?: { maxChars?: number; maxOutputCharsPerCell?: number }): string {
    const maxChars = opts?.maxChars ?? 80_000;
    const maxOutputCharsPerCell = opts?.maxOutputCharsPerCell ?? 4_000;

    if (!nb || !Array.isArray(nb.cells)) return truncateText(JSON.stringify(nb ?? {}), maxChars);

    const parts: string[] = [];

    let i = 0;
    for (const cell of nb.cells) {
        i++;
        const cellType = String(cell?.cell_type ?? "unknown");
        const source = normalizeNbText(cell?.source);

        if (cellType === "markdown") {
            if (source.trim()) {
                parts.push(`\n## Cell ${i} (markdown)\n`);
                parts.push(source);
                parts.push("\n");
            }
        } else if (cellType === "code") {
            parts.push(`\n## Cell ${i} (code)\n`);
            parts.push("```");
            parts.push("\n");
            parts.push(source);
            if (!source.endsWith("\n")) parts.push("\n");
            parts.push("```\n");

            // keep only text/plain (already stripped), but still cap it
            if (Array.isArray(cell?.outputs) && cell.outputs.length) {
                const outParts: string[] = [];
                for (const out of cell.outputs) {
                    const data = out?.data || out?.["data"];
                    if (data && typeof data === "object" && data["text/plain"]) {
                        outParts.push(normalizeNbText(data["text/plain"]));
                    } else if (out?.text) {
                        outParts.push(normalizeNbText(out.text));
                    }
                }

                const outText = outParts.join("\n").trim();
                if (outText) {
                    parts.push("\nOutput:\n");
                    parts.push(truncateText(outText, maxOutputCharsPerCell));
                    parts.push("\n");
                }
            }
        } else {
            // raw/unknown: include minimal source if present
            if (source.trim()) {
                parts.push(`\n## Cell ${i} (${cellType})\n`);
                parts.push(source);
                parts.push("\n");
            }
        }

        // stop early if we already hit the cap
        if (parts.reduce((n, p) => n + p.length, 0) > maxChars) break;
    }

    return truncateText(parts.join(""), maxChars);
}

function extractNotebookImagesAndStrip(nb: any): { notebook: any; images: NotebookImage[] } {
    if (!nb || !Array.isArray(nb.cells)) {
        return { notebook: nb, images: [] };
    }

    const images: NotebookImage[] = [];
    let idx = 1;

    const clone = structuredClone ? structuredClone(nb) : JSON.parse(JSON.stringify(nb));

    for (const cell of clone.cells) {
        // Outputs (code cells)
        if (Array.isArray(cell.outputs)) {
            const filteredOutputs: any[] = [];

            for (const out of cell.outputs) {
                const data = out.data || out["data"];

                if (data && typeof data === "object") {
                    // Extract images and replace with references
                    for (const mime of ["image/png", "image/jpeg"]) {
                        const raw = data[mime];
                        if (!raw) continue;

                        const asString = Array.isArray(raw) ? (raw as string[]).join("") : String(raw);
                        const id = `IMAGE_${idx++}`;
                        images.push({ id, mime, base64: asString });

                        data[mime] = [`[${id}]`];
                    }

                    // Keep only text/plain in data
                    for (const key of Object.keys(data)) {
                        if (key !== "text/plain") {
                            delete data[key];
                        }
                    }
                }

                const hasTextPlain = !!(data && typeof data === "object" && data["text/plain"]);
                const hasTextField =
                    typeof out.text === "string" ||
                    (Array.isArray(out.text) && out.text.length > 0);

                if (hasTextPlain || hasTextField) {
                    filteredOutputs.push(out);
                }
            }

            cell.outputs = filteredOutputs;
        }

        // Attachments (markdown cells)
        if (cell.attachments && typeof cell.attachments === "object") {
            for (const key of Object.keys(cell.attachments)) {
                const att = cell.attachments[key];
                if (!att || typeof att !== "object") continue;

                for (const mime of ["image/png", "image/jpeg"]) {
                    const b64 = att[mime];
                    if (!b64) continue;

                    const asString = Array.isArray(b64) ? (b64 as string[]).join("") : String(b64);
                    const id = `IMAGE_${idx++}`;
                    images.push({ id, mime, base64: asString });

                    att[mime] = [`[${id}]`];
                }
            }
        }
    }

    return { notebook: clone, images };
}

export async function docLingFileParse(fileData: filePendingUpload, ext: fileExtension): Promise<{ content: string, images: { name: string; content: string }[] }> {
    const formData = new FormData();

    formData.append("file", fileData.file);
    formData.append("from_formats", JSON.stringify([ext]));

    const response = await fetch(API_BASE_URL + "/api/docling/convert/file", {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        throw new Error("Conversion failed");
    }

    const result = await response.json();

    console.log(result);

    return result as {
        content: string;
        images: { name: string; content: string }[];
    };
}

type PromptSet = {
    text: string;
    image: string;
    data: string;
    code: string;
};

type PreparedLlmPayload = {
    prompt: string;
    userText: string;
};

export type llmArtifactData = {
    role: string;
    entity: string;
    title: string;
    description: string;
};

function tryParseJson<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (fenced?.[1]) {
            try {
                return JSON.parse(fenced[1]) as T;
            } catch {
                // no-op
            }
        }

        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1)) as T;
            } catch {
                // no-op
            }
        }
    }

    return null;
}

async function buildFilePromptRequest(
    file: filePendingUpload,
    assetsMetadata: fileRecord[],
    promptSet: PromptSet
): Promise<PreparedLlmPayload> {
    let { name, ext, previewText } = file;

    let content = previewText;
    let imagesPayload: { id: string; dataUrl: string }[] | undefined;

    let prompt = promptSet.text;

    if (file.ext == "jpeg" || file.ext == "png" || file.ext == "jpg") {
        const compressed = await resizeAndCompressImageToJpeg(file.file, { maxLongSide: 1536, quality: 0.78 });
        // downloadDebugImage(compressed.file);
        content = await readAsDataURL(compressed.file);
        ext = compressed.ext;
        name = compressed.file.name;
        prompt = promptSet.image;
    }

    if (file.ext == "pdf" || file.ext == "docx") {
        const { content: markdown } = await docLingFileParse(file, ext);
        content = markdown;
        prompt = promptSet.text;
    }

    if (file.ext == "csv" || file.ext == "json") {
        content = await readTextCapped(file.file, { maxBytes: 512 * 1024, maxChars: 120_000 });
        prompt = promptSet.data;
    }

    if (file.ext == "ipynb") {
        try {
            const raw = content ?? await file.file.text();
            const nb = JSON.parse(raw!);
            const { notebook, images } = extractNotebookImagesAndStrip(nb);
            content = ipynbToCompactText(notebook, { maxChars: 80_000, maxOutputCharsPerCell: 4_000 });

            if (images.length) {
                const MAX_IMAGES = 0; // Images temporarily deactivated
                const payload: { id: string; dataUrl: string }[] = [];

                let i = 0;
                for (const img of images.slice(0, MAX_IMAGES)) {
                    const filename = `${name}-nb-image-${++i}.${img.mime === "image/png" ? "png" : "jpg"}`;
                    const fileFromBase64 = base64ToFile(img.base64, img.mime, filename);
                    const compressed = await resizeAndCompressImageToJpeg(fileFromBase64, { maxLongSide: 1024, quality: 0.72 });
                    // downloadDebugImage(compressed.file);
                    const dataUrl = await readAsDataURL(compressed.file);
                    payload.push({ id: img.id, dataUrl });
                }

                if (images.length > MAX_IMAGES) {
                    content += `\n\n[Note: omitted ${images.length - MAX_IMAGES} additional images to fit context limits.]`;
                }

                imagesPayload = payload;
            }
        } catch (e) {
            console.warn("Failed to parse/extract images from ipynb; falling back to raw text", e);
        }

        prompt = promptSet.code;
    }

    if (file.ext == "py" || file.ext == "js" || file.ext == "ts" || file.ext == "css" || file.ext == "html") {
        prompt = promptSet.code;
    }

    const serializedAssets = assetsMetadata.map((asset) => ({
        id: asset.id,
        name: asset.name,
        ext: asset.ext,
    }));

    const userPayload = imagesPayload
        ? { name, ext, content, images: imagesPayload, assets: serializedAssets }
        : { name, ext, content, assets: serializedAssets };

    return {
        prompt,
        userText: JSON.stringify(userPayload),
    };
}

function normalizeLlmCardsResponse(payload: {
    cards?: Array<Record<string, unknown>>;
    connections?: llmConnectionData[];
} | null): { cards: llmCardData[]; connections: llmConnectionData[] } {
    if (!payload) return { cards: [], connections: [] };

    const cards = Array.isArray(payload.cards)
        ? payload.cards.map((card, index) => {
            const referenceValue =
                typeof card.reference === "string"
                    ? card.reference
                    : typeof card.referenceCitation === "string"
                        ? card.referenceCitation
                        : typeof card.ReferenceCitation === "string"
                            ? card.ReferenceCitation
                            : undefined;

            return {
                id: Number(card.id) || index + 1,
                entity: String(card.entity ?? ""),
                title: String(card.title ?? ""),
                description: typeof card.description === "string" ? card.description : undefined,
                reference: referenceValue,
            };
        })
        : [];

    return {
        cards,
        connections: Array.isArray(payload.connections) ? payload.connections : [],
    };
}

export async function requestCardsLLM(
    file: filePendingUpload,
    assetsMetadata: fileRecord[] = []
): Promise<{ cards: llmCardData[], connections: llmConnectionData[] }> {
    const { prompt, userText } = await buildFilePromptRequest(file, assetsMetadata, {
        text: "CardsFromText",
        image: "CardsFromImage",
        data: "CardsFromData",
        code: "CardsFromCode",
    });

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText, prompt }),
    });

    if (!response.ok) {
        alert("Request failed");
        return {
            cards: [],
            connections: []
        }
    }

    const data = await response.json();
    const parsedData = tryParseJson<{ cards?: Array<Record<string, unknown>>; connections?: llmConnectionData[] }>(data.output);
    if (!parsedData) {
        alert("Request failed");
        return {
            cards: [],
            connections: []
        };
    }

    return normalizeLlmCardsResponse(parsedData);
}

export async function requestArtifactLLM(
    file: filePendingUpload,
    assetsMetadata: fileRecord[] = []
): Promise<llmArtifactData | null> {
    const { prompt, userText } = await buildFilePromptRequest(file, assetsMetadata, {
        text: "ArtifactFromText",
        image: "ArtifactFromImage",
        data: "ArtifactFromData",
        code: "ArtifactFromCode",
    });

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText, prompt }),
    });

    if (!response.ok) {
        alert("Request failed");
        return null;
    }

    const data = await response.json();
    return tryParseJson<llmArtifactData>(data.output);
}

export async function requestCardsLLMTextInput(userText: string): Promise<{ cards: llmCardData[], connections: llmConnectionData[] }> {

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: userText, prompt: "CardsFromTextInput" }),
    });

    if (!response.ok) {
        alert("Request failed");
        return {
            cards: [],
            connections: []
        }
    }

    const data = await response.json();

    try {
        const parsedData = JSON.parse(data.output) as { cards?: Array<Record<string, unknown>>; connections?: llmConnectionData[] };
        return normalizeLlmCardsResponse(parsedData);
    } catch {
        alert("Request failed");
    }

    return {
        cards: [],
        connections: []
    }
}

function computeHorizontalTreeLayout(
    llmCards: llmCardData[],
    llmConnections: llmConnectionData[],
    anchor: { x: number; y: number }
): Record<number, { x: number; y: number }> {
    const H_SPACING = 560;
    const V_SPACING = 300;

    const cardIds = new Set<number>(llmCards.map((c) => c.id));
    const order = new Map<number, number>(llmCards.map((c, i) => [c.id, i]));

    const adjacency = new Map<number, number[]>();
    const indegree = new Map<number, number>();

    for (const card of llmCards) {
        adjacency.set(card.id, []);
        indegree.set(card.id, 0);
    }

    for (const conn of llmConnections) {
        if (!cardIds.has(conn.source) || !cardIds.has(conn.target)) continue;
        adjacency.get(conn.source)!.push(conn.target);
        indegree.set(conn.target, (indegree.get(conn.target) ?? 0) + 1);
    }

    for (const [id, children] of adjacency.entries()) {
        children.sort((a, b) => (order.get(a)! - order.get(b)!));
        adjacency.set(id, children);
    }

    const activityRoots = llmCards
        .filter((c) => c.entity.toLowerCase() === "activity")
        .map((c) => c.id);

    const roots = activityRoots.length > 0
        ? activityRoots
        : llmCards
            .filter((c) => (indegree.get(c.id) ?? 0) === 0)
            .map((c) => c.id);

    const depth = new Map<number, number>();
    const queue: number[] = [];

    for (const rootId of roots) {
        depth.set(rootId, 0);
        queue.push(rootId);
    }

    while (queue.length > 0) {
        const current = queue.shift()!;
        const currentDepth = depth.get(current) ?? 0;
        for (const child of adjacency.get(current) ?? []) {
            const nextDepth = currentDepth + 1;
            const previousDepth = depth.get(child);
            if (previousDepth == null || nextDepth < previousDepth) {
                depth.set(child, nextDepth);
                queue.push(child);
            }
        }
    }

    // Place disconnected non-activity components to the right of activity roots.
    const disconnectedRoots = llmCards
        .filter((c) => !depth.has(c.id) && (indegree.get(c.id) ?? 0) === 0)
        .map((c) => c.id);

    const disconnectedQueue: number[] = [];
    const disconnectedRootDepth = activityRoots.length > 0 ? 1 : 0;
    for (const rootId of disconnectedRoots) {
        depth.set(rootId, disconnectedRootDepth);
        disconnectedQueue.push(rootId);
    }

    while (disconnectedQueue.length > 0) {
        const current = disconnectedQueue.shift()!;
        const currentDepth = depth.get(current) ?? disconnectedRootDepth;
        for (const child of adjacency.get(current) ?? []) {
            const nextDepth = currentDepth + 1;
            const previousDepth = depth.get(child);
            if (previousDepth == null || nextDepth < previousDepth) {
                depth.set(child, nextDepth);
                disconnectedQueue.push(child);
            }
        }
    }

    for (const card of llmCards) {
        if (!depth.has(card.id)) depth.set(card.id, activityRoots.length > 0 ? 1 : 0);
    }

    const levelToIds = new Map<number, number[]>();
    for (const card of llmCards) {
        const d = depth.get(card.id)!;
        if (!levelToIds.has(d)) levelToIds.set(d, []);
        levelToIds.get(d)!.push(card.id);
    }

    for (const ids of levelToIds.values()) {
        ids.sort((a, b) => (order.get(a)! - order.get(b)!));
    }

    const positions: Record<number, { x: number; y: number }> = {};
    const levels = Array.from(levelToIds.keys()).sort((a, b) => a - b);

    for (const level of levels) {
        const ids = levelToIds.get(level) ?? [];
        const startY = anchor.y - ((ids.length - 1) * V_SPACING) / 2;

        for (let i = 0; i < ids.length; i++) {
            positions[ids[i]] = {
                x: anchor.x + level * H_SPACING,
                y: startY + i * V_SPACING,
            };
        }
    }

    return positions;
}

// export function getHighestId(nodes: nodeType[]): number {
//     let highestId = 0;

//     try{
//         for(const node of nodes){
//             let id = parseInt(node.id.replaceAll('n', ''));
//             if(id > highestId)
//                 highestId = id;
//         }

//         return highestId;
//     } catch (err) {
//         throw new Error("Could not parse node id.");
//     }
// }

export function llmCardsToNodes(
    llmCards: llmCardData[],
    offset?: { x: number, y: number },
    metadata?: { createdAt?: string; origin?: string }
): { nodes: nodeType[], idMap: { [old: string]: string } } {
    const anchor = offset ?? { x: 0, y: 0 };

    let positionX = anchor.x;
    const positionY = anchor.y;

    let resultingNodes: nodeType[] = [];

    let idMapping: { [old: string]: string } = {};

    for (const card of llmCards) {
        const normalizedEntity = String(card.entity ?? "").trim().toLowerCase() === "task"
            ? "requirement"
            : String(card.entity ?? "").trim().toLowerCase();

        let cardType = 'social';

        switch (normalizedEntity) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break
        }

        let newId = crypto.randomUUID();

        resultingNodes.push({
            id: newId,
            position: {
                x: positionX,
                y: positionY
            },
            type: 'card',
            data: {
                label: normalizedEntity,
                type: cardType as cardType,
                title: card.title,
                description: card.description,
                reference: typeof card.reference === "string" ? card.reference : "",
                autoGenerated: true,
                relevant: true,
                createdAt: metadata?.createdAt,
                origin: metadata?.origin
            }
        });

        positionX += 300;

        idMapping[card.id] = newId;
    }

    return { nodes: resultingNodes, idMap: idMapping };
}

export function llmConnectionsToEdges(
    llmConnections: llmConnectionData[],
    idMap: { [old: string]: string },
    llmCards: llmCardData[] = []
): edgeType[] {
    let resultingEdges: edgeType[] = []
    const entityByLegacyId = new Map<string, string>(
        llmCards.map((card) => {
            const normalized = String(card.entity ?? "").trim().toLowerCase() === "task"
                ? "requirement"
                : String(card.entity ?? "").trim().toLowerCase();
            return [String(card.id), normalized];
        })
    );

    try {
        for (const connection of llmConnections) {
            const from = entityByLegacyId.get(String(connection.source)) ?? "";
            const to = entityByLegacyId.get(String(connection.target)) ?? "";
            resultingEdges.push({
                id: crypto.randomUUID(),
                source: idMap[connection.source],
                target: idMap[connection.target],
                type: "relation",
                data: { from, to },
            });
        }
    } catch (err) {
        console.log("Edge generation failed for some connections in: " + llmConnections)
    }

    return resultingEdges;
}

type GoalMilestonesContext = {
    projectName: string;
    goal: string;
    expectedStart: string;
    expectedEnd: string;
    availableRoles: string[];
    participants: Array<{ name: string; role: string }>;
    stages: Array<{ name: string; start: string; end: string }>;
    existingMilestones: Array<{ name: string; occurredAt: string }>;
};

type MilestonesInterpolationContext = {
    projectName: string;
    goal: string;
    expectedStart: string;
    expectedEnd: string;
    availableRoles: string[];
    participants: Array<{ name: string; role: string }>;
    stages: Array<{ name: string; start: string; end: string }>;
    existingMilestones: Array<{ id: string; name: string; occurredAt: string }>;
};

function toIsoOrFallback(value: unknown, fallbackIso: string): string {
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return fallbackIso;
}

function normalizeMilestonesOutput(rawOutput: string, fallbackIso: string): DesignStudyEvent[] {
    const parsedData = JSON.parse(rawOutput) as { milestones?: unknown };
    const rawMilestones = Array.isArray(parsedData.milestones) ? parsedData.milestones : [];

    const normalized: DesignStudyEvent[] = [];
    for (const milestone of rawMilestones) {
        if (!milestone || typeof milestone !== "object") continue;
        const item = milestone as Record<string, unknown>;
        const name = String(item.name ?? "").trim();
        if (!name) continue;

        normalized.push({
            id: crypto.randomUUID(),
            name,
            occurredAt: toIsoOrFallback(item.occurredAt, fallbackIso),
            generatedBy: "llm",
        });
    }

    return normalized;
}

async function requestMilestonesByPrompt(prompt: string, payload: unknown, fallbackIso: string): Promise<DesignStudyEvent[]> {
    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            input: JSON.stringify(payload),
            prompt,
        }),
    });

    if (!response.ok) {
        return [];
    }

    const data = await response.json();
    try {
        return normalizeMilestonesOutput(String(data.output ?? ""), fallbackIso);
    } catch {
        return [];
    }
}

export async function requestMilestonesLLM(context: MilestonesInterpolationContext): Promise<DesignStudyEvent[]> {
    const fallbackIso = context.existingMilestones[0]?.occurredAt
        ? toIsoOrFallback(context.existingMilestones[0].occurredAt, new Date().toISOString())
        : new Date().toISOString();

    return requestMilestonesByPrompt("Milestones", context, fallbackIso);
}

export async function requestGoalMilestonesLLM(context: GoalMilestonesContext): Promise<DesignStudyEvent[]> {
    const fallbackIso = toIsoOrFallback(context.expectedStart, new Date().toISOString());
    return requestMilestonesByPrompt("GoalMilestones", context, fallbackIso);
}
