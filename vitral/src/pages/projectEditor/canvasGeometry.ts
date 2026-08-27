import type { nodeType } from "@/config/types";
import { isNodeActive, nodeLabelOf } from "@/pages/projectEditor/graphSemantics";
import { cardLabelOf } from "@/pages/projectEditor/graphInvariants";
import { relationLabelFor, spawnPartnerFor } from "@/utils/relationships";

/** Matches `.card` in `components/cards/Card.module.css`. */
export const CARD_WIDTH_PX = 200;
export const CARD_HEIGHT_PX = 260;

/** Matches the square footprint used for blueprint components in `store/flowSlice.ts`. */
const BLUEPRINT_COMPONENT_SIZE_PX = 112;

/**
 * Minimum radius of the dashed drop ring painted around activity cards. The ring must
 * fully enclose the card, so it can never be smaller than half the card diagonal
 * (~164px for a 200x260 card); the extra padding keeps the dashes off the corners.
 *
 * It also has to stay *inside* the innermost orbit, because a spawn box wins over a ring it sits
 * in (contract 15): the nearest satellite's box reaches to within `ORBIT_MIN_RADIUS_PX - 100 -
 * CARD_SPAWN_BOX_GAP_PX - CARD_SPAWN_BOX_SIZE_PX` of the activity centre — 202px today against a
 * 176px ring. Growing the ring past that, or shrinking `ORBIT_MIN_RADIUS_PX` in
 * `activityOrbitLayout.ts`, turns "attach to this activity" gestures into "attach to whichever
 * satellite is nearest".
 */
const ACTIVITY_DROP_RING_MIN_RADIUS_PX = 176;
const ACTIVITY_DROP_RING_CORNER_PADDING_PX = 12;

export type ActivityDropTarget = {
    /** Identity for hover tracking. One ring per activity, so the node's own id serves. */
    key: string;
    nodeId: string;
    title: string;
    center: { x: number; y: number };
    radius: number;
};

function nodeDataRecord(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function readDimension(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    const parsed = Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return fallback;
}

export function nodeSizeOf(node: nodeType): { width: number; height: number } {
    const style = node.style as Record<string, unknown> | undefined;
    const isBlueprintComponent = nodeLabelOf(node) === "blueprint_component";
    const fallbackWidth = isBlueprintComponent ? BLUEPRINT_COMPONENT_SIZE_PX : CARD_WIDTH_PX;
    const fallbackHeight = isBlueprintComponent ? BLUEPRINT_COMPONENT_SIZE_PX : CARD_HEIGHT_PX;
    return {
        width: readDimension(style?.width, fallbackWidth),
        height: readDimension(style?.height, fallbackHeight),
    };
}

export function resolveAbsoluteNodePositions(allNodes: nodeType[]): Map<string, { x: number; y: number }> {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const absoluteById = new Map<string, { x: number; y: number }>();

    const resolve = (nodeId: string): { x: number; y: number } => {
        const cached = absoluteById.get(nodeId);
        if (cached) return cached;

        const current = byId.get(nodeId);
        if (!current) {
            const fallback = { x: 0, y: 0 };
            absoluteById.set(nodeId, fallback);
            return fallback;
        }

        if (!current.parentId) {
            const root = { x: current.position.x, y: current.position.y };
            absoluteById.set(nodeId, root);
            return root;
        }

        const parentAbsolute = resolve(current.parentId);
        const result = {
            x: parentAbsolute.x + current.position.x,
            y: parentAbsolute.y + current.position.y,
        };
        absoluteById.set(nodeId, result);
        return result;
    };

    for (const node of allNodes) {
        resolve(node.id);
    }

    return absoluteById;
}

/**
 * Drop rings for every visible activity card. Non-activity cards must hang off an activity,
 * so these rings are the valid areas for file drops and for the card tool.
 */
export function getActivityDropTargets(nodes: nodeType[]): ActivityDropTarget[] {
    const absoluteById = resolveAbsoluteNodePositions(nodes);
    const targets: ActivityDropTarget[] = [];

    for (const node of nodes) {
        if (nodeLabelOf(node) !== "activity") continue;
        if (!isNodeActive(node)) continue;

        const absolute = absoluteById.get(node.id);
        if (!absolute) continue;

        const size = nodeSizeOf(node);
        const radius = Math.max(
            ACTIVITY_DROP_RING_MIN_RADIUS_PX,
            Math.round(Math.hypot(size.width, size.height) / 2) + ACTIVITY_DROP_RING_CORNER_PADDING_PX,
        );

        const title = String(nodeDataRecord(node).title ?? "").trim();
        targets.push({
            key: node.id,
            nodeId: node.id,
            title: title || "Untitled",
            center: { x: absolute.x + size.width / 2, y: absolute.y + size.height / 2 },
            radius,
        });
    }

    return targets;
}

/** Nearest ring containing `position`, or `null` when the point is outside every ring. */
export function findActivityDropTarget(
    targets: readonly ActivityDropTarget[],
    position: { x: number; y: number },
): ActivityDropTarget | null {
    let best: ActivityDropTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const target of targets) {
        const distance = Math.hypot(position.x - target.center.x, position.y - target.center.y);
        if (distance > target.radius) continue;
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = target;
    }

    return best;
}

