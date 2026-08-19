import type { edgeType, nodeType } from "@/config/types";
import { CARD_HEIGHT_PX, CARD_WIDTH_PX, nodeSizeOf } from "@/pages/projectEditor/canvasGeometry";

/**
 * Canvas layout shared by every view.
 *
 * Activities are the only cards where time matters: they are laid out left to right, one slot per
 * distinct `createdAt`, evenly spaced. Every other card orbits the activity it belongs to, on an
 * onion of fixed-radius layers ordered by its graph distance from that activity. Where two trees
 * would collide at that pitch they are offset vertically rather than pushed further apart in time,
 * so a project with big trees grows downward and upward instead of only sideways. Cards that reach
 * no activity go into an "unassigned" band underneath, and blueprint groups/components keep their
 * own nested structure and are translated in as one block.
 *
 * Positions are fully derived here, so stored node positions no longer affect what is rendered
 * (blueprint structure excepted, which is preserved relative to its own roots).
 */

/** Radial clearance between an activity and its innermost layer: two card half-diagonals (~164 each). */
const ORBIT_MIN_RADIUS_PX = 340;
/**
 * Centre-to-centre distance two cards need to be guaranteed not to overlap, whatever direction
 * separates them. Two axis-aligned WxH cards overlap while `|dx| < W && |dy| < H`, and the tightest
 * case is the corner-to-corner diagonal — so the card diagonal is exactly the critical distance and
 * anything above it is safe. Used both for neighbours on a layer and between consecutive layers.
 */
const CARD_SEPARATION_PX = Math.hypot(CARD_WIDTH_PX, CARD_HEIGHT_PX) + 24;
/** Horizontal breathing room between two neighbouring activity slots. */
const ACTIVITY_SLOT_GAP_PX = 280;
/** Clearance between the bounding discs of two activity trees. */
const ACTIVITY_TREE_GAP_PX = 200;
/** Granularity of the vertical search that separates colliding trees. */
const ACTIVITY_TREE_Y_STEP_PX = 200;
/** Backstop for that search; ~40k px of travel is far past any real project. */
const ACTIVITY_TREE_Y_MAX_STEPS = 400;
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

/** Radius of the n-th onion layer. Fixed by index: a crowded layer never widens, it overflows. */
function layerRadius(index: number): number {
    return ORBIT_MIN_RADIUS_PX + (index * CARD_SEPARATION_PX);
}

/**
 * How many cards fit on a layer. Neighbours on a ring are separated by the CHORD between them, not
 * by arc length, so this is the largest `n` satisfying `2r*sin(pi/n) >= CARD_SEPARATION_PX`.
 * Budgeting arc instead would let cards overlap for most counts above six.
 */
function layerCapacity(radius: number): number {
    const ratio = CARD_SEPARATION_PX / (2 * radius);
    if (ratio >= 1) return 1;
    return Math.max(1, Math.floor(Math.PI / Math.asin(ratio)));
}

/**
 * Pours the cards of each hop into fixed-radius layers, spilling outward once a layer is full.
 *
 * The alternative — widening the ring until everything fits on it — pushes a crowded hop's cards
 * away from the activity they belong to and leaves a hole in the middle. Here a hop starts no
 * closer than its own distance, fills the layer it lands on, and opens a new layer around the
 * leaves when it runs out of room; the next hop always starts on a fresh layer.
 */
function packOnionLayers(hopBuckets: nodeType[][]): nodeType[][] {
    const layers: nodeType[][] = [];
    const layerAt = (index: number) => {
        while (layers.length <= index) layers.push([]);
        return layers[index];
    };

    let layerIndex = 0;
    hopBuckets.forEach((bucket, hopIndex) => {
        if (bucket.length === 0) return;
        layerIndex = Math.max(layerIndex, hopIndex);

        for (const node of bucket) {
            while (layerAt(layerIndex).length >= layerCapacity(layerRadius(layerIndex))) {
                layerIndex += 1;
            }
            layerAt(layerIndex).push(node);
        }

        layerIndex += 1;
    });

    // A hop that contributed no cards (all its nodes are blueprint structure, say) would otherwise
    // leave an empty ring of dead space in the middle of the onion.
    return layers.filter((layer) => layer.length > 0);
}

type TreeDisc = { x: number; y: number; radius: number };

/**
 * Lowest-magnitude vertical offset at which a tree of `radius` centred on `x` clears every tree
 * already placed. Candidates alternate above and below zero, so the graph grows in both directions
 * around the time axis instead of drifting downward.
 */
