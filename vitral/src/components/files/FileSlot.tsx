import { memo } from "react";

import type { fileRecord } from "@/config/types";

import classes from "./FileSlot.module.css";
import { FilePreview } from "@/components/files/FilePreview";

/**
 * The single file a card can hold, or `children` (the drop zone) when it holds none.
 *
 * This replaces the old carousel: a card carries at most one attachment now, so there is nothing
 * to page through and the slot either previews the file or offers to accept one.
 */
type FileSlotProps = {
    file: fileRecord | null;
    children?: React.ReactNode;
    onRemoveFile?: (fileId: string) => void;
};

/**
 * `children` is left out of the comparison whenever a file is present, because that branch does not
 * render it — and the caller builds a fresh drop-zone element on every render, which would otherwise
 * defeat the memo for every card that has an attachment. Those are the expensive ones: the file
 * branch mounts `FilePreview`.
 */
function areFileSlotPropsEqual(prev: FileSlotProps, next: FileSlotProps) {
    if (prev.file !== next.file || prev.onRemoveFile !== next.onRemoveFile) return false;
    if (next.file) return true;
    return prev.children === next.children;
}

function FileSlotImpl({
    file,
    children,
    onRemoveFile,
}: FileSlotProps) {
    if (!file) {
        return <div className={classes.slot}>{children}</div>;
    }

    return (
        <div className={classes.slot}>
            {onRemoveFile ? (
                <button
                    type="button"
                    className={classes.removeFileButton}
                    title={`Detach ${file.name}`}
                    onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onRemoveFile(file.id);
                    }}
                >
                    x
                </button>
            ) : null}
            <FilePreview file={file} />
        </div>
    );
}

export const FileSlot = memo(FileSlotImpl, areFileSlotPropsEqual);
