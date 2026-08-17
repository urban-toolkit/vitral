import type { nodeType } from "@/config/types";

/** Matches `.card` in `components/cards/Card.module.css`. */
export const CARD_WIDTH_PX = 200;
export const CARD_HEIGHT_PX = 260;

/** Matches the square footprint used for blueprint components in `store/flowSlice.ts`. */
const BLUEPRINT_COMPONENT_SIZE_PX = 112;

/**
 * Minimum radius of the dashed drop ring painted around activity cards. The ring must
 * fully enclose the card, so it can never be smaller than half the card diagonal
 * (~164px for a 200x260 card); the extra padding keeps the dashes off the corners.
 */
const ACTIVITY_DROP_RING_MIN_RADIUS_PX = 176;
const ACTIVITY_DROP_RING_CORNER_PADDING_PX = 12;

export type ActivityDropTarget = {
    nodeId: string;
    title: string;
    center: { x: number; y: number };
    radius: number;
};

function nodeDataRecord(node: nodeType): Record<string, unknown> {
    return (node.data ?? {}) as Record<string, unknown>;
}

function nodeLabelOf(node: nodeType): string {
    const raw = String(nodeDataRecord(node).label ?? "").trim().toLowerCase();
    return raw === "task" ? "requirement" : raw;
}

function isNodeActive(node: nodeType): boolean {
    const deletedAt = nodeDataRecord(node).deletedAt;
    if (typeof deletedAt !== "string" || deletedAt.trim() === "") return true;
    return Number.isNaN(new Date(deletedAt).getTime());
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
    targets: ActivityDropTarget[],
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