function resolveTreeCenterY(placed: TreeDisc[], x: number, radius: number): number {
    const collidesAt = (y: number) => placed.some((disc) => {
        const minDistance = disc.radius + radius + ACTIVITY_TREE_GAP_PX;
        if (Math.abs(disc.x - x) >= minDistance) return false;
        return Math.hypot(disc.x - x, disc.y - y) < minDistance;
    });

    for (let step = 0; step <= ACTIVITY_TREE_Y_MAX_STEPS; step += 1) {
        const magnitude = Math.ceil(step / 2) * ACTIVITY_TREE_Y_STEP_PX;
        const candidate = step % 2 === 1 ? magnitude : -magnitude;
        if (!collidesAt(candidate)) return candidate;
    }

    // Unreachable for any real project; drop below everything rather than overlap.
    const lowest = placed.reduce((max, disc) => Math.max(max, disc.y + disc.radius), 0);
    return lowest + radius + ACTIVITY_TREE_GAP_PX;
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

/**
 * Which activity each node belongs to — the "tree" the timeline shows and hides as a unit.
 *
 * Activities map to themselves; every other card maps to the activity it is closest to in the
 * graph, the same claim the orbit layout uses, so what hides together is what is drawn together.
 * Blueprint structure and cards that reach no activity are absent from the map: they belong to no
 * tree and the timeline never gates them.
 */
export function buildActivityTreeMembership(
    nodes: nodeType[],
    edges: edgeType[],
): Map<string, string> {
    const membership = new Map<string, string>();

    const chronologicalActivityIds = nodes
        .filter((node) => kindOf(node) === "activity")
        .sort((a, b) => {
            const timeA = timestampOf(a);
            const timeB = timestampOf(b);
            if (timeA !== timeB) {
                // Activities without a usable timestamp seed last, so a dated one wins a tie.
                if (timeA === null) return 1;
                if (timeB === null) return -1;
                return timeA - timeB;
            }
            return a.id.localeCompare(b.id);
        })
        .map((activity) => activity.id);

    for (const activityId of chronologicalActivityIds) {
        membership.set(activityId, activityId);
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const assignments = assignSatellitesToActivities(nodes, edges, chronologicalActivityIds);
    for (const [nodeId, assignment] of assignments) {
        const node = nodeById.get(nodeId);
        if (!node || kindOf(node) !== "satellite") continue;
        membership.set(nodeId, assignment.activityId);
    }

    return membership;
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

    const hopBucketsByActivityId = new Map<string, nodeType[][]>();
    const unassigned: nodeType[] = [];
    for (const satellite of satellites) {
        const assignment = assignments.get(satellite.id);
        if (!assignment) {
            unassigned.push(satellite);
            continue;
        }
        const buckets = hopBucketsByActivityId.get(assignment.activityId) ?? [];
        const hopIndex = Math.max(0, assignment.hop - 1);
        while (buckets.length <= hopIndex) buckets.push([]);
        buckets[hopIndex].push(satellite);
        hopBucketsByActivityId.set(assignment.activityId, buckets);
    }

    // --- Onion layers: fixed radii, each hop spilling outward once its layer is full. ---
    const layersByActivityId = new Map<string, nodeType[][]>();
    const treeRadiusByActivityId = new Map<string, number>();
    for (const activity of activities) {
        const buckets = hopBucketsByActivityId.get(activity.id) ?? [];
        for (const bucket of buckets) bucket.sort(compareByLabelTitleId);

        const layers = packOnionLayers(buckets);
        layersByActivityId.set(activity.id, layers);
        treeRadiusByActivityId.set(
            activity.id,
            layers.length === 0
                ? radialExtentOf(activity)
                // Half a card diagonal past the outermost layer, so the disc contains its cards.
                : layerRadius(layers.length - 1) + (Math.hypot(CARD_WIDTH_PX, CARD_HEIGHT_PX) / 2),
        );
    }

    // Uniform slot pitch keeps the time axis evenly spaced, as the layout contract requires. It is
    // sized from a TYPICAL tree rather than the largest one: letting the widest orbit set the pitch
    // made a single big tree stretch every gap in the project. Trees that do not fit that pitch are
    // offset vertically instead, so the graph grows in both axes.
    const sortedRadii = Array.from(treeRadiusByActivityId.values()).sort((a, b) => a - b);
    const typicalRadius = sortedRadii.length === 0
        ? ORBIT_MIN_RADIUS_PX
        : sortedRadii[Math.floor(sortedRadii.length / 2)];
    const slotWidth = (2 * typicalRadius) + ACTIVITY_SLOT_GAP_PX;

    const positionById = new Map<string, { x: number; y: number }>();
    const placedTrees: TreeDisc[] = [];
    let contentBottom = 0;

    // Left to right, so a tree only ever has to dodge trees earlier in time than itself.
    const orderedSlots = Array.from(activitiesBySlot.keys()).sort((a, b) => a - b);
    for (const slot of orderedSlots) {
        const centerX = slot * slotWidth;

        for (const activity of activitiesBySlot.get(slot) ?? []) {
            const treeRadius = treeRadiusByActivityId.get(activity.id) ?? ORBIT_MIN_RADIUS_PX;
            const centerY = resolveTreeCenterY(placedTrees, centerX, treeRadius);
            placedTrees.push({ x: centerX, y: centerY, radius: treeRadius });

            const activitySize = nodeSizeOf(activity);
            positionById.set(activity.id, {
                x: Math.round(centerX - (activitySize.width / 2)),
                y: Math.round(centerY - (activitySize.height / 2)),
            });

            const layers = layersByActivityId.get(activity.id) ?? [];
            layers.forEach((layer, layerIndex) => {
                const radius = layerRadius(layerIndex);
                // Alternate layers are rotated half a step so cards do not line up radially, which
                // would stack every layer's edges along the same spokes.
                const angleOffset = layerIndex % 2 === 0 ? 0 : Math.PI / layer.length;

                layer.forEach((satellite, indexOnLayer) => {
                    // Start at the top and go clockwise, so small orbits read predictably.
                    const angle = -(Math.PI / 2) + angleOffset + ((indexOnLayer * 2 * Math.PI) / layer.length);
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
        }
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
