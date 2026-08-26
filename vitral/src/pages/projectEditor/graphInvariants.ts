import type { edgeType, nodeType } from "@/config/types";
import {
    isEdgeActive,
    isNodeActive,
    nodeLabelOf,
    normalizeArtifactEntity,
} from "@/pages/projectEditor/graphSemantics";

/**
 * A card on the canvas has to be *about* something already there.
 *
 * The one exception is an activity: an activity is where a study starts, so it is the only card
 * that means anything standing on its own — and the only card the tools create out of empty canvas.
 * Everything else (`person`, `requirement`, `concept`, `insight`, `object`) is a claim about an
 * activity or about another card, and one floating loose says nothing the reader can place. The
 * orbit layout has always shown that by exiling unreachable cards to the "unassigned" band; this
 * module is the same judgement made a rule instead of a punishment.
 *
 * Blueprint nodes are deliberately outside it. `blueprint_component` cannot legally connect to an
 * activity at all (`utils/relationships.ts`), and `blueprint` / `blueprint_group` have no entries
 * in the relation table whatsoever — a connection requirement they could never satisfy. They are
 * excluded by node *type*, which is what they actually differ by, so no label list is needed.
 */
export const CONNECTION_EXEMPT_CARD_LABELS: ReadonlySet<string> = new Set(["activity"]);

/**
 * The label a card is treated as, closed to the ontology.
 *
 * `normalizeArtifactEntity` rather than a `KNOWN_CARD_LABELS` membership test, because the
 * extraction path stores the model's own entity string verbatim on the node (`LLMRequest.ts`) and
 * clamps it only when building the *edge*. A card labelled `finding` therefore exists, is drawn as
 * an `object` like any other unrecognised label, and would slip past a set test — inheriting
 * neither this rule nor a spawn box. Reading it the way the card is drawn closes that.
 */
export function cardLabelOf(node: nodeType): string {
    return normalizeArtifactEntity(nodeLabelOf(node));
}

/** Whether `node` is a live card that must keep at least one active edge. */
export function requiresConnection(node: nodeType): boolean {
    if (node.type !== "card") return false;
    if (!isNodeActive(node)) return false;
    return !CONNECTION_EXEMPT_CARD_LABELS.has(cardLabelOf(node));
}

function titleOf(node: nodeType): string {
    const title = String((node.data as Record<string, unknown> | undefined)?.title ?? "").trim();
    return title || "Untitled";
}

/**
 * A self-edge is not a connection.
 *
 * It is reachable — React Flow will let a card's source handle be dragged onto its own target
 * handle, and every self pair in the relation table (`object|object` and friends) accepts it — and
 * counting it would break the rule in both directions at once: the card would look connected while
 * reaching nothing, and the loop itself would become undeletable, because removing it takes the
 * card's "last" edge.
 */
function isSelfEdge(edge: edgeType): boolean {
    return edge.source === edge.target;
}

export type BlockedEdgeRemoval = {
    edgeId: string;
    /** The card the removal would have left with nothing attached. */
    nodeId: string;
    title: string;
    label: string;
};

export type EdgeRemovalPlan = {
    removable: string[];
    blocked: BlockedEdgeRemoval[];
};

export type EdgeRemovalOptions = {
    /**
     * Nodes going away in the same gesture. Their edges are leaving with them, which is a card
     * being deleted rather than a card being cut loose — a different action with a different
     * expectation, and not one this rule speaks to. Those cards stop counting as connectable and
     * the edges reaching them stop being judged.
     */
    deletingNodeIds?: ReadonlySet<string>;
};

/**
 * Splits a batch of edge deletions into the ones that may go through and the ones that would strand
 * a card.
 *
 * Decided **one candidate at a time against the ones already approved**, not each against the graph
 * as it stands now. A card's last two edges can be selected together and arrive as one batch, and
 * checked independently both would see a degree of two and both would pass — leaving the card with
 * none. Approving them in order means the second one sees the first already gone. It also keeps the
 * useful case working: three of a card's four edges still delete, and only the fourth is refused.
 *
 * A card that is *already* unconnected — imported that way, or created before this rule existed —
 * is never made worse by this: only the step from one edge to none is blocked.
 */
