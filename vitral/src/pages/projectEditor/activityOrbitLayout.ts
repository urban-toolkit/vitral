import type { edgeType, nodeType } from "@/config/types";
import { CARD_HEIGHT_PX, CARD_WIDTH_PX, nodeSizeOf } from "@/pages/projectEditor/canvasGeometry";

/**
 * Canvas layout shared by every view.
 *
 * Activities are the only cards where time matters: they are laid out left to right, one slot per
 * distinct `createdAt`, evenly spaced. Every other card orbits the activity it belongs to, on a
 * concentric ring chosen by its graph distance from that activity. Cards that reach no activity go
 * into an "unassigned" band underneath, and blueprint groups/components keep their own nested
 * structure and are translated in as one block.
 *
 * Positions are fully derived here, so stored node positions no longer affect what is rendered
 * (blueprint structure excepted, which is preserved relative to its own roots).
 */

/** Radial clearance between an activity and its innermost ring: two card half-diagonals (~164 each). */
const ORBIT_MIN_RADIUS_PX = 340;
/**
 * Centre-to-centre distance two cards need to be guaranteed not to overlap, whatever direction
 * separates them. Two axis-aligned WxH cards overlap while `|dx| < W && |dy| < H`, and the tightest
 * case is the corner-to-corner diagonal — so the card diagonal is exactly the critical distance and
 * anything above it is safe. Used both for neighbours on a ring and between consecutive rings.
 */
const CARD_SEPARATION_PX = Math.hypot(CARD_WIDTH_PX, CARD_HEIGHT_PX) + 24;
/** Horizontal breathing room between two neighbouring activity slots. */
const ACTIVITY_SLOT_GAP_PX = 280;
/** Vertical breathing room between activities that share the same timestamp. */
const ACTIVITY_STACK_GAP_PX = 200;
const UNASSIGNED_BAND_GAP_PX = 420;
const UNASSIGNED_ITEM_GAP_PX = 80;
const BLUEPRINT_BAND_GAP_PX = 460;
/** Gap between two blueprint roots (paper groups / standalone components) on the structural grid. */
const BLUEPRINT_ROOT_GAP_PX = 80;

const STRUCTURAL_LABELS = new Set(["blueprint", "blueprint_group", "blueprint_component"]);

type NodeKind = "activity" | "satellite" | "structural";

type SatelliteAssignment = {
    activityId: string;
    hop: number;
};

