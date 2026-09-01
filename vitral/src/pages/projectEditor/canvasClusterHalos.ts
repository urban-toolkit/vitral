import type { edgeType, nodeType } from "@/config/types";
import type { CanvasGlyphData } from "@/pages/projectEditor/canvasAbstraction";
import { nodeSizeOf, resolveAbsoluteNodePositions } from "@/pages/projectEditor/canvasGeometry";
import { isEdgeActive, nodeLabelOf } from "@/pages/projectEditor/graphSemantics";
import { toTimestampMs } from "@/pages/projectEditor/nodeHistory";

/**
 * A soft disc drawn around each phase or thread, with the cluster's name written across it, for when
 * the canvas is zoomed too far out to read anything else.
 *
 * ## Why the glyph is not enough
 *
 * Overview and Threads already replace a group of cards with one summary glyph, and the glyph carries
 * the group's title. But a glyph is a *card-sized* object — 360x300 at its largest — and its title is
 * set in 16px. At the zoom where Overview takes over (0.42) that title renders at under 7px, and the
 * whole reason the reader zoomed out was to see the shape of the study rather than to read a card. So
 * the level that exists to answer "what is this project made of" stops being able to say it at exactly
 * the zoom that asks.
 *
 * ## The disc scales; the title does not
 *
 * A title sized in flow units keeps a fixed fraction of the halo, which sounds right and is exactly
 * wrong: its *screen* size is then `fraction x halo-screen-diameter`, so zooming out shrinks it in
 * step with everything else and it is least readable at precisely the zoom somebody reached for it.
 * So the type holds a constant screen size instead, through the `--canvas-zoom` custom property
 * `useCanvasLod` writes from the pan/zoom frame (see the cost note there).
 *
 * What this module contributes is the **ceiling**: `maxFontSizePx`, a fraction of the halo's own
 * radius, past which three lines of title would burst the circle they label. A large phase never hits
 * it; a one-activity thread hangs off it, and its label is small because the thing it names is small,
 * which is the honest outcome.
 *
 * ## Membership has to be the layout's answer, not a plausible one
 *
 * The walk below is `assignSatellitesToActivities` from `activityOrbitLayout.ts`, reproduced: the same
 * seeds, the same chronological seed order, the same sorted neighbour lists, the same refusal to cross
 * a `blueprint_component` -> `blueprint_component` edge. That is not fussiness — a halo is drawn around
 * where the *layout* put things, so any disagreement shows up as a ring that fails to contain its own
 * cards or swallows somebody else's.
 *
 * Two of those rules are load-bearing and neither is guessable:
 *
 * - **Every activity-labelled node is a seed, not only the ones that get a halo.** A focused branch
 *   renders as real cards with no glyph of its own, and its activity card is often joined to a
 *   neighbouring phase's glyph by a single collapsed cross-tree edge. Seed only the glyphs and that
 *   one edge hands the whole opened branch to a halo on the other side of the canvas, which then
 *   balloons across everything in between. Seeding every hub stops the walk at the branch's own
 *   activity — which is what the layout does, and why the branch sits where it does.
 * - **The tie-break is the seed order.** Two hubs equidistant from a card have to resolve the same way
 *   here and in the layout, or a card is sized into one halo and drawn inside another.
 *
 * It is deliberately *not* `buildActivityTreeMembership`, which drops `blueprint_component` on purpose
 * because it decides what the timeline needle hides as a unit. A halo decides nothing and only has to
 * contain what is drawn; excluding components would leave boxes outside a ring claiming to enclose
 * them.
 *
 * Pure, and free of React, Redux and any clock — same contract as `canvasGeometry`.
 */

/** Slack between the outermost card in a cluster and the ring, so the ring never grazes a corner. */
const HALO_PADDING_PX = 130;

/**
 * Largest the title may be, as a fraction of the halo radius.
 *
 * Sized against the worst case the CSS allows: three lines at 1.1 line-height plus the kind chip is
 * about 3.7em, and the label is capped at 68% of the diameter (the inscribed square, near enough), so
 * `3.7 x ratio x r <= 0.68 x 2r` gives a ceiling around 0.37. A third of that headroom is kept back
 * for the descenders and the gap, which lands on 0.28.
 */
const HALO_LABEL_MAX_RATIO = 0.28;

export type ClusterHaloTarget = {
    /** The glyph's node id. One halo per glyph, so it serves as identity. */
    key: string;
    kind: CanvasGlyphData["kind"];
    title: string;
    center: { x: number; y: number };
    radius: number;
    /**
     * Ceiling for the title, in flow units. The live size is `min(constant-on-screen, this)`, resolved
     * in CSS — see the docblock above.
     */
    maxFontSizePx: number;
};

function glyphOf(node: nodeType): CanvasGlyphData | null {
    if (node.type !== "clusterGlyph") return null;
    const glyph = (node.data as Record<string, unknown> | undefined)?.canvasGlyph;
    return glyph && typeof glyph === "object" ? glyph as CanvasGlyphData : null;
}

