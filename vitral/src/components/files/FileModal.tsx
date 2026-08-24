import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import classes from './FileModal.module.css';
import { useCardPreviewDock } from '@/components/cards/cardPreviewDock';

/**
 * The file preview panel, docked to the right edge of the card that opened it.
 *
 * It lives *on* the canvas rather than over it: the panel is portalled into a host element that the
 * opening card exposes through `CardPreviewDock`, so React Flow's viewport transform applies to it
 * like it applies to the card. Dragging the card drags the panel with it, and zooming scales the
 * two together — which is the point, and is what a `position: fixed` overlay could never do.
 *
 * The portal is still needed, just for a shorter hop than before: every one of these is mounted by
 * a `FilePreview` inside a card *face*, and the faces carry `contain: layout paint style`, which
 * clips anything crossing their 200x260 box. The host sits one level up, as a direct child of
 * `.card`, which contains layout and style but deliberately not paint.
 *
 * With no card offering a dock — a `FilePreview` rendered somewhere else — the panel falls back to
 * floating beside the sidebar, portalled into `document.body` as it used to be.
 */
export default function FileModal({
    open,
    onClose,
    title,
    children,
}: {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
}) {
    const dock = useCardPreviewDock();

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;
    if (typeof document === "undefined") return null;

    const host = dock ?? document.body;

    return createPortal(
        <div
            // `nodrag` and `nowheel` are load-bearing now that the panel is inside a node: without
            // them a drag anywhere in the panel would move the card, and a scroll would zoom the
            // canvas instead of the document being read.
            className={`${dock ? classes.dockedPanel : classes.floatingPanel} nodrag nowheel`}
            // Non-modal on purpose: the canvas behind it stays readable and usable, which is the
            // whole point of a docked panel rather than a centred dialog. So no `aria-modal`.
            role="dialog"
            aria-label={title ?? "File preview"}
            // Pointer events must not reach the canvas underneath: `ProjectEditorPage` dismisses its
            // pending menus on any window `pointerdown`, and React Flow starts a node drag from one.
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
        >
            <div className={classes.innerModal}>
                <div
                    className={classes.headerModal}
                >
                    <div
                        className={classes.titleModal}
                        title={title}
                    >
                        {title ?? "Preview"}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className={classes.closeModal}
                    >
                        Close
                    </button>
                </div>

                <div
                    className={classes.contentModal}
                >
                    {children}
                </div>
            </div>
        </div>,
        host,
    );
}
