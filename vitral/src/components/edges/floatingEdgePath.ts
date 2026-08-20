/**
 * Geometry for edges that meet a card wherever the other card happens to be, instead of always at a
 * handle pinned to its left or right side.
 *
 * Two things matter here. The line has to read as *almost straight*: each anchor is the point where
 * the straight centre-to-centre line leaves the card, so a card sitting directly above another is
 * joined by a near-vertical line rather than an S out of one right side and back into a left one.
 * And it still has to read as *directed*: the path keeps its source -> target parameter order, so an
 * arrow marker oriented off the tangent points exactly where it did before.
 */

export type EdgeRect = { x: number; y: number; width: number; height: number };

export type FloatingEdgePath = {
    path: string;
    labelX: number;
    labelY: number;
};

/** Pulls the anchor a little off the card so an arrowhead does not sit on the border itself. */
const BORDER_GAP_PX = 6;

/**
 * How far the curve bows off the straight run, as a fraction of its length and capped in pixels.
 * Deliberately small: enough that two cards joined in both directions do not draw one line on top of
 * the other, not so much that the connection stops looking direct.
 */
const BOW_RATIO = 0.08;
const MAX_BOW_PX = 28;

/** Where a ray leaving the centre of `rect` along `(dx, dy)` crosses its border, plus the gap. */
function anchorOn(rect: EdgeRect, dx: number, dy: number): { x: number; y: number } {
    const centerX = rect.x + rect.width / 2;
    const centerY = rect.y + rect.height / 2;
    const halfWidth = Math.max(rect.width, 1) / 2;
    const halfHeight = Math.max(rect.height, 1) / 2;

    // How far along (dx, dy) the ray meets each pair of sides; the nearer crossing is the border.
    const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(dx);
    const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfHeight / Math.abs(dy);
    const scale = Math.min(scaleX, scaleY);
    if (!Number.isFinite(scale)) return { x: centerX, y: centerY };

    const length = Math.hypot(dx, dy) || 1;
    const gap = BORDER_GAP_PX / length;
    return {
        x: centerX + dx * (scale + gap),
        y: centerY + dy * (scale + gap),
    };
}

/**
 * Returns `null` when the two rectangles are effectively concentric — there is no meaningful
 * direction to leave along, and the caller is expected to fall back to the handle-based path.
 */
export function getFloatingEdgePath(source: EdgeRect, target: EdgeRect): FloatingEdgePath | null {
    const dx = (target.x + target.width / 2) - (source.x + source.width / 2);
    const dy = (target.y + target.height / 2) - (source.y + source.height / 2);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;

    const from = anchorOn(source, dx, dy);
    const to = anchorOn(target, -dx, -dy);

    const spanX = to.x - from.x;
    const spanY = to.y - from.y;
    const span = Math.hypot(spanX, spanY);

    // Overlapping cards can leave the two anchors on top of each other; a straight stub keeps the
    // marker orientation defined instead of emitting a degenerate curve.
    if (span < 1) {
        return {
            path: `M ${from.x},${from.y} L ${to.x},${to.y}`,
            labelX: (from.x + to.x) / 2,
            labelY: (from.y + to.y) / 2,
        };
    }

    // Perpendicular to the run, always the same way round relative to the direction of travel, so
    // A -> B and B -> A bow to opposite sides instead of overlapping.
    const normalX = -spanY / span;
    const normalY = spanX / span;
    const bow = Math.min(span * BOW_RATIO, MAX_BOW_PX);
    // Control points sit a third and two thirds along, offset by `handle`. A cubic pulled that way
    // deviates by three quarters of the offset at its midpoint, so scale up to land on `bow`.
    const handle = bow * (4 / 3);

    const controlOneX = from.x + spanX / 3 + normalX * handle;
    const controlOneY = from.y + spanY / 3 + normalY * handle;
    const controlTwoX = from.x + (spanX * 2) / 3 + normalX * handle;
    const controlTwoY = from.y + (spanY * 2) / 3 + normalY * handle;

    return {
        path: `M ${from.x},${from.y} C ${controlOneX},${controlOneY} ${controlTwoX},${controlTwoY} ${to.x},${to.y}`,
        labelX: (from.x + to.x) / 2 + normalX * bow,
        labelY: (from.y + to.y) / 2 + normalY * bow,
    };
}