export function planEdgeRemovals(
    nodes: readonly nodeType[],
    edges: readonly edgeType[],
    candidateEdgeIds: readonly string[],
    options: EdgeRemovalOptions = {},
): EdgeRemovalPlan {
    const deletingNodeIds = options.deletingNodeIds ?? new Set<string>();
    const guardedById = new Map<string, nodeType>();
    const liveNodeIds = new Set<string>();
    for (const node of nodes) {
        if (!isNodeActive(node)) continue;
        if (deletingNodeIds.has(node.id)) continue;
        liveNodeIds.add(node.id);
        if (requiresConnection(node)) guardedById.set(node.id, node);
    }

    /** The endpoints of `edge` whose connectedness its removal actually changes. */
    const guardedEndpointsOf = (edge: edgeType): string[] => {
        if (isSelfEdge(edge)) return [];
        // An edge whose far end has been deleted is not something the card can be read through, so
        // it does not count as the connection that keeps the card alive.
        if (!liveNodeIds.has(edge.source) || !liveNodeIds.has(edge.target)) return [];
        return [edge.source, edge.target].filter((endpoint) => guardedById.has(endpoint));
    };

    const edgeById = new Map<string, edgeType>();
    const degreeByNodeId = new Map<string, number>();
    for (const edge of edges) {
        edgeById.set(edge.id, edge);
        if (!isEdgeActive(edge)) continue;
        for (const endpoint of guardedEndpointsOf(edge)) {
            degreeByNodeId.set(endpoint, (degreeByNodeId.get(endpoint) ?? 0) + 1);
        }
    }

    const removable: string[] = [];
    const blocked: BlockedEdgeRemoval[] = [];

    for (const edgeId of candidateEdgeIds) {
        const edge = edgeById.get(edgeId);
        // An unknown or already soft-deleted edge changes no degree; let it through so the caller's
        // own idempotence check stays the thing that decides what to do with it.
        if (!edge || !isEdgeActive(edge)) {
            removable.push(edgeId);
            continue;
        }

        const counted = guardedEndpointsOf(edge);
        const stranded = counted.find((endpoint) => (degreeByNodeId.get(endpoint) ?? 0) <= 1);
        if (stranded !== undefined) {
            const node = guardedById.get(stranded)!;
            blocked.push({
                edgeId,
                nodeId: stranded,
                title: titleOf(node),
                label: cardLabelOf(node),
            });
            continue;
        }

        for (const endpoint of counted) {
            degreeByNodeId.set(endpoint, (degreeByNodeId.get(endpoint) ?? 0) - 1);
        }
        removable.push(edgeId);
    }

    return { removable, blocked };
}

/**
 * `insight` and `object` need "an", the other four need "a". A vowel test rather than a list,
 * because the ontology is expected to grow and a missing entry would read as a typo to the user.
 */
export function withArticle(label: string): string {
    const normalized = label.trim().toLowerCase();
    return `${"aeiou".includes(normalized[0] ?? "") ? "an" : "a"} ${normalized}`;
}

/** One sentence for the notice bar, naming the card that would have been left loose. */
export function describeBlockedRemovals(blocked: readonly BlockedEdgeRemoval[]): string {
    if (blocked.length === 0) return "";

    const uniqueTitles: string[] = [];
    const seen = new Set<string>();
    for (const entry of blocked) {
        if (seen.has(entry.nodeId)) continue;
        seen.add(entry.nodeId);
        uniqueTitles.push(`“${entry.title}”`);
    }

    const [first, second] = uniqueTitles;
    const subject = uniqueTitles.length === 1
        ? `${first} would be`
        : uniqueTitles.length === 2
            ? `${first} and ${second} would be`
            : `${first}, ${second} and others would be`;

    return `${subject} left with no connection. Only activity cards can stand on their own —`
        + " connect the card somewhere else first, or delete the card itself.";
}
