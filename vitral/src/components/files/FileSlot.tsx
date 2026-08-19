import type { fileRecord } from "@/config/types";

import classes from "./FileSlot.module.css";
import { FilePreview } from "@/components/files/FilePreview";

/**
 * The single file a card can hold, or `children` (the drop zone) when it holds none.
 *
 * This replaces the old carousel: a card carries at most one attachment now, so there is nothing
 * to page through and the slot either previews the file or offers to accept one.
 */
export function FileSlot({
    file,
    children,
    onRemoveFile,
}: {
    file: fileRecord | null;
    children?: React.ReactNode;
    onRemoveFile?: (fileId: string) => void;
}) {
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
