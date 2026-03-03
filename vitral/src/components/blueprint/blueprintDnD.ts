import type { QuerySystemPapersResult, SystemPaper } from "@/api/stateApi";

export const BLUEPRINT_DRAG_MIME = "application/x-vitral-blueprint";

export type BlueprintDragPayload = {
    fileName: string;
    paperTitle: string;
    year: number;
    paper: SystemPaper;
};

export function buildBlueprintDragPayload(result: QuerySystemPapersResult): BlueprintDragPayload {
    return {
        fileName: result.fileName,
        paperTitle: result.paperTitle,
        year: result.year,
        paper: result.paper,
    };
}

export function parseBlueprintDragPayload(raw: string): BlueprintDragPayload | null {
    try {
        const parsed = JSON.parse(raw) as Partial<BlueprintDragPayload>;
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.fileName !== "string") return null;
        if (typeof parsed.paperTitle !== "string") return null;
        if (typeof parsed.year !== "number") return null;
        if (!parsed.paper || typeof parsed.paper !== "object") return null;
        return parsed as BlueprintDragPayload;
    } catch {
        return null;
    }
}

