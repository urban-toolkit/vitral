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

/** The six card labels the extraction ontology defines. `blueprint_*` are structure, not cards. */
export const KNOWN_CARD_LABELS: ReadonlySet<string> = new Set([
    "person", "activity", "requirement", "concept", "insight", "object",
]);

/**
 * Constrain a label to the ontology. Unlike `normalizeNodeLabel` this closes the set: anything
 * unrecognised becomes `object`, which is what a model's invented entity type has to collapse to
 * before it reaches the canvas.
 */
export function normalizeArtifactEntity(entity: string | undefined): string {
    const normalized = String(entity ?? "").trim().toLowerCase();
    if (normalized === "task") return "requirement";
    if (KNOWN_CARD_LABELS.has(normalized)) return normalized;
    return "object";
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

/**
 * Card labels that never take an automatic `referenced by` / `iteration of` edge, at either end.
 *
 * A `person` card is a name, and a name embeds into whatever the surrounding text is about — so two
 * people who took part in the same kind of session look "similar" for reasons that have nothing to
 * do with either of them, and one participant who appears in every study becomes a hub that
 * hijacks salience (contract 21: an automatic edge is not clutter, it changes which cards get
 * promoted and what a phase is called). People are context, not content: the only edge a person
 * gets is the one to the activity they took part in, which is created explicitly, not inferred.
 */
export const AUTO_LINK_EXCLUDED_LABELS: ReadonlySet<string> = new Set(["person"]);

export function canAutoLink(label: string): boolean {
    return !AUTO_LINK_EXCLUDED_LABELS.has(normalizeNodeLabel(label));
}

/** Soft-deleted edges stay in the store to preserve history, but are not part of the live graph. */
export function isEdgeActive(edge: edgeType): boolean {
    const deletedAt = (edge.data as Record<string, unknown> | undefined)?.deletedAt;
    if (typeof deletedAt !== "string" || deletedAt.trim() === "") return true;
    return Number.isNaN(new Date(deletedAt).getTime());
}
