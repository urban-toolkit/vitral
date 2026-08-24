import { memo, useCallback, useMemo, useState } from "react";
import type { fileRecord } from "@/config/types";

import classes from "./FilePreview.module.css";
import FileModal from "@/components/files/FileModal";
import { FileDocumentView } from "@/components/files/FileDocumentView";
import { resolveRawFileUrl } from "@/components/files/fileUrls";
import { FilePreviewCard } from "@/components/files/FilePreviewCard";

type FilePreviewProps = {
    file: fileRecord;
};

/**
 * A card's attachment: the thumbnail on the card front, and the document panel it opens.
 *
 * The renderers, and the fetching and converting behind them, live in `FileDocumentView` — the
 * card's back opens documents too (the source a model-derived card was extracted from) and the two
 * share that machinery. What is left here is the trigger and the open/closed state.
 */
function FilePreviewImpl({ file }: FilePreviewProps) {
    const [open, setOpen] = useState(false);

    const isImage = file.mimeType.startsWith("image/");
    const rawUrl = resolveRawFileUrl(file);

    const onClick = useCallback(() => setOpen(true), []);
    const close = useCallback(() => setOpen(false), []);

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
