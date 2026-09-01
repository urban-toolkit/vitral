import { memo, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { fileRecord } from "@/config/types";

import classes from "./FilePreview.module.css";
import FileModal from "@/components/files/FileModal";
import { FileDocumentView } from "@/components/files/FileDocumentView";
import { resolveRawFileUrl } from "@/components/files/fileUrls";
import { FilePreviewCard } from "@/components/files/FilePreviewCard";
import {
    clearCardFilePreviewRequest,
    isCardFilePreviewRequested,
    subscribeCardPreview,
} from "@/store/cardPreviewStore";

type FilePreviewProps = {
    file: fileRecord;
    /**
     * The card this attachment belongs to, when it belongs to one. Only used to recognise a standing
     * `R7F` request — see `cardPreviewStore`.
     */
    ownerNodeId?: string;
};

/**
 * A card's attachment: the thumbnail on the card front, and the document panel it opens.
 *
 * The renderers, and the fetching and converting behind them, live in `FileDocumentView` — the
 * card's back opens documents too (the source a model-derived card was extracted from) and the two
 * share that machinery. What is left here is the trigger and the open/closed state.
 */
function FilePreviewImpl({ file, ownerNodeId }: FilePreviewProps) {
    const [openedHere, setOpenedHere] = useState(false);

    /**
     * A reference like `R7F` asks for this exact panel, very often before this card is mounted — the
     * level change, the filter reset and the relayout all land first — so the request waits in the
     * store until the preview it names appears.
     *
     * Read as a *second reason to be open* rather than copied into `openedHere` from an effect. The
     * copy would be a setState in an effect (a cascading render, and the lint rule that forbids it is
     * right), and it would need the request cleared on arrival to let the reader close the panel
     * again — leaving two half-truths about one boolean. Deriving instead means closing has exactly
     * one job: put down whichever of the two reasons is holding it open.
     */
    const requested = useSyncExternalStore(
        subscribeCardPreview,
        () => isCardFilePreviewRequested(ownerNodeId, file.id),
    );
    const open = openedHere || requested;

    const isImage = file.mimeType.startsWith("image/");
    const rawUrl = resolveRawFileUrl(file);

    const onClick = useCallback(() => setOpenedHere(true), []);
    const close = useCallback(() => {
        setOpenedHere(false);
        // Only when the standing request is *this* panel's. The store holds one request for the whole
        // canvas, and the panel is deliberately non-modal and docked to its own card — so several can
        // be open at once, and clearing unconditionally would let closing one card's preview close a
        // panel on a card the reader never touched.
        if (requested) clearCardFilePreviewRequest();
    }, [requested]);

    const previewInner = useMemo(() => {
        return (
            <FilePreviewCard
                file={file}
                thumbnailUrl={isImage && rawUrl !== "" ? rawUrl : undefined}
            />
        );
    }, [file, isImage, rawUrl]);

    return (
        <>
            <div
                onClick={onClick}
                className={`${classes.outerPreview} nowheel`}
                title="Click to expand"
            >
                {previewInner}
            </div>

            {/* `FileModal` renders nothing while closed, so the document is not fetched until it is
                actually opened, and closing discards everything it loaded. */}
            <FileModal open={open} onClose={close} title={file.name}>
                <FileDocumentView file={file} />
            </FileModal>
        </>
    );
}

/**
 * Memoised: one of these lives inside every card that holds a file, and it has no reason to re-run
 * when the card around it re-renders for an unrelated reason.
 */
export const FilePreview = memo(FilePreviewImpl);