/**
 * Which of a card's two handles a spawn box sits on, and therefore which way the edge runs.
 *
 * `outgoing` is the source handle on the right: the card is the edge's source and the new card its
 * target. `incoming` is the target handle on the left, and reverses that. The relation *label* is
 * the same either way — `ALLOWED_RELATION_LABEL_BY_PAIR` is keyed by an unordered pair — so the
 * side is what carries the direction, exactly as the two handles always have.
 */
export type CardSpawnDirection = "incoming" | "outgoing";

/**
 * Side of the dashed square painted at a handle, and its clearance from the card border, in flow
 * units. A box therefore occupies `gap`..`gap + size` outside the border, and two facing boxes on
 * horizontally adjacent cards need twice that between them.
 *
 * The binding constraint is the layout's tightest horizontal gap — `UNASSIGNED_ITEM_GAP_PX` (80) in
 * `activityOrbitLayout.ts`, well under the orbit's own ~148. At 2 + 36 the pair fits in 76 and two
 * boxes never overlap; grow either number past 40 and cards in the unassigned band start painting
 * their boxes on top of each other.
 */
export const CARD_SPAWN_BOX_SIZE_PX = 36;
const CARD_SPAWN_BOX_GAP_PX = 2;

export type CardSpawnTarget = {
    /** Identity for hover tracking. A card carries two boxes, so the node id alone is not enough. */
    key: string;
    nodeId: string;
    anchorLabel: string;
    anchorTitle: string;
    direction: CardSpawnDirection;
    /** Label of the card the box will create. */
    spawnLabel: string;
    /** Relation the connecting edge arrives with, before the user picks a kind. */
    relationLabel: string;
    center: { x: number; y: number };
    size: number;
};

type CardSpawnTargetOptions = {
    /**
     * Set when the caller already knows what it is about to create — a dropped file is always an
     * `object` card. Boxes are then emitted only on the cards that label may legally attach to, so
     * a drag never offers a target that would be refused on release.
     */
    spawnLabel?: string;
};

/**
 * A dashed box at each handle of every non-activity card, and what clicking it would create.
 *
 * The activity rings answer "which activity is this card about". These answer the same question for
 * every other card, which is what makes "no card without a connection" a rule the canvas can offer
 * rather than only enforce: wherever a card may be created, there is something visible to create it
 * on. Activities are excluded because they already have a ring, and because they are the one card
 * that is allowed to stand alone.
 */
