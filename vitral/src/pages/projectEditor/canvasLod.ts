/**
 * Level of detail for a card's *interior*, as a function of the zoom alone.
 *
 * A deliberate sibling of `levelForZoom` in `canvasAbstraction.ts`, on a different axis. That one
 * changes *what* is on the canvas — node identity, node count, layout — and so costs a render, a
 * Redux read and a relayout. This one changes only *how each surviving box paints*: it is applied as
 * a DOM attribute written from the pan/zoom animation frame through a ref (see `useCanvasLod`), so a
 * whole zoom sweep costs two attribute writes and no React work at all.
 *
 * The tiers are drawn by usability, not by legibility. A card is 200x260 (`canvasGeometry.ts`), its
 * title is 16px and its chrome 9-12px (`typography.css`):
 *   - `near` (>= 1.00): the card is full size or larger, so all of its chrome is comfortably usable.
 *   - `mid` (0.38-1.00): 76-200px. The chrome renders at 3-12px, below the point where it is worth
 *     reading or worth hitting, so only the title is drawn.
 *   - `far` (< 0.38): under 76px, which puts the title itself under 6px. Nothing inside carries
 *     information any more — the card is a coloured box.
 *
 * Hysteresis is multiplicative for the same reason as in `levelForZoom`: zoom is geometric, so a
 * ratio band is a constant number of wheel notches at every scale.
 *
 * The live boundaries are 1.250 / 0.800 (near<->mid) and 0.475 / 0.304 (mid<->far). With follow-zoom
 * on they interleave with `levelForZoom`'s (1.013 / 0.556 and 0.432 / 0.237); only the two above 0.556
 * are ever visible, because below that the canvas is showing glyphs, which carry no level-of-detail
 * rules. The combined ladder is written out in the `levelForZoom` docblock in `canvasAbstraction.ts`
 * — read it before retuning either set.
 */
export type CanvasLod = "near" | "mid" | "far";

export const ZOOM_LOD_NEAR_MIN = 1.0;
export const ZOOM_LOD_FAR_MAX = 0.38;
const ZOOM_LOD_HYSTERESIS = 1.25;

export function lodForZoom(zoom: number, current: CanvasLod): CanvasLod {
    if (!Number.isFinite(zoom) || zoom <= 0) return current;
    if (current === "far") return zoom > ZOOM_LOD_FAR_MAX * ZOOM_LOD_HYSTERESIS ? "mid" : "far";
    if (current === "near") return zoom < ZOOM_LOD_NEAR_MIN / ZOOM_LOD_HYSTERESIS ? "mid" : "near";
    if (zoom < ZOOM_LOD_FAR_MAX / ZOOM_LOD_HYSTERESIS) return "far";
    if (zoom > ZOOM_LOD_NEAR_MIN * ZOOM_LOD_HYSTERESIS) return "near";
    return "mid";
}
