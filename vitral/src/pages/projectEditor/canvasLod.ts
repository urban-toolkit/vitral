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
 *   - `near` (>= 0.55): 110px and up. The chrome renders at 5-7px, which is small but still tells
 *     you what kind of card this is and whether it carries a file. A card keeps it until that
 *     stops being true — not as soon as it stops being comfortable to read.
 *   - `mid` (0.18-0.55): 36-110px. Only the title is drawn.
 *   - `far` (< 0.18): under 36px, which puts the 16px title under 3px. Nothing inside carries
 *     information any more — the card is a coloured box.
 *
 * **The boundaries are symmetric: there is no hysteresis.** A tier flips at exactly the same zoom
 * whichever direction the gesture is going, because a Schmitt trigger here is invisible in the UI
 * and reads as the threshold moving on its own — zoom out past the point where the card simplifies,
 * zoom back the same amount, and nothing comes back. Flicker is not a real risk: the tier is one
 * DOM attribute write, and either crossing costs a single style recalculation.
 *
 * The live boundaries are 0.550 (near<->mid) and 0.180 (mid<->far). With follow-zoom on, both sit
 * *below* `levelForZoom`'s Detail boundary (0.850), so on that path a card is never simplified in
 * place — the abstraction takes over first and the cards become glyphs. That is the deliberate
 * order, and it is written out in full in the `levelForZoom` docblock in `canvasAbstraction.ts` —
 * read it before retuning either set.
 */
export type CanvasLod = "near" | "mid" | "far";

export const ZOOM_LOD_NEAR_MIN = 0.55;
export const ZOOM_LOD_FAR_MAX = 0.18;

export function lodForZoom(zoom: number, current: CanvasLod): CanvasLod {
    if (!Number.isFinite(zoom) || zoom <= 0) return current;
    if (zoom <= ZOOM_LOD_FAR_MAX) return "far";
    if (zoom < ZOOM_LOD_NEAR_MIN) return "mid";
    return "near";
}
