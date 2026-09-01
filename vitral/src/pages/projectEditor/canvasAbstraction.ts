import type { edgeType, nodeType } from "@/config/types";
import type { ActivityCluster } from "@/pages/projectEditor/canvasClusters";
import { compareBySalience, isPromotable } from "@/pages/projectEditor/canvasSalience";
import {
    connectionKindFromEdge,
    isEdgeActive,
    nodeLabelOf,
    type ConnectionKind,
} from "@/pages/projectEditor/graphSemantics";
import { relationLabelFor } from "@/utils/relationships";
import { isModelDerivedEdgeData } from "@/utils/edgeProvenance";

/**
 * Focus + context lens over the card graph.
 *
 * Three levels of abstraction, applied *after* every existing filter so a glyph always describes
 * what is actually on screen:
 *
 * - **1 Overview** — one glyph per derived phase, plus that phase's major requirements and concepts
 *   promoted out as real cards. Blueprint structure is hidden.
 * - **2 Threads** — one glyph per activity, plus each activity's major decisions and insight turns
 *   promoted out. The threads between activities survive as collapsed, weighted edges.
 * - **3 Detail** — the bare graph, untouched.
 *
 * Focus overrides the level for one branch at a time: opening a phase renders its activities at
 * level 2 while the rest of the canvas stays at level 1, and opening one of those activities renders
 * its cards at level 3 while its siblings stay glyphs. That nesting is the whole of
 * `effectiveLevelForActivity` — there is no separate state machine.
 *
 * Everything here is pure and derived from data already in the store. No LLM, no embeddings, no
 * network: the semantic signal is the `referenced_by` / `iteration_of` edges, which were thresholded
 * cosine similarity frozen into the graph when the cards were created.
 */

export type CanvasLevel = 1 | 2 | 3;

export type CanvasFocusPath = {
    /** A phase opened out into its activities. */
    clusterId: string | null;
    /** An activity opened out into its cards. */
    activityId: string | null;
};

export const NO_CANVAS_FOCUS: CanvasFocusPath = { clusterId: null, activityId: null };

/** Ids the lens invents. Real ids are UUIDs, so this can never collide with one. */
export const SYNTHETIC_ID_PREFIX = "vz:";

export function isSyntheticCanvasId(id: unknown): boolean {
    return typeof id === "string" && id.startsWith(SYNTHETIC_ID_PREFIX);
}

const PHASE_GLYPH_SIZE = { width: 360, height: 300 };
const ACTIVITY_GLYPH_SIZE = { width: 240, height: 210 };

/** How many cards a glyph gives up to the canvas rather than swallowing. */
export const PHASE_PROMOTED_PER_LABEL = 2;
export const ACTIVITY_PROMOTED_MAX = 3;

/** Below this a collapsed band of loose cards saves nothing and costs a glyph. */
const UNASSIGNED_GLYPH_MIN = 3;

const BLUEPRINT_LABELS = new Set(["blueprint", "blueprint_group", "blueprint_component"]);

/**
 * People are context, not content.
 *
 * A `person` card says *who was there*, which is true of the whole phase or activity rather than of
 * any one thing inside it. Treated as an ordinary card it distorts every summary at once: it wins
 * promotions on degree (everyone is attached to their activity), it lends the glyph its accent
 * colour and icon when it happens to be the commonest label, and it fills the body list with names
 * where the reader is looking for what the work was about. So it is stripped out of the label
 * counts, out of the promotion pool and out of the body, and collected into one `participants`
 * footnote instead — which is what a name actually answers.
 *
 * This rule, and the promotion rule below it, are **exported** because the deterministic report asks
 * the same questions of the same graph. A document has no zoom, so it never calls
 * `buildAbstractedGraph` — its glyph counts describe the folded remainder and would undercount every
 * phase — but it must promote exactly what Overview and Threads promote, or the two would disagree
 * about what the study is organised around. One copy of the rule, two readers of it.
 */
export const PERSON_LABEL = "person";