export function getCardSpawnTargets(
    nodes: nodeType[],
    options: CardSpawnTargetOptions = {},
): CardSpawnTarget[] {
    const requestedSpawnLabel = options.spawnLabel?.trim().toLowerCase() ?? "";
    const absoluteById = resolveAbsoluteNodePositions(nodes);
    const targets: CardSpawnTarget[] = [];

    for (const node of nodes) {
        if (node.type !== "card") continue;
        if (!isNodeActive(node)) continue;

        // Closed to the ontology, exactly as the card is drawn: a node carrying a label the model
        // invented renders as an `object` and must be offered the boxes an `object` gets.
        const anchorLabel = cardLabelOf(node);
        if (anchorLabel === "activity") continue;

        const partner = requestedSpawnLabel
            ? (() => {
                const relationLabel = relationLabelFor(anchorLabel, requestedSpawnLabel);
                return relationLabel ? { label: requestedSpawnLabel, relationLabel } : null;
            })()
            : spawnPartnerFor(anchorLabel);
        if (!partner) continue;

        const absolute = absoluteById.get(node.id);
        if (!absolute) continue;

        const size = nodeSizeOf(node);
        const centerY = absolute.y + (size.height / 2);
        const offset = CARD_SPAWN_BOX_GAP_PX + (CARD_SPAWN_BOX_SIZE_PX / 2);
        const anchorTitle = String(nodeDataRecord(node).title ?? "").trim() || "Untitled";

        const shared = {
            nodeId: node.id,
            anchorLabel,
            anchorTitle,
            spawnLabel: partner.label,
            relationLabel: partner.relationLabel,
            size: CARD_SPAWN_BOX_SIZE_PX,
        };

        targets.push({
            ...shared,
            key: `${node.id}:incoming`,
            direction: "incoming",
            center: { x: absolute.x - offset, y: centerY },
        });
        targets.push({
            ...shared,
            key: `${node.id}:outgoing`,
            direction: "outgoing",
            center: { x: absolute.x + size.width + offset, y: centerY },
        });
    }

    return targets;
}

/** Nearest spawn box containing `position`, or `null` when the point is outside every box. */
export function findCardSpawnTarget(
    targets: readonly CardSpawnTarget[],
    position: { x: number; y: number },
): CardSpawnTarget | null {
    let best: CardSpawnTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const target of targets) {
        const dx = Math.abs(position.x - target.center.x);
        const dy = Math.abs(position.y - target.center.y);
        const half = target.size / 2;
        if (dx > half || dy > half) continue;
        const distance = Math.hypot(dx, dy);
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = target;
    }

    return best;
}

/**
 * The card whose own box contains `position`, optionally narrowed to one label.
 *
 * Unlike the rings and the spawn boxes this hit-tests the card itself, because the gesture it serves
 * — dragging a component out of the tray onto the requirement it answers — is about *that card* and
 * nothing near it. A ring would claim the whole neighbourhood and attach the component to whichever
 * requirement happened to be closest, which is a different claim from the one the researcher made.
 *
 * `nodes` must be the **displayed** nodes: the layout owns rendered positions, and stored ones no
 * longer agree with canvas coordinates for anything but blueprint group boxes.
 */
export function findCardAtPosition(
    nodes: readonly nodeType[],
    position: { x: number; y: number },
    options: { label?: string } = {},
): nodeType | null {
    const absolute = resolveAbsoluteNodePositions(nodes as nodeType[]);
    const wanted = options.label?.trim().toLowerCase();

    let best: nodeType | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
        if (node.type !== "card") continue;
        if (wanted !== undefined) {
            const raw = String((node.data as Record<string, unknown> | undefined)?.label ?? "")
                .trim()
                .toLowerCase();
            const label = raw === "task" ? "requirement" : raw;
            if (label !== wanted) continue;
        }

        const origin = absolute.get(node.id) ?? node.position;
        const size = nodeSizeOf(node);
        if (position.x < origin.x || position.x > origin.x + size.width) continue;
        if (position.y < origin.y || position.y > origin.y + size.height) continue;

        // Overlapping cards are possible while the layout is settling; the nearest centre wins, the
        // same tie-break `findActivityDropTarget` uses.
        const distance = Math.hypot(
            position.x - (origin.x + (size.width / 2)),
            position.y - (origin.y + (size.height / 2)),
        );
        if (distance >= bestDistance) continue;
        bestDistance = distance;
        best = node;
    }

    return best;
}
