import type { edgeType, nodeType } from "@/config/types";
import {
    isEdgeActive,
    isNodeActive,
    normalizeNodeLabel,
} from "@/pages/projectEditor/graphSemantics";

/**
 * Which of the two surfaces a blueprint node belongs to.
 *
 * The tray is the system as the researcher is designing it: every blueprint node, groups and
 * components alike, arranged and wired however they like. The canvas is the study, and the only
 * blueprint claim it makes is "this component is the answer to that requirement" — which is a dated
 * research act, already carried by the `tackled in` edge and already minting a timeline
 * `BlueprintEvent`.
 *
 * So the canvas shows exactly the components holding such an edge, and nothing else of the
 * blueprint. Not because unattached structure is uninteresting, but because it has no place on a
 * time axis: `activityOrbitLayout` had to exile the whole block to a band 460px below the graph,
 * which is what made it read as dislocated. An attached component has a place — beside the
 * requirement it answers — and inherits that requirement's position in time.
 *
 * One graph, two readings. The nodes stay in `flow.nodes` where playback history, soft delete,
 * provenance, embeddings and export already know how to find them; nothing is mirrored, so there is
 * nothing to keep in sync.
 */

/** Every node that belongs to the blueprint structure, hidden or shown as one filter. */
export const BLUEPRINT_NODE_LABELS: ReadonlySet<string> = new Set([
    "blueprint",
    "blueprint_group",
    "blueprint_component",
]);

/** The relation a component carries to the requirement it answers. Mirrors `utils/relationships.ts`. */
export const TACKLED_IN_EDGE_LABEL = "tackled in";
/** The relation between two components. Tray-only: it describes the system, not the study. */
export const FEEDS_INTO_EDGE_LABEL = "feeds into";

export function nodeLabel(node: nodeType): string {
    return normalizeNodeLabel(String((node.data as Record<string, unknown> | undefined)?.label ?? ""));
}

export function isBlueprintNode(node: nodeType): boolean {
    return BLUEPRINT_NODE_LABELS.has(nodeLabel(node));
}

export function isBlueprintComponent(node: nodeType): boolean {
    return nodeLabel(node) === "blueprint_component";
}

export function isBlueprintGroup(node: nodeType): boolean {
    const label = nodeLabel(node);
    return label === "blueprint_group" || label === "blueprint";
}

/**
 * The same array back when a filter kept everything, so the memos downstream can compare by
 * reference. `Array.prototype.filter` always allocates, which meant the derivation chain was handed
 * a brand-new array on every pass even when nothing was filtered out.
 *
 * Lives here rather than in `ProjectEditorPage` because this module is the one that filters hardest
 * and a second copy of it would be a second chance to get the guarantee wrong.
 */
export function keepAll<T>(source: readonly T[], kept: T[]): T[] {
    return kept.length === source.length ? (source as T[]) : kept;
}

/**
 * Components holding an active `tackled in` edge to a live requirement **present in `nodes`**.
 *
 * The "present in `nodes`" part is what makes playback work without a second mechanism: pass the
 * playback-scoped node set and a component whose requirement the needle has hidden is not attached
 * as far as the canvas is concerned, so it hides with it instead of stranding beside nothing.
 *
 * The pair is read in both directions because `relationPairKey` sorts, so nothing guarantees which
 * end of a `tackled in` edge the component sits on.
 */
export function attachedComponentIds(
    nodes: readonly nodeType[],
    edges: readonly edgeType[],
): ReadonlySet<string> {
    const labelById = new Map<string, string>();
    for (const node of nodes) {
        if (!isNodeActive(node)) continue;
        labelById.set(node.id, nodeLabel(node));
    }

    const attached = new Set<string>();
    for (const edge of edges) {
        if (!isEdgeActive(edge)) continue;
        const sourceLabel = labelById.get(edge.source);
        const targetLabel = labelById.get(edge.target);
        if (sourceLabel === undefined || targetLabel === undefined) continue;

        if (sourceLabel === "blueprint_component" && targetLabel === "requirement") {
            attached.add(edge.source);
        }
        if (targetLabel === "blueprint_component" && sourceLabel === "requirement") {
            attached.add(edge.target);
        }
    }

    return attached;
}

