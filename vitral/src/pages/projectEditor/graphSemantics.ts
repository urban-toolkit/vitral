import type { edgeType, nodeType } from "@/config/types";

/**
 * Shared vocabulary for reading the card graph.
 *
 * These three rules were previously written out three times — privately in `ProjectEditorPage`,
 * again inside `RelationEdge`, and a third time in the layout — which meant a card labelled `task`
 * or an edge carrying only a legacy label could be classified differently depending on which
 * consumer asked. They live here so every reader agrees.
 */

export const REFERENCED_BY_EDGE_LABEL = "referenced by";
export const ITERATION_OF_EDGE_LABEL = "iteration of";

export type ConnectionKind = "regular" | "referenced_by" | "iteration_of";

/** `task` is a legacy alias for `requirement`; everything else is lowercased as-is. */
export function normalizeNodeLabel(label: string): string {
    const normalized = label.trim().toLowerCase();
    if (normalized === "task") return "requirement";
    return normalized;
}

export function nodeLabelOf(node: nodeType): string {
    return normalizeNodeLabel(String((node.data as Record<string, unknown> | undefined)?.label ?? ""));
}

export function edgeLabelFrom(edge: edgeType): string {
    if (typeof edge.label === "string" && edge.label.trim() !== "") {
        return edge.label.trim().toLowerCase();
    }
    if (typeof edge.data?.label === "string" && edge.data.label.trim() !== "") {
        return edge.data.label.trim().toLowerCase();
    }
    return "";
}

/**
 * `data.kind` is authoritative, but edges created before it existed carry the classification only
 * in their label, so both are read.
 */
export function connectionKindFromEdge(edge: edgeType): ConnectionKind {
    const rawKind = typeof edge.data?.kind === "string"
        ? edge.data.kind.toLowerCase().trim()
        : "";
    if (rawKind === "referenced_by") return "referenced_by";
    if (rawKind === "iteration_of") return "iteration_of";
    const label = edgeLabelFrom(edge);
    if (label === REFERENCED_BY_EDGE_LABEL) return "referenced_by";
    if (label === ITERATION_OF_EDGE_LABEL) return "iteration_of";
    return "regular";
}

/** Soft-deleted edges stay in the store to preserve history, but are not part of the live graph. */
export function isEdgeActive(edge: edgeType): boolean {
    const deletedAt = (edge.data as Record<string, unknown> | undefined)?.deletedAt;
    if (typeof deletedAt !== "string" || deletedAt.trim() === "") return true;
    return Number.isNaN(new Date(deletedAt).getTime());
}