export function isPerson(node: nodeType): boolean {
    return nodeLabelOf(node) === PERSON_LABEL;
}

/** Distinct participant names among the cards a glyph swallowed, in a stable order. */
export function collectParticipants(nodes: nodeType[]): string[] {
    const names = new Set<string>();
    for (const node of nodes) {
        if (!isPerson(node)) continue;
        const name = titleOf(node);
        if (name !== "") names.add(name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

const KIND_PRIORITY: Record<ConnectionKind, number> = {
    iteration_of: 3,
    referenced_by: 2,
    regular: 1,
};

const KIND_LABEL: Record<ConnectionKind, string> = {
    iteration_of: "iteration of",
    referenced_by: "referenced by",
    regular: "related to",
};

export type CanvasGlyphKind = "phase" | "activity" | "unassigned";

/** Everything `ClusterGlyph` needs to draw itself, precomputed here so the component stays dumb. */
export type CanvasGlyphData = {
    kind: CanvasGlyphKind;
    /** What `focusPath` should be set to when this glyph is opened. */
    focusClusterId: string | null;
    focusActivityId: string | null;
    label: string;
    cardCount: number;
    activityCount: number;
    /** Card label -> how many of them this glyph stands for. Drives the composition strip. */
    labelCounts: Array<{ label: string; count: number }>;
    /** Verbatim titles of the strongest members, for the glyph body and its tooltip. */
    topTitles: string[];
    /** Names of the `person` cards this glyph stands for. Drawn as the footnote, never in the body. */
    participants: string[];
    startAt: string | null;
    endAt: string | null;
};

export type AbstractedGraph = {
    nodes: nodeType[];
    edges: edgeType[];
};

function dataOf(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function titleOf(node: nodeType): string {
    return String(dataOf(node).title ?? "").trim();
}

/**
 * Which level a given activity's branch renders at. Focus raises one branch above the base level;
 * nesting falls out of the two checks being ordered deepest-first.
 */
function effectiveLevelForActivity(
    activityId: string,
    level: CanvasLevel,
    focus: CanvasFocusPath,
    clusterOfActivity: Map<string, string>,
): CanvasLevel {
    if (focus.activityId === activityId) return 3;
    const clusterId = clusterOfActivity.get(activityId);
    if (focus.clusterId !== null && clusterId === focus.clusterId) return 2;
    return level;
}

export function countLabels(nodes: nodeType[]): Array<{ label: string; count: number }> {
    const counts = new Map<string, number>();
    for (const node of nodes) {
        const label = nodeLabelOf(node);
        if (label === "" || label === PERSON_LABEL) continue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([label, count]) => ({ label, count }))
        // Descending count, then alphabetical, so the strip does not reshuffle between renders.
        .sort((a, b) => (b.count !== a.count ? b.count - a.count : a.label.localeCompare(b.label)));
}

/** The strongest cards of the given labels, best first. People are never candidates. */
export function pickTop(
    candidates: nodeType[],
    score: Map<string, number>,
    labels: Set<string> | null,
    limit: number,
): nodeType[] {
    return candidates
        .filter((node) => (
            isPromotable(node)
            && !isPerson(node)
            && (labels === null || labels.has(nodeLabelOf(node)))
        ))
        .sort((a, b) => compareBySalience(a, b, score))
        .slice(0, limit);
}

/**
 * Rewrites every edge onto whatever now represents its endpoints, drops the ones that collapsed
 * into a single glyph, and merges the rest into one weighted edge per pair.
 *
 * An edge whose endpoints both survived untouched is passed through **by reference**, so a focused
 * branch renders with exactly the edge objects it renders with today.
 */
export function collapseEdges(
    edges: edgeType[],
    representativeOf: Map<string, string>,
    emittedIds: Set<string>,
): edgeType[] {
    type Bucket = {
        source: string;
        target: string;
        weight: number;
        kind: ConnectionKind;
        first: edgeType;
        rewritten: boolean;
        /** Whether *every* edge merged here was made by a model. See the badge note below. */
        allModelDerived: boolean;
    };

    const buckets = new Map<string, Bucket>();

    for (const edge of edges) {
        if (!isEdgeActive(edge)) continue;

        const source = representativeOf.get(edge.source) ?? edge.source;
        const target = representativeOf.get(edge.target) ?? edge.target;
        // Both ends fell into the same glyph: the relation is now internal to it.
        if (source === target) continue;
        if (!emittedIds.has(source) || !emittedIds.has(target)) continue;

        const key = source < target ? `${source}|${target}` : `${target}|${source}`;
        const kind = connectionKindFromEdge(edge);
        const existing = buckets.get(key);

        if (!existing) {
            buckets.set(key, {
                source,
                target,
                weight: 1,
                kind,
                first: edge,
                rewritten: source !== edge.source || target !== edge.target,
                allModelDerived: isModelDerivedEdgeData(edge.data),
            });
            continue;
        }

        existing.weight += 1;
        existing.rewritten = true;
        // `every`, not `some`: one drawn edge in the bundle and the "AI" badge would be claiming
        // authorship of a relation a person asserted.
        existing.allModelDerived = existing.allModelDerived && isModelDerivedEdgeData(edge.data);
        // Priority, not majority: twenty ordinary tree edges must not bury the one iteration edge
        // that is the entire reason the thread is worth looking at.
        if (KIND_PRIORITY[kind] > KIND_PRIORITY[existing.kind]) existing.kind = kind;
    }

    return Array.from(buckets.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, bucket]) => {
            if (bucket.weight === 1 && !bucket.rewritten) return bucket.first;

            const label = bucket.weight === 1
                ? (typeof bucket.first.data?.label === "string" ? bucket.first.data.label : KIND_LABEL[bucket.kind])
                : KIND_LABEL[bucket.kind];

            return {
                ...bucket.first,
                id: `vz:e:${key}`,
                source: bucket.source,
                target: bucket.target,
                type: "relation",
                label,
                data: {
                    ...(bucket.first.data && typeof bucket.first.data === "object" ? bucket.first.data : {}),
                    label,
                    kind: bucket.kind,
                    weight: bucket.weight,
                    collapsed: true,
                    // Stated for the bundle rather than inherited from whichever edge happened to
                    // land in it first, and both markers are settled here so the spread above
                    // cannot leave a stale one behind: the per-edge similarity scores that come
                    // with `autoLinked` describe one relation and mean nothing for a merge of many.
                    autoGenerated: bucket.allModelDerived,
                    autoLinked: false,
                },
            } as edgeType;
        });
}

function glyphNode(
    id: string,
    base: nodeType | null,
    glyph: CanvasGlyphData,
    size: { width: number; height: number },
    createdAt: string | null,
): nodeType {
    // `label: "activity"` is what puts a glyph on the layout's time axis, and the explicit size is
    // what `nodeSizeOf` reads to space it. Nothing in the layout needs to know about glyphs.
    //
    // The size is declared three ways on purpose: `style` for the DOM, and top-level `width` /
    // `height` because React Flow reads only those when deciding whether a node has dimensions yet,
    // and keeps it `visibility: hidden` — with its edges unrendered — until it does.
    const baseData = base ? dataOf(base) : {};
    const glyphNodeValue = {
        ...(base ?? { id, position: { x: 0, y: 0 } }),
        id,
        type: "clusterGlyph",
        position: base?.position ?? { x: 0, y: 0 },
        width: size.width,
        height: size.height,
        // And `measured`, so React Flow's internals carry the size from the first frame. A glyph is a
        // fresh object every time the lens rebuilds, and an internal node's `measured` is taken from
        // its user node alone — so without this the glyph spends a frame unmeasured and the edges
        // that reach it fall back to handle geometry.
        measured: { ...size },
        style: { ...(base?.style ?? {}), ...size },
        data: {
            ...baseData,
            label: "activity",
            type: "social",
            title: glyph.label,
            createdAt: createdAt ?? baseData.createdAt,
            canvasGlyph: glyph,
        },
    } as nodeType;

    /**
     * A stale `zIndex` must not ride in on the activity this glyph was built from.
     *
     * Contract 16 strips one, but only from `type === "card"` — and by the time the layout runs, this
     * node is a `clusterGlyph`, so the strip never fires for it. Projects saved by earlier versions
     * carry values like 2000 and 3000 on their activity cards, and React Flow feeds `node.zIndex`
     * straight into the wrapper's inline `z-index`: the glyph then paints over everything, including
     * the cards of an opened branch beside it and any overlay the canvas draws on purpose. A glyph is
     * a node the lens invented this frame; a stacking order recorded years ago is not about it.
     */
    delete (glyphNodeValue as { zIndex?: number }).zIndex;
    return glyphNodeValue;
}

function promotionEdge(sourceId: string, target: nodeType): edgeType {
    const targetLabel = nodeLabelOf(target);
    const label = relationLabelFor("activity", targetLabel) ?? "related to";
    return {
        id: `vz:e:promote:${sourceId}:${target.id}`,
        source: sourceId,
        target: target.id,
        type: "relation",
        label,
        data: { label, from: "activity", to: targetLabel, kind: "regular" },
    } as edgeType;
}

export function buildAbstractedGraph(params: {
    nodes: nodeType[];
    edges: edgeType[];
    level: CanvasLevel;
    focus: CanvasFocusPath;
    /** node id -> owning activity id, from `buildActivityTreeMembership`. */
    membership: Map<string, string>;
    clusters: ActivityCluster[];
    score: Map<string, number>;
}): AbstractedGraph {
    const { nodes, edges, level, focus, membership, clusters, score } = params;

    // The feature is inert until asked for. Same array references, so the layout memo below sees
    // exactly what it sees today and React Flow reconciles nothing.
    if (level === 3) {
        return { nodes, edges };
    }

    const clusterOfActivity = new Map<string, string>();
    for (const cluster of clusters) {
        for (const activityId of cluster.memberActivityIds) {
            clusterOfActivity.set(activityId, cluster.id);
        }
    }

    const satellitesByActivity = new Map<string, nodeType[]>();
    const activityById = new Map<string, nodeType>();
    const unassigned: nodeType[] = [];
    const structural: nodeType[] = [];

    for (const node of nodes) {
        const label = nodeLabelOf(node);
        if (BLUEPRINT_LABELS.has(label)) {
            structural.push(node);
            continue;
        }
        if (label === "activity") {
            activityById.set(node.id, node);
            continue;
        }
        const owner = membership.get(node.id);
        if (owner === undefined || !membership.has(owner)) {
            unassigned.push(node);
            continue;
        }
        const bucket = satellitesByActivity.get(owner);
        if (bucket) bucket.push(node);
        else satellitesByActivity.set(owner, [node]);
    }

    const emitted: nodeType[] = [];
    const extraEdges: edgeType[] = [];
    const representativeOf = new Map<string, string>();

    const representAll = (members: nodeType[], glyphId: string) => {
        for (const member of members) representativeOf.set(member.id, glyphId);
    };

    const membersOfActivity = (activityId: string): nodeType[] => {
        const activity = activityById.get(activityId);
        const satellites = satellitesByActivity.get(activityId) ?? [];
        return activity ? [activity, ...satellites] : satellites;
    };

    /** Level 2: the activity itself becomes the glyph, keeping its real id so L2 to L3 is in place. */
    const emitActivityGlyph = (activityId: string) => {
        const activity = activityById.get(activityId);
        if (!activity) return;

        const satellites = satellitesByActivity.get(activityId) ?? [];
        // Major decisions and insight turns get to stay on the canvas; the rest fold into the glyph.
        const promoted = pickTop(satellites, score, new Set(["insight", "requirement"]), ACTIVITY_PROMOTED_MAX);
        const promotedIds = new Set(promoted.map((node) => node.id));
        const folded = satellites.filter((node) => !promotedIds.has(node.id));

        emitted.push(glyphNode(
            activity.id,
            activity,
            {
                kind: "activity",
                focusClusterId: clusterOfActivity.get(activityId) ?? null,
                focusActivityId: activityId,
                label: titleOf(activity) || "Untitled activity",
                cardCount: folded.length,
                activityCount: 1,
                labelCounts: countLabels(folded),
                topTitles: pickTop(folded, score, null, 3).map(titleOf).filter((value) => value !== ""),
                participants: collectParticipants(folded),
                startAt: typeof dataOf(activity).createdAt === "string" ? String(dataOf(activity).createdAt) : null,
                endAt: null,
            },
            ACTIVITY_GLYPH_SIZE,
            null,
        ));

        representAll(folded, activity.id);
        for (const node of promoted) emitted.push(node);
    };

    /** Level 3: the branch renders exactly as it does today. */
    const emitActivityDetail = (activityId: string) => {
        for (const member of membersOfActivity(activityId)) emitted.push(member);
    };

    for (const cluster of clusters) {
        const levels = cluster.memberActivityIds.map((activityId) => (
            effectiveLevelForActivity(activityId, level, focus, clusterOfActivity)
        ));

        // A phase only stays a phase while every activity in it is still abstract.
        if (levels.every((value) => value === 1)) {
            const members = cluster.memberActivityIds.flatMap(membersOfActivity);
            const satellites = members.filter((node) => nodeLabelOf(node) !== "activity");

            // The overview's job: the phase's major requirements and its major domain concepts.
            const promoted = [
                ...pickTop(satellites, score, new Set(["requirement"]), PHASE_PROMOTED_PER_LABEL),
                ...pickTop(satellites, score, new Set(["concept"]), PHASE_PROMOTED_PER_LABEL),
            ];
            const promotedIds = new Set(promoted.map((node) => node.id));
            const folded = members.filter((node) => !promotedIds.has(node.id));

            const glyph = glyphNode(
                cluster.id,
                null,
                {
                    kind: "phase",
                    focusClusterId: cluster.id,
                    focusActivityId: null,
                    label: cluster.label,
                    cardCount: folded.filter((node) => nodeLabelOf(node) !== "activity").length,
                    activityCount: cluster.memberActivityIds.length,
                    labelCounts: countLabels(folded),
                    topTitles: pickTop(folded, score, null, 3).map(titleOf).filter((value) => value !== ""),
                    participants: collectParticipants(folded),
                    startAt: cluster.startAt,
                    endAt: cluster.endAt,
                },
                PHASE_GLYPH_SIZE,
                cluster.anchorCreatedAt,
            );

            emitted.push(glyph);
            representAll(folded, cluster.id);
            for (const node of promoted) {
                emitted.push(node);
                // The card's own edge to its activity gets rewritten onto this glyph by
                // `collapseEdges`, which usually connects the two already. The synthetic edge is
                // only for a promoted card that had no such edge to inherit, and the pass below
                // drops it whenever the real one showed up.
                extraEdges.push(promotionEdge(cluster.id, node));
            }
            continue;
        }

        for (let index = 0; index < cluster.memberActivityIds.length; index += 1) {
            const activityId = cluster.memberActivityIds[index];
            if (levels[index] === 3) emitActivityDetail(activityId);
            else emitActivityGlyph(activityId);
        }
    }

    // Activities the clusterer never saw (it only sees what the filters left behind).
    for (const activityId of activityById.keys()) {
        if (clusterOfActivity.has(activityId)) continue;
        const activityLevel = effectiveLevelForActivity(activityId, level, focus, clusterOfActivity);
        if (activityLevel === 3) emitActivityDetail(activityId);
        else emitActivityGlyph(activityId);
    }

    // Loose cards belong to no activity, so no glyph claims them. At Overview they would drown the
    // phases, so they get one glyph of their own — collapsed, but never silently dropped.
    if (level === 1 && unassigned.length >= UNASSIGNED_GLYPH_MIN) {
        const glyphId = "vz:c:unassigned";
        emitted.push(glyphNode(
            glyphId,
            null,
            {
                kind: "unassigned",
                focusClusterId: null,
                focusActivityId: null,
                label: "Unconnected cards",
                cardCount: unassigned.length,
                activityCount: 0,
                labelCounts: countLabels(unassigned),
                topTitles: pickTop(unassigned, score, null, 3).map(titleOf).filter((value) => value !== ""),
                participants: collectParticipants(unassigned),
                startAt: null,
                endAt: null,
            },
            ACTIVITY_GLYPH_SIZE,
            null,
        ));
        representAll(unassigned, glyphId);
    } else {
        for (const node of unassigned) emitted.push(node);
    }

    // Blueprint structure is the system, not the narrative: out of the way at Overview, back at
    // Threads. The sidebar toggle still decides whether it is in `nodes` at all.
    if (level !== 1) {
        for (const node of structural) emitted.push(node);
    }

    const emittedIds = new Set(emitted.map((node) => node.id));
    const collapsed = collapseEdges(edges, representativeOf, emittedIds);

    // Never two edges for the same pair: a promoted card that kept its real relation to the glyph
    // would otherwise be drawn twice, once collapsed and once synthetic.
    const collapsedPairs = new Set(collapsed.map((edge) => (
        edge.source < edge.target ? `${edge.source}|${edge.target}` : `${edge.target}|${edge.source}`
    )));
    const survivingExtras = extraEdges.filter((edge) => {
        const key = edge.source < edge.target
            ? `${edge.source}|${edge.target}`
            : `${edge.target}|${edge.source}`;
        return !collapsedPairs.has(key);
    });

    // Keeps the emitted order stable against the input order.
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    emitted.sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
        || a.id.localeCompare(b.id));

    return { nodes: emitted, edges: [...collapsed, ...survivingExtras] };
}

/**
 * Zoom to level.
 *
 * **The boundaries are symmetric: there is no hysteresis.** There used to be a multiplicative dead
 * band here, on the theory that hovering a threshold would flip the canvas back and forth. In use
 * it does the opposite of reassure: the band is 1.35x wide either way, so the level changed at
 * 0.556 zooming out and only came back at 1.013 zooming in, and the threshold read as if it moved
 * on its own. A gesture that crosses a boundary and comes straight back now lands exactly where it
 * started. Oscillation is not a real risk — `handleViewportMove` early-returns unless the band
 * actually changed, and nothing in the level change writes the viewport (see the `fitView` note in
 * contract 19), so a crossing cannot feed itself.
 *
 * These sit high on purpose: reaching Threads and then Overview should take a short zoom-out from a
 * fitted view, not a long one. Together with the card level of detail in `canvasLod.ts` the full
 * ladder, zoom descending, is:
 *
 *   0.850  Detail <-> Threads
 *   0.550  cards drop to title only
 *   0.420  Threads <-> Overview
 *   0.180  cards become plain boxes
 *
 * The two ladders no longer interleave: with follow-zoom on, **every** card detail boundary is
 * below the Detail boundary, so a card is never simplified in place — zooming out replaces it with
 * a glyph while it is still fully drawn, and the abstraction is the only simplification on that
 * path. The card tiers still matter with follow-zoom off, which is the mode where the user pins
 * Detail and zooms out over the bare graph; that is what they are tuned for. Retuning either set
 * means re-checking this ordering.
 *
 * `minZoom` in `FlowCanvas.tsx` has to stay below 0.420 or Overview is unreachable.
 */
export const ZOOM_OVERVIEW_MAX = 0.42;
export const ZOOM_THREADS_MAX = 0.85;

export function levelForZoom(zoom: number, current: CanvasLevel): CanvasLevel {
    if (!Number.isFinite(zoom) || zoom <= 0) return current;

    if (zoom <= ZOOM_OVERVIEW_MAX) return 1;
    if (zoom <= ZOOM_THREADS_MAX) return 2;
    return 3;
}