function nodeDataRecord(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function labelOf(node: nodeType): string {
    const raw = String(nodeDataRecord(node).label ?? "").trim().toLowerCase();
    return raw === "task" ? "requirement" : raw;
}

function kindOf(node: nodeType): NodeKind {
    const label = labelOf(node);
    if (label === "activity") return "activity";
    if (STRUCTURAL_LABELS.has(label)) return "structural";
    // Known card labels plus anything unrecognised, so no node is silently left unplaced.
    return "satellite";
}

function timestampOf(node: nodeType): number | null {
    const raw = nodeDataRecord(node).createdAt;
    if (typeof raw !== "string" || raw.trim() === "") return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

function isEdgeActive(edge: edgeType): boolean {
    const deletedAt = (edge.data as Record<string, unknown> | undefined)?.deletedAt;
    if (typeof deletedAt !== "string" || deletedAt.trim() === "") return true;
    return Number.isNaN(new Date(deletedAt).getTime());
}

/** Half the card diagonal — the radius that fully contains the node whatever its rotation. */
function radialExtentOf(node: nodeType): number {
    const size = nodeSizeOf(node);
    return Math.hypot(size.width, size.height) / 2;
}

function compareByLabelTitleId(a: nodeType, b: nodeType): number {
    const labelA = labelOf(a);
    const labelB = labelOf(b);
    if (labelA !== labelB) return labelA.localeCompare(labelB);
    const titleA = String(nodeDataRecord(a).title ?? "");
    const titleB = String(nodeDataRecord(b).title ?? "");
    if (titleA !== titleB) return titleA.localeCompare(titleB);
    return a.id.localeCompare(b.id);
}

/**
 * Multi-source breadth-first search from every activity at once, so each card is claimed by the
 * activity it is closest to in the graph. `activityIds` must be in chronological order: the queue
 * is seeded in that order, so an earlier activity wins when two are equally close.
 */
function assignSatellitesToActivities(
    nodes: nodeType[],
    edges: edgeType[],
    activityIds: string[],
): Map<string, SatelliteAssignment> {
    const assignments = new Map<string, SatelliteAssignment>();
    if (activityIds.length === 0) return assignments;

    const presentIds = new Set(nodes.map((node) => node.id));
    const adjacency = new Map<string, string[]>();
    const link = (from: string, to: string) => {
        const existing = adjacency.get(from);
        if (existing) existing.push(to);
        else adjacency.set(from, [to]);
    };

    for (const edge of edges) {
        if (!presentIds.has(edge.source) || !presentIds.has(edge.target)) continue;
        if (!isEdgeActive(edge)) continue;
        link(edge.source, edge.target);
        link(edge.target, edge.source);
    }
    // Stable neighbour order keeps the layout deterministic across renders.
    for (const neighbours of adjacency.values()) {
        neighbours.sort((a, b) => a.localeCompare(b));
    }

    const bestHop = new Map<string, number>();
    const queue: Array<{ id: string; activityId: string; hop: number }> = [];
    for (const activityId of activityIds) {
        bestHop.set(activityId, 0);
        queue.push({ id: activityId, activityId, hop: 0 });
    }

    let head = 0;
    while (head < queue.length) {
        const current = queue[head];
        head += 1;
        const nextHop = current.hop + 1;

        for (const neighbourId of adjacency.get(current.id) ?? []) {
            const known = bestHop.get(neighbourId);
            if (known !== undefined && known <= nextHop) continue;
            bestHop.set(neighbourId, nextHop);
            assignments.set(neighbourId, { activityId: current.activityId, hop: nextHop });
            queue.push({ id: neighbourId, activityId: current.activityId, hop: nextHop });
        }
    }

    return assignments;
}

export function buildActivityOrbitLayout(nodes: nodeType[], edges: edgeType[]): nodeType[] {
    if (nodes.length === 0) return nodes;

    const activities: nodeType[] = [];
    const satellites: nodeType[] = [];
    const structural: nodeType[] = [];
    for (const node of nodes) {
        const kind = kindOf(node);
        if (kind === "activity") activities.push(node);
        else if (kind === "structural") structural.push(node);
        else satellites.push(node);
    }

    // --- Activity slots: one per distinct timestamp, evenly spaced in chronological order. ---
    const timestampById = new Map<string, number | null>();
    for (const activity of activities) {
        timestampById.set(activity.id, timestampOf(activity));
    }

    const distinctTimes = Array.from(new Set(
        activities
            .map((activity) => timestampById.get(activity.id))
            .filter((value): value is number => typeof value === "number"),
    )).sort((a, b) => a - b);

    const slotByTime = new Map<number, number>();
    distinctTimes.forEach((time, index) => slotByTime.set(time, index));

    const slotByActivityId = new Map<string, number>();
    for (const activity of activities) {
        const time = timestampById.get(activity.id);
        if (typeof time !== "number") continue;
        slotByActivityId.set(activity.id, slotByTime.get(time) ?? 0);
    }
    // Activities without a usable timestamp trail the timeline, each in its own slot.
    activities
        .filter((activity) => timestampById.get(activity.id) === null)
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((activity, index) => slotByActivityId.set(activity.id, distinctTimes.length + index));

    const activitiesBySlot = new Map<number, nodeType[]>();
    for (const activity of activities) {
        const slot = slotByActivityId.get(activity.id) ?? 0;
        const existing = activitiesBySlot.get(slot);
        if (existing) existing.push(activity);
        else activitiesBySlot.set(slot, [activity]);
    }
    for (const slotActivities of activitiesBySlot.values()) {
        slotActivities.sort((a, b) => a.id.localeCompare(b.id));
    }

    // --- Claim every other card for the nearest activity. ---
    const chronologicalActivityIds = activities
        .slice()
        .sort((a, b) => {
            const slotA = slotByActivityId.get(a.id) ?? 0;
            const slotB = slotByActivityId.get(b.id) ?? 0;
            if (slotA !== slotB) return slotA - slotB;
            return a.id.localeCompare(b.id);
        })
        .map((activity) => activity.id);

    const assignments = assignSatellitesToActivities(nodes, edges, chronologicalActivityIds);

    const ringsByActivityId = new Map<string, nodeType[][]>();
    const unassigned: nodeType[] = [];
    for (const satellite of satellites) {
        const assignment = assignments.get(satellite.id);
        if (!assignment) {
            unassigned.push(satellite);
            continue;
        }
        const rings = ringsByActivityId.get(assignment.activityId) ?? [];
        const ringIndex = Math.max(0, assignment.hop - 1);
        while (rings.length <= ringIndex) rings.push([]);
        rings[ringIndex].push(satellite);
        ringsByActivityId.set(assignment.activityId, rings);
    }
    for (const rings of ringsByActivityId.values()) {
        for (const ring of rings) ring.sort(compareByLabelTitleId);
    }

    // --- Ring radii: wide enough for the cards on them, and clear of the ring inside. ---
    const ringRadiiByActivityId = new Map<string, number[]>();
    let maxOuterRadius = ORBIT_MIN_RADIUS_PX;
    for (const activity of activities) {
        const rings = ringsByActivityId.get(activity.id) ?? [];
        const radii: number[] = [];
        let previousRadius = 0;

        for (const ring of rings) {
            // Neighbours on a ring are separated by the CHORD between them, not by arc length, so
            // solve chord = 2r*sin(pi/n) for r. Budgeting arc here would let cards overlap for most
            // counts above six.
            const radiusForCount = ring.length <= 1
                ? 0
                : CARD_SEPARATION_PX / (2 * Math.sin(Math.PI / ring.length));
            const radiusClearingPrevious = previousRadius === 0
                ? ORBIT_MIN_RADIUS_PX
                : previousRadius + CARD_SEPARATION_PX;
            const radius = Math.max(ORBIT_MIN_RADIUS_PX, radiusClearingPrevious, radiusForCount);
            radii.push(radius);
            previousRadius = radius;
        }

        ringRadiiByActivityId.set(activity.id, radii);
        const outerRadius = radii.length === 0
            ? radialExtentOf(activity)
            : previousRadius + (CARD_HEIGHT_PX / 2);
        if (outerRadius > maxOuterRadius) maxOuterRadius = outerRadius;
    }

    // Uniform slot pitch keeps the time axis evenly spaced while guaranteeing no two orbits touch.
    const slotWidth = (2 * maxOuterRadius) + ACTIVITY_SLOT_GAP_PX;
    const stackStep = (2 * maxOuterRadius) + ACTIVITY_STACK_GAP_PX;

    const positionById = new Map<string, { x: number; y: number }>();
    let contentBottom = 0;

    for (const [slot, slotActivities] of activitiesBySlot) {
        const centerX = slot * slotWidth;

        slotActivities.forEach((activity, stackIndex) => {
            const centerY = stackIndex * stackStep;
            const activitySize = nodeSizeOf(activity);
            positionById.set(activity.id, {
                x: Math.round(centerX - (activitySize.width / 2)),
                y: Math.round(centerY - (activitySize.height / 2)),
            });

            const rings = ringsByActivityId.get(activity.id) ?? [];
            const radii = ringRadiiByActivityId.get(activity.id) ?? [];

            rings.forEach((ring, ringIndex) => {
                const radius = radii[ringIndex] ?? ORBIT_MIN_RADIUS_PX;
                ring.forEach((satellite, indexOnRing) => {
                    // Start at the top and go clockwise, so small orbits read predictably.
                    const angle = -(Math.PI / 2) + ((indexOnRing * 2 * Math.PI) / ring.length);
                    const satelliteSize = nodeSizeOf(satellite);
                    const y = centerY + (Math.sin(angle) * radius) - (satelliteSize.height / 2);
                    positionById.set(satellite.id, {
                        x: Math.round(centerX + (Math.cos(angle) * radius) - (satelliteSize.width / 2)),
                        y: Math.round(y),
                    });
                    contentBottom = Math.max(contentBottom, y + satelliteSize.height);
                });
            });

            contentBottom = Math.max(contentBottom, centerY + (activitySize.height / 2));
        });
    }

    // --- Cards that reach no activity: their own band, so nothing silently disappears. ---
    if (unassigned.length > 0) {
        const ordered = unassigned.slice().sort(compareByLabelTitleId);
        const columns = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
        const bandTop = contentBottom + UNASSIGNED_BAND_GAP_PX;

        ordered.forEach((node, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            positionById.set(node.id, {
                x: Math.round(column * (CARD_WIDTH_PX + UNASSIGNED_ITEM_GAP_PX)),
                y: Math.round(bandTop + (row * (CARD_HEIGHT_PX + UNASSIGNED_ITEM_GAP_PX))),
            });
        });

        const rowCount = Math.ceil(ordered.length / columns);
        contentBottom = bandTop + (rowCount * (CARD_HEIGHT_PX + UNASSIGNED_ITEM_GAP_PX));
    }

    // --- Blueprint structure: each root placed on a deterministic grid, internals untouched. ---
    if (structural.length > 0) {
        const presentIds = new Set(nodes.map((node) => node.id));
        // Only nodes whose parent is absent from this view are positioned absolutely; the rest are
        // laid out relative to their parent by React Flow and must not be touched.
        const blockRoots = structural
            .filter((node) => !node.parentId || !presentIds.has(node.parentId))
            // Ordered by content, never by stored position: creation paths write cursor coordinates
            // into blueprint roots, so ordering by position would reshuffle the whole block (and
            // visibly teleport the blueprints already on screen) every time one is added.
            .sort(compareByLabelTitleId);

        if (blockRoots.length > 0) {
            const bandTop = activities.length === 0 && unassigned.length === 0
                ? 0
                : contentBottom + BLUEPRINT_BAND_GAP_PX;
            const columns = Math.max(1, Math.ceil(Math.sqrt(blockRoots.length)));

            let cursorX = 0;
            let rowTop = bandTop;
            let rowHeight = 0;

            blockRoots.forEach((root, index) => {
                if (index > 0 && index % columns === 0) {
                    rowTop += rowHeight + BLUEPRINT_ROOT_GAP_PX;
                    cursorX = 0;
                    rowHeight = 0;
                }

                const size = nodeSizeOf(root);
                positionById.set(root.id, { x: Math.round(cursorX), y: Math.round(rowTop) });
                cursorX += size.width + BLUEPRINT_ROOT_GAP_PX;
                rowHeight = Math.max(rowHeight, size.height);
            });

            contentBottom = rowTop + rowHeight;
        }
    }

    return nodes.map((node) => {
        const next = positionById.get(node.id);
        if (!next) return node;
        if (node.position.x === next.x && node.position.y === next.y) return node;
        return { ...node, position: next };
    });
}