function createdAtMsOf(node: nodeType): number | null {
    return toTimestampMs((node.data as Record<string, unknown> | undefined)?.createdAt);
}

/**
 * One halo per phase or thread glyph on the canvas.
 *
 * `nodes` and `edges` must be the **displayed** ones — after the filters, after the abstraction lens
 * and after the layout — because a halo describes what is on screen and nothing else. At Detail there
 * are no glyphs, so this returns nothing and the overlay never mounts.
 *
 * The "Unconnected cards" glyph gets no halo: it is a band of leftovers rather than a phase or a
 * thread, it has no title worth reading at that size, and circling it would suggest a grouping the
 * study does not claim. It still seeds the walk, so nothing it stands for is claimed by a real one.
 */
export function buildClusterHalos(nodes: nodeType[], edges: edgeType[]): ClusterHaloTarget[] {
    const drawn: Array<{ node: nodeType; glyph: CanvasGlyphData }> = [];
    for (const node of nodes) {
        const glyph = glyphOf(node);
        if (glyph === null || glyph.kind === "unassigned") continue;
        drawn.push({ node, glyph });
    }
    if (drawn.length === 0) return [];

    // --- Seeds: every hub the layout uses, in the order the layout seeds them.
    const hubIds = nodes
        .filter((node) => nodeLabelOf(node) === "activity")
        .sort((a, b) => {
            const timeA = createdAtMsOf(a);
            const timeB = createdAtMsOf(b);
            if (timeA !== timeB) {
                // Undated hubs seed last, so a dated one wins a tie — as in the layout.
                if (timeA === null) return 1;
                if (timeB === null) return -1;
                return timeA - timeB;
            }
            return a.id.localeCompare(b.id);
        })
        .map((node) => node.id);
    if (hubIds.length === 0) return [];

    // --- Claim every drawn node for the hub it is nearest to through the graph.
    const presentIds = new Set(nodes.map((node) => node.id));
    const labelById = new Map(nodes.map((node) => [node.id, nodeLabelOf(node)]));
    const adjacency = new Map<string, string[]>();
    const link = (from: string, to: string) => {
        const existing = adjacency.get(from);
        if (existing) existing.push(to);
        else adjacency.set(from, [to]);
    };
    for (const edge of edges) {
        if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
        if (!isEdgeActive(edge)) continue;
        // A chain of components wired in the tray is not a path between the cards at its ends. The
        // layout refuses to walk it, so this must too, or a halo grows to reach a card the layout put
        // somewhere else entirely.
        if (labelById.get(edge.source) === "blueprint_component"
            && labelById.get(edge.target) === "blueprint_component") continue;
        link(edge.source, edge.target);
        link(edge.target, edge.source);
    }
    for (const neighbours of adjacency.values()) {
        neighbours.sort((a, b) => a.localeCompare(b));
    }

    const ownerOf = new Map<string, string>();
    const queue: string[] = [];
    for (const hubId of hubIds) {
        ownerOf.set(hubId, hubId);
        queue.push(hubId);
    }
    let head = 0;
    while (head < queue.length) {
        const currentId = queue[head];
        head += 1;
        const owner = ownerOf.get(currentId)!;
        for (const neighbourId of adjacency.get(currentId) ?? []) {
            if (ownerOf.has(neighbourId)) continue;
            ownerOf.set(neighbourId, owner);
            queue.push(neighbourId);
        }
    }

    // --- A disc centred on the glyph, wide enough for everything that claimed it.
    const absoluteById = resolveAbsoluteNodePositions(nodes);
    const centreOf = (node: nodeType) => {
        const absolute = absoluteById.get(node.id) ?? node.position;
        const size = nodeSizeOf(node);
        return {
            x: absolute.x + (size.width / 2),
            y: absolute.y + (size.height / 2),
            extent: Math.hypot(size.width, size.height) / 2,
        };
    };

    const drawnCentres = new Map<string, ReturnType<typeof centreOf>>();
    for (const hub of drawn) drawnCentres.set(hub.node.id, centreOf(hub.node));

    const reachByHub = new Map<string, number>();
    for (const node of nodes) {
        const hubId = ownerOf.get(node.id);
        if (hubId === undefined) continue;
        const hubCentre = drawnCentres.get(hubId);
        // Claimed by a hub that gets no halo — an opened branch, or the unassigned band's glyph.
        if (!hubCentre) continue;

        const member = centreOf(node);
        const reach = Math.hypot(member.x - hubCentre.x, member.y - hubCentre.y) + member.extent;
        if (reach > (reachByHub.get(hubId) ?? 0)) reachByHub.set(hubId, reach);
    }

    return drawn.map(({ node, glyph }) => {
        const centre = drawnCentres.get(node.id)!;
        const radius = (reachByHub.get(node.id) ?? centre.extent) + HALO_PADDING_PX;
        return {
            key: node.id,
            kind: glyph.kind,
            title: glyph.label,
            center: { x: centre.x, y: centre.y },
            radius,
            maxFontSizePx: radius * HALO_LABEL_MAX_RATIO,
        };
    });
}
