import { useRef, useState, type DragEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faChevronUp, faPlus } from "@fortawesome/free-solid-svg-icons";
import styles from "./SystemScreenshotPanel.module.css";

type SystemScreenshotPanelProps = {
    rightOffsetPx: number;
    latestImageDataUrl: string;
    processing: boolean;
    readOnly?: boolean;
    onAddMarker: () => void;
    onUploadForLatestMarker: (file: File) => Promise<void> | void;
};

export function SystemScreenshotPanel({
    rightOffsetPx,
    latestImageDataUrl,
    processing,
    readOnly = false,
    onAddMarker,
    onUploadForLatestMarker,
}: SystemScreenshotPanelProps) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [collapsed, setCollapsed] = useState(false);
    const [draggingOver, setDraggingOver] = useState(false);

    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;
        const file = files[0];
        if (!file.type.startsWith("image/")) return;
        await onUploadForLatestMarker(file);
    };

    return (
        <div className={styles.root} style={{ right: rightOffsetPx }}>
            {processing ? (
                <div className={styles.loadingIndicator} aria-label="Processing screenshot">
                    <span className={styles.loadingSpinner} />
                </div>
            ) : null}
            <div className={styles.header}>
                <button
                    type="button"
                    className={styles.iconButton}
                    title={collapsed ? "Expand panel" : "Collapse panel"}
                    onClick={() => setCollapsed((previous) => !previous)}
                >
                    <FontAwesomeIcon icon={collapsed ? faChevronDown : faChevronUp} />
                </button>
                <p className={styles.title}>System screenshot</p>
                <button
                    type="button"
                    className={styles.iconButton}
                    title="Create new system version marker"
                    disabled={readOnly}
                    onClick={() => {
                        if (readOnly) return;
                        onAddMarker();
                        inputRef.current?.click();
                    }}
                >
                    <FontAwesomeIcon icon={faPlus} />
                </button>
            </div>

            {!collapsed ? (
                <div
                    className={`${styles.dropZone} ${draggingOver ? styles.dropZoneActive : ""} ${readOnly ? styles.dropZoneReadOnly : ""}`}
                    onClick={() => {
                        if (readOnly) return;
                        inputRef.current?.click();
                    }}
                    onDragEnter={(event) => {
                        if (readOnly) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingOver(true);
                    }}
                    onDragOver={(event) => {
                        if (readOnly) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingOver(true);
                        if (event.dataTransfer) {
                            event.dataTransfer.dropEffect = "copy";
                        }
                    }}
                    onDragLeave={(event) => {
                        if (readOnly) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingOver(false);
                    }}
                    onDrop={(event: DragEvent<HTMLDivElement>) => {
                        if (readOnly) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setDraggingOver(false);
                        void handleFiles(event.dataTransfer.files);
                    }}
                >
                    {latestImageDataUrl ? (
                        <img
                            src={latestImageDataUrl}
                            alt="Latest system screenshot"
                            className={styles.preview}
                        />
                    ) : (
                        <p className={styles.placeholder}>
                            Drop image here.
                        </p>
                    )}
                </div>
            ) : null}

            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.target.value = "";
                }}
            />
        </div>
    );
}
