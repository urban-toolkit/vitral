import type {
    QuerySystemComponentsResult,
    QuerySystemPapersResult,
    SystemPaper,
} from "@/api/stateApi";

/**
 * The four drags blueprint content takes part in, each with its own MIME type.
 *
 * They are separate types rather than one payload with a discriminator because the *drop targets*
 * differ, and a drop target decides whether to accept a drag by looking at `dataTransfer.types`
 * before it can read anything. The tray takes a whole paper, a handful of components, or a blank
 * one; the canvas takes only the attach gesture. One shared type would mean every target accepting
 * every drag and then refusing it after the fact, which is exactly the silent refusal contract 24
 * exists to stop.
 */

/** A whole system paper, dragged from search results into the tray. */
export const BLUEPRINT_DRAG_MIME = "application/x-vitral-blueprint";
/** One or more components without their paper, dragged from search results into the tray. */
export const BLUEPRINT_COMPONENTS_DRAG_MIME = "application/x-vitral-blueprint-components";
/** A component already in the tray, dragged onto a requirement card on the canvas. */
export const BLUEPRINT_ATTACH_MIME = "application/x-vitral-blueprint-attach";
/**
 * A component of the researcher's own, dragged off the tray's Component button onto the spot in the
 * tray it should occupy. It carries no payload — the drop position *is* the whole message — so the
 * only thing a target reads is the presence of this type.
 */
export const BLUEPRINT_NEW_COMPONENT_MIME = "application/x-vitral-blueprint-new-component";

export type BlueprintDragPayload = {
    fileName: string;
    paperTitle: string;
    year: number;
    paper: SystemPaper;
};

export type BlueprintComponentsDragPayload = {
    components: QuerySystemComponentsResult[];
};

export type BlueprintAttachPayload = {
    /** The tray node's own id. The component already exists; attaching only adds an edge. */
    nodeId: string;
    title: string;
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

export function buildBlueprintComponentsDragPayload(
    components: QuerySystemComponentsResult[],
): BlueprintComponentsDragPayload {
    return { components };
}

export function parseBlueprintComponentsDragPayload(
    raw: string,
): BlueprintComponentsDragPayload | null {
    try {
        const parsed = JSON.parse(raw) as Partial<BlueprintComponentsDragPayload>;
        if (!parsed || typeof parsed !== "object") return null;
        if (!Array.isArray(parsed.components) || parsed.components.length === 0) return null;
        for (const component of parsed.components) {
            if (!component || typeof component !== "object") return null;
            if (typeof component.fileName !== "string") return null;
            if (!component.granularBlock || typeof component.granularBlock !== "object") return null;
        }
        return parsed as BlueprintComponentsDragPayload;
    } catch {
        return null;
    }
}

export function buildBlueprintAttachPayload(nodeId: string, title: string): BlueprintAttachPayload {
    return { nodeId, title };
}

export function parseBlueprintAttachPayload(raw: string): BlueprintAttachPayload | null {
    try {
        const parsed = JSON.parse(raw) as Partial<BlueprintAttachPayload>;
        if (!parsed || typeof parsed !== "object") return null;
        if (typeof parsed.nodeId !== "string" || parsed.nodeId.trim() === "") return null;
        return { nodeId: parsed.nodeId, title: typeof parsed.title === "string" ? parsed.title : "" };
    } catch {
        return null;
    }
}
