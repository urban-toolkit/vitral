import { memo } from "react";

import type { fileRecord } from "@/config/types";
import classes from "./FilePreviewCard.module.css";

function formatBytes(bytes?: number) {
    if (bytes == null || Number.isNaN(bytes)) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function isImage(mimeType: string, ext?: string) {
    if (mimeType?.startsWith("image/")) return true;
    return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes((ext ?? "").toLowerCase());
}

type Props = {
    file: fileRecord;
    onClick?: (fileId: string) => void;
    thumbnailUrl?: string;
};

function FilePreviewCardImpl({
    file,
    onClick,
    thumbnailUrl,
}: Props) {
    const image = isImage(file.mimeType, file.ext);

    return (
        <button
            type="button"
            onClick={() => onClick?.(file.id)}
            className={[
                classes.card,
            ].join(" ")}
        >
            {/* Left */}
            <div className={classes.left}>
                <div className={classes.thumb}>
                    {image && thumbnailUrl ? (
                        <img
                            src={thumbnailUrl}
                            alt=""
                            className={classes.thumbImage}
                            loading="lazy"
                            /* `thumbnailUrl` is the raw original, so a large attachment is decoded at
                               full resolution for a 48x48 box and re-sampled by the compositor at
                               every new zoom scale. Declaring the box removes the layout ambiguity
                               and takes the decode off the critical path; a real thumbnail endpoint
                               is the actual fix. */
                            width={48}
                            height={48}
                            decoding="async"
                        />
                    ) : (
                        <span className={classes.extBadge}>
                            {(file.ext || "file").toUpperCase()}
                        </span>
                    )}
                </div>
            </div>

            {/* Right */}
            <div className={classes.body}>
                <div className={classes.header}>
                    <div className={classes.titleWrap}>
                        <div className={classes.title}>{file.name}</div>
                        <div className={classes.mime}>{file.mimeType || "—"}</div>
                    </div>
                </div>

                <div className={classes.metaGrid}>
                    <div className={classes.metaLabel}>Size</div>
                    <div className={classes.metaValue}>
                        {formatBytes(file.sizeBytes)}
                    </div>

                    <div className={classes.metaLabel}>Created</div>
                    <div className={classes.metaValue}>
                        {formatDate(file.createdAt)}
                    </div>

                </div>

                <div className={classes.footer}>
                    <span className={classes.hint}>Click to open</span>
                </div>
            </div>
        </button>
    );
}

/** Memoised: this is what actually paints inside a card, including the thumbnail image. */
export const FilePreviewCard = memo(FilePreviewCardImpl);
