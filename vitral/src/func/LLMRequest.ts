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

export async function requestCardsLLM(
    file: filePendingUpload,
    assetsMetadata: fileRecord[] = []
): Promise<{ cards: llmCardData[], connections: llmConnectionData[] }> {

    let { name, ext, previewText } = file;

    let content = previewText;
    let imagesPayload: { id: string; dataUrl: string }[] | undefined;

    let prompt = "CardsFromText";

    if (file.ext == "jpeg" || file.ext == "png" || file.ext == "jpg") {
        const compressed = await resizeAndCompressImageToJpeg(file.file, { maxLongSide: 1536, quality: 0.78 });
        // downloadDebugImage(compressed.file);
        content = await readAsDataURL(compressed.file);
        ext = compressed.ext;
        name = compressed.file.name;
        prompt = "CardsFromImage";
    }

    if(file.ext == "pdf" || file.ext == "docx") {
        const { content: markdown } = await docLingFileParse(file, ext);
        content = markdown;
        prompt = "CardsFromText";
    }

    if (file.ext == "csv" || file.ext == "json") {
        content = await readTextCapped(file.file, { maxBytes: 512 * 1024, maxChars: 120_000 });
        prompt = "CardsFromData";
    }

    if (file.ext == "ipynb") {
        try {
            const raw = content ?? await file.file.text();
            const nb = JSON.parse(raw!);
            const { notebook, images } = extractNotebookImagesAndStrip(nb);
            content = ipynbToCompactText(notebook, { maxChars: 80_000, maxOutputCharsPerCell: 4_000 });

            if (images.length) {
                const MAX_IMAGES = 0; //Images temporarily deactivated
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

        prompt = "CardsFromCode";
    }

    if(file.ext == "py" || file.ext == "js" || file.ext == "ts" || file.ext == "css" ){
        prompt = "CardsFromCode";
    }

    const serializedAssets = assetsMetadata.map((asset) => ({
        id: asset.id,
        name: asset.name,
        ext: asset.ext
    }));

    const userPayload = imagesPayload
        ? { name, ext, content, images: imagesPayload, assets: serializedAssets }
        : { name, ext, content, assets: serializedAssets };

    const userText = JSON.stringify(userPayload);

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

    try {
        const parsedData = JSON.parse(data.output);

        return parsedData;
    } catch {
        alert("Request failed");
    }

    return {
        cards: [],
        connections: []
    }
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
        const parsedData = JSON.parse(data.output);

        return parsedData;
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
    llmConnections?: llmConnectionData[]
): { nodes: nodeType[], idMap: { [old: string]: string } } {
    // let id = getHighestId(nodes) + 1;

    const anchor = offset ?? { x: 0, y: 0 };
    const hasConnections = Array.isArray(llmConnections) && llmConnections.length > 0;
    const treePositions = hasConnections
        ? computeHorizontalTreeLayout(llmCards, llmConnections, anchor)
        : undefined;

    let positionX = anchor.x;
    const positionY = anchor.y;

    let resultingNodes: nodeType[] = [];

    let idMapping: { [old: string]: string } = {};

    for (const card of llmCards) {

        let cardType = 'social';

        switch (card.entity) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break
        }

        let newId = crypto.randomUUID();
        const positioned = treePositions?.[card.id];

        resultingNodes.push({
            id: newId,
            position: {
                x: positioned?.x ?? positionX,
                y: positioned?.y ?? positionY
            },
            type: 'card',
            data: {
                label: card.entity,
                type: cardType as cardType,
                title: card.title,
                description: card.description
            }
        });

        if (!hasConnections) {
            positionX += 300;
        }
        idMapping[card.id] = newId;
    }

    return { nodes: resultingNodes, idMap: idMapping };
}

export function llmConnectionsToEdges(llmConnections: llmConnectionData[], idMap: { [old: string]: string }): edgeType[] {
    let resultingEdges: edgeType[] = []

    try {
        for (const connection of llmConnections) {
            resultingEdges.push({
                id: crypto.randomUUID(),
                source: idMap[connection.source],
                target: idMap[connection.target]
            });
        }
    } catch (err) {
        console.log("Edge generation failed for some connections in: " + llmConnections)
    }

    return resultingEdges;
}

export async function requestMilestonesLLM(milestones: DesignStudyEvent[]): Promise<DesignStudyEvent[]> {
    const contentMilestones = JSON.stringify(milestones);

    const response = await fetch(API_BASE_URL + "/api/llm/chat", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: contentMilestones, prompt: "Milestones" }),
    });

    if (!response.ok) {
        alert("Request failed");
        return []
    }

    const data = await response.json();

    try {
        const parsedData = JSON.parse(data.output);

        let milestones: DesignStudyEvent[] = parsedData.milestones;

        milestones = milestones.map((milestone) => {
            return {
                ...milestone,
                id: crypto.randomUUID()
            }
        });

        return milestones;
    } catch {
        alert("Request failed");
    }

    return [];
}
