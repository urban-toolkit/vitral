import { useMemo, useState } from "react";
import styles from "./AssetsPanel.module.css";
import type { fileRecord } from "@/config/types";

type Props = {
    records: fileRecord[];
    title?: string;
    className?: string;
    onAssetHover?: (fileId: string | null) => void;
    deletingFileId?: string | null;
    onDeleteAsset?: (file: fileRecord) => void;
};

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
    }
    const rounded = i === 0 ? `${Math.round(v)}` : v.toFixed(v < 10 ? 2 : 1);
    return `${rounded} ${units[i]}`;
}

function safeDateLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || "—";
    return d.toLocaleString();
}

export default function AssetsPanel({
    records,
    title = "Assets",
    className,
    onAssetHover,
    deletingFileId,
    onDeleteAsset,
}: Props) {
    const [query] = useState("");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return records;
        return records.filter((r) => {
            const hay = [
                r.name,
                r.ext,
                r.mimeType,
                r.id,
                r.docId,
                r.sha256 ?? "",
                r.storage?.bucket ?? "",
                r.storage?.key ?? "",
            ]
                .join(" ")
                .toLowerCase();
            return hay.includes(q);
        });
    }, [records, query]);

    return (
        <div className={`${styles.panel} ${className ?? ""}`}>
            <div className={styles.header}>
                <div className={styles.titleRow}>
                    <h3 className={styles.title}>{title}</h3>
                    <span className={styles.count}>{filtered.length}</span>
                </div>
            </div>

            <div className={styles.list} role="list">
                {filtered.length === 0 ? (
                    <div className={styles.empty}>No assets found.</div>
                ) : (
                    filtered.map((r) => (
                        <div
                            key={r.id}
                            className={styles.card}
                            onMouseEnter={() => onAssetHover?.(r.id)}
                            onMouseLeave={() => onAssetHover?.(null)}
                        >
                            <div className={styles.cardTop}>
                                <span className={styles.name} title={r.name}>{r.name}</span>
                                <div className={styles.cardActions}>
                                    
                                    {onDeleteAsset ? (
                                        <button
                                            type="button"
                                            className={styles.deleteButton}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onDeleteAsset(r);
                                            }}
                                            disabled={deletingFileId === r.id}
                                            aria-label={`Delete ${r.name}`}
                                            title={`Delete ${r.name}`}
                                        >
                                            {deletingFileId === r.id ? "Deleting..." : "Delete"}
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <div className={styles.metaGrid}>
                                <div className={styles.metaRow}>
                                    <span className={styles.metaKey}>Size</span>
                                    <span className={styles.metaVal}>{formatBytes(r.sizeBytes)}</span>
                                </div>

                                <div className={styles.metaRow}>
                                    <span className={styles.metaKey}>MIME</span>
                                    <span className={styles.metaVal} title={r.mimeType}>
                                        {r.mimeType || "—"}
                                    </span>
                                </div>

                                <div className={styles.metaRow}>
                                    <span className={styles.metaKey}>Created</span>
                                    <span className={styles.metaVal} title={r.createdAt}>
                                        {safeDateLabel(r.createdAt)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
