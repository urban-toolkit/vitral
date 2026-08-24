import { createContext, useContext } from "react";

/**
 * The element a card offers its file preview panel to.
 *
 * The panel has to live inside the card's node box so that React Flow's viewport transform carries
 * it: dragging the card drags the panel with it, and zooming scales both together. It cannot be
 * rendered where `FilePreview` sits, though — that is inside a card *face*, and the faces carry
 * `contain: layout paint style`, which clips anything crossing their 200x260 border box (see
 * `Card.module.css`). So `Card` mounts an empty, zero-sized host as a direct child of `.card` — a
 * box with layout and style containment only — and hands it down here for `FileModal` to portal
 * into.
 *
 * `null` means no card is offering one (a `FilePreview` rendered outside a card); `FileModal` falls
 * back to floating over the viewport in that case.
 */
export const CardPreviewDockContext = createContext<HTMLElement | null>(null);

export function useCardPreviewDock() {
    return useContext(CardPreviewDockContext);
}