/**
 * An attached component as the canvas needs it: out of the box it was raised in.
 *
 * Three things have to go, and each of them is load-bearing:
 *
 * - **`parentId` / `extent`.** They point at the intermediate box, which is tray-only. React Flow
 *   cannot place a node whose parent it cannot find, so the component would be dropped rather than
 *   drawn beside its requirement.
 * - **`position`.** It is measured from a parent that is no longer there. `activityOrbitLayout`
 *   overwrites it, so this only stops it being a lie in between.
 * - **`zIndex`.** It carries the nesting depth it was created at (`3`, under paper/high/intermediate),
 *   and that ordering stopped being real the moment the boxes were left behind. The layout strips a
 *   stale `zIndex` only from `type === "card"` nodes (contract 16), so nothing downstream would
 *   catch it — and React Flow feeds it straight to the wrapper's `z-index`, which would paint the
 *   component over every card around it.
 *
 * The result is cached against the source object rather than rebuilt per pass. React Flow keeps a
 * node's cached internals only while the node object is identical, so a fresh clone on every
 * derivation would re-render the component and every edge touching it. A `WeakMap` is the right
 * shape: the key is the node object the store handed us, and it holds nothing alive.
 */
const detachedForCanvas = new WeakMap<nodeType, nodeType>();

function detachComponent(node: nodeType): nodeType {
    if (node.parentId === undefined && node.extent === undefined && node.zIndex === undefined) {
        return node;
    }

    const cached = detachedForCanvas.get(node);
    if (cached) return cached;

    const detached: nodeType = { ...node, position: { x: 0, y: 0 } };
    delete detached.parentId;
    delete detached.extent;
    delete detached.zIndex;
    detachedForCanvas.set(node, detached);
    return detached;
}

/**
 * The canvas's node set: everything that is not blueprint structure, plus the attached components.
 */
export function canvasBlueprintNodes(
    nodes: readonly nodeType[],
    edges: readonly edgeType[],
): nodeType[] {
    let hasBlueprint = false;
    for (const node of nodes) {
        if (isBlueprintNode(node)) {
            hasBlueprint = true;
            break;
        }
    }
    // Nothing blueprint-shaped in the document at all: hand the input straight back, so a project
    // that never opened the tray pays nothing for it.
    if (!hasBlueprint) return nodes as nodeType[];

    const attached = attachedComponentIds(nodes, edges);
    const kept: nodeType[] = [];
    // `keepAll` compares lengths, and that is not enough here: this filter can also *replace* a node
    // with its detached twin without removing anything. A document whose group boxes have all been
    // dissolved and whose every component is attached would come out the same length, and handing
    // the input back would quietly discard the detaching — putting a stale `zIndex` from the box it
    // used to sit in onto the canvas, where it paints over the cards.
    let changed = false;
    for (const node of nodes) {
        if (!isBlueprintNode(node)) {
            kept.push(node);
            continue;
        }
        if (!isBlueprintComponent(node) || !attached.has(node.id)) {
            changed = true;
            continue;
        }

        const detached = detachComponent(node);
        if (detached !== node) changed = true;
        kept.push(detached);
    }

    return changed ? kept : (nodes as nodeType[]);
}

/**
 * The canvas's edge set: everything except `feeds into`.
 *
 * Needed as its own step because the edge filter downstream keeps any edge whose two endpoints are
 * both visible, and two components attached to two different requirements are both visible — so the
 * wiring between them would arrive on the canvas on its own. It belongs to the tray: it says how the
 * system is put together, which is not a claim about either requirement.
 */
export function canvasBlueprintEdges(
    nodes: readonly nodeType[],
    edges: readonly edgeType[],
): edgeType[] {
    const componentIds = new Set<string>();
    for (const node of nodes) {
        if (isBlueprintComponent(node)) componentIds.add(node.id);
    }
    if (componentIds.size === 0) return edges as edgeType[];

    const kept = (edges as edgeType[]).filter((edge) => (
        !(componentIds.has(edge.source) && componentIds.has(edge.target))
    ));
    return keepAll(edges, kept);
}
