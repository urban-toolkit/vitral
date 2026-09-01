/**
 * A standing request to open one card's attached file, kept out of React state for the same reason
 * `canvasHighlightStore` is.
 *
 * The panel's open/closed state belongs to the `FilePreview` inside the card — that is where the
 * click is, and nothing outside needed to know about it. Typing `R7F` into the reference box is the
 * one thing that does: the canvas has to travel to R7 *and then* the card, once it exists, has to
 * open the file it holds. Lifting `open` into the editor page would mean threading it through
 * `Card` -> `FileSlot` -> `FilePreview` and re-rendering every card on the canvas whenever any one
 * preview opened, to serve a gesture that happens once.
 *
 * So the request is a fact about the document rather than about the component tree, and it waits:
 * the card is very often not mounted yet when the reference resolves (the level change, the filter
 * reset and the relayout all have to land first), so the request sits here until the right
 * `FilePreview` appears and reads it.
 *
 * It is **not** consumed on arrival. `FilePreview` treats a standing request as one of two reasons a
 * panel is open — the other being a click on the thumbnail — and closing the panel puts both down.
 * Consuming it instead would mean copying the flag into component state from an effect, which is a
 * cascading render and leaves the same boolean recorded in two places; deriving keeps "is it open"
 * answerable from what is already true.
 *
 * Keyed by the owning **card** as well as the file, because one file can be attached to several
 * cards and `R7F` names exactly one of them.
 */
type PreviewRequest = { nodeId: string; fileId: string };

let request: PreviewRequest | null = null;

const listeners = new Set<() => void>();

export function subscribeCardPreview(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function commit(next: PreviewRequest | null) {
    request = next;
    for (const listener of listeners) listener();
}

export function requestCardFilePreview(nodeId: string, fileId: string) {
    if (request !== null && request.nodeId === nodeId && request.fileId === fileId) return;
    commit({ nodeId, fileId });
}

/**
 * Whether this card's preview of this file is the one being asked for.
 *
 * `nodeId` is optional because a `FilePreview` can be rendered outside a card, where there is no
 * owner to match and so nothing a reference could ever have named.
 */
export function isCardFilePreviewRequested(nodeId: string | undefined, fileId: string): boolean {
    if (request === null || nodeId === undefined) return false;
    return request.nodeId === nodeId && request.fileId === fileId;
}

/**
 * Called when the panel is closed, and by any later reference that supersedes this one. Clearing is
 * what lets a reader shut a panel a reference opened — while the request stands, the panel is open.
 */
export function clearCardFilePreviewRequest() {
    if (request === null) return;
    commit(null);
}
