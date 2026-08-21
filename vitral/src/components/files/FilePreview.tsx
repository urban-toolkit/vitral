import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useState } from "react";
import type { fileRecord } from "@/config/types";

/*
 * Every card that holds a file mounts one of these, but only an opened file needs a renderer.
 * Importing `react-pdf`, `pdfjs-dist`, Prism and `react-markdown` statically put all four in the
 * canvas chunk — and `react-pdf` sets a global worker URL at import time — so each renderer is now
 * fetched on first use instead.
 */
const MarkdownView = lazy(() => import("@/components/files/preview/MarkdownView"));
const CodeView = lazy(() => import("@/components/files/preview/CodeView"));
const PdfView = lazy(() => import("@/components/files/preview/PdfView"));
const NotebookView = lazy(() => import("@/components/files/preview/NotebookView"));

import classes from "./FilePreview.module.css";
import FileModal from "@/components/files/FileModal";
import { FilePreviewCard } from "@/components/files/FilePreviewCard";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { getFileContent } from "@/api/stateApi";
import { resolveApiBaseUrl } from "@/api/baseUrl";

const API_BASE = resolveApiBaseUrl();

type FilePreviewProps = {
    file: fileRecord;
};

const EMPTY_STR = "";
const RAW_TEXT_FALLBACK_EXTENSIONS = new Set(["tsx", "jsx"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogg", "ogv", "avi"]);
const TABULAR_EXTENSIONS = new Set(["csv", "tsv"]);
const TABULAR_MIME_TYPES = new Set(["text/csv", "text/tab-separated-values"]);
const TABULAR_PREVIEW_ROWS = 10;

function normalizeExt(ext: string) {
    return (ext || "").toLowerCase().replace(/^\./, "");
}

function normalizeLang(ext: string) {
    switch (ext) {
        case "txt":
            return "text";
        case "md":
            return "markdown";
        case "py":
            return "python";
        case "ipynb":
            return "json";
        case "csv":
            return "text";
        case "js":
            return "javascript";
        case "ts":
            return "typescript";
        case "tsx":
            return "tsx";
        case "jsx":
            return "jsx";
        default:
            return ext || "text";
    }
}

/**
 * Splits delimited text into rows, keeping quoted fields (which may span newlines) intact.
 * Stops as soon as `limit` rows are collected so large datasets are never walked in full.
 */

async function fetchFileContent(docId: string, fileId: string): Promise<string> {
    const data = await getFileContent(docId, fileId);
    return data.content ?? "";
}

async function fetchRawBlob(docId: string, fileId: string): Promise<Blob> {
    const response = await fetch(`${API_BASE}/state/${docId}/files/${fileId}/raw`, {
        method: "GET",
        credentials: "include",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to fetch raw file content.");
    }

    return await response.blob();
}

async function fetchRawText(docId: string, fileId: string): Promise<string> {
    const blob = await fetchRawBlob(docId, fileId);
    return await blob.text();
}

async function convertDocxToMarkdown(blob: Blob, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", blob, filename);
    formData.append("from_formats", JSON.stringify(["docx"]));

    const response = await fetch(`${API_BASE}/docling/convert/file`, {
        method: "POST",
        body: formData,
        credentials: "include",
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to convert DOCX preview.");
    }

    const payload = await response.json() as { content?: string };
    return typeof payload.content === "string" ? payload.content : "";
}

function FilePreviewImpl({ file }: FilePreviewProps) {
    const ext = normalizeExt(file.ext || "");
    const lang = normalizeLang(ext);
    const resolvedDocId = typeof file.docId === "string" ? file.docId.trim() : "";
    const hasValidDocId = resolvedDocId.length > 0 && resolvedDocId !== "undefined";

    const isImage = file.mimeType.startsWith("image/");
    const isPdf = file.mimeType === "application/pdf" || ext === "pdf";
    const isMarkdown = ext === "md" || file.mimeType === "text/markdown";
    const isIpynb = ext === "ipynb";
    const isDocx = ext === "docx" || file.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const isVideo = file.mimeType.startsWith("video/") || VIDEO_EXTENSIONS.has(ext);
    const isTabular = TABULAR_EXTENSIONS.has(ext) || TABULAR_MIME_TYPES.has(file.mimeType);

    const [open, setOpen] = useState(false);
    const [pdfNumPages, setPdfNumPages] = useState(0);
    const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
    const [pdfZoom, setPdfZoom] = useState(1);
    const [loading, setLoading] = useState(false);
    const [loadedContent, setLoadedContent] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const rawUrl = useMemo(() => {
        if (!hasValidDocId) return "";
        return `${API_BASE}/state/${resolvedDocId}/files/${file.id}/raw`;
    }, [hasValidDocId, resolvedDocId, file.id]);

    const onClick = () => {
        setOpen(true);
    };

    const close = useCallback(() => {
        setOpen(false);
        setLoadedContent(null);
        setLoadError(null);
        setLoading(false);
        setPdfNumPages(0);
        setPdfZoom(1);
        setPdfBlobUrl((current) => {
            if (current) URL.revokeObjectURL(current);
            return null;
        });
    }, []);

    useEffect(() => {
        return () => {
            if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
        };
    }, [pdfBlobUrl]);

    useEffect(() => {
        if (!open) return;
        if (isImage || isVideo) {
            setLoading(false);
            setLoadError(null);
            setLoadedContent(null);
            setPdfNumPages(0);
            return;
        }

        let cancelled = false;

        const loadPreview = async () => {
            setLoading(true);
            setLoadError(null);
            setLoadedContent(null);
            setPdfNumPages(0);
            setPdfZoom(1);

            try {
                if (!hasValidDocId) {
                    throw new Error("Missing document id for this file. Reload the project and try again.");
                }

                if (isPdf) {
                    const blob = await fetchRawBlob(resolvedDocId, file.id);
                    if (cancelled) return;

                    const nextUrl = URL.createObjectURL(blob);
                    setPdfBlobUrl((current) => {
                        if (current) URL.revokeObjectURL(current);
                        return nextUrl;
                    });
                    return;
                }

                if (isDocx) {
                    const blob = await fetchRawBlob(resolvedDocId, file.id);
                    if (cancelled) return;

                    const markdown = await convertDocxToMarkdown(blob, file.name);
                    if (cancelled) return;

                    setLoadedContent(markdown);
                    return;
                }

                try {
                    const content = await fetchFileContent(resolvedDocId, file.id);
                    if (cancelled) return;
                    setLoadedContent(content);
                } catch (error) {
                    if (!RAW_TEXT_FALLBACK_EXTENSIONS.has(ext) && !isIpynb) {
                        throw error;
                    }

                    const rawText = await fetchRawText(resolvedDocId, file.id);
                    if (cancelled) return;
                    setLoadedContent(rawText);
                }
            } catch (error: any) {
                if (cancelled) return;
                setLoadError(error?.message ?? "Failed to load file.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadPreview();

        return () => {
            cancelled = true;
        };
    }, [open, ext, resolvedDocId, hasValidDocId, file.id, file.name, isDocx, isImage, isIpynb, isPdf, isVideo]);

    const previewInner = useMemo(() => {
        return (
            <FilePreviewCard
                file={file}
                thumbnailUrl={isImage && hasValidDocId ? rawUrl : undefined}
            />
        );
    }, [file, isImage, hasValidDocId, rawUrl]);

    const modalInner = useMemo(() => {
        if (loading) return <LoadSpinner loading={true} />;
        if (loadError) return <div className={classes.loadError}>{loadError}</div>;

        if (isImage) {
            if (!hasValidDocId) {
                return <div className={classes.loadError}>Missing document id for this file.</div>;
            }
            return (
                <div className={classes.modalImageWrap}>
                    <img
                        src={rawUrl}
                        alt={file.name}
                        className={classes.modalImage}
                    />
                </div>
            );
        }

        if (isVideo) {
            if (!hasValidDocId) {
                return <div className={classes.loadError}>Missing document id for this file.</div>;
            }
            return (
                <div className={classes.modalVideoWrap}>
                    <video
                        className={classes.modalVideo}
                        src={rawUrl}
                        controls
                        muted
                        autoPlay
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                            event.currentTarget.muted = true;
                            event.currentTarget.volume = 0;
                        }}
                        onVolumeChange={(event) => {
                            if (event.currentTarget.muted && event.currentTarget.volume === 0) return;
                            event.currentTarget.muted = true;
                            event.currentTarget.volume = 0;
                        }}
                    />
                </div>
            );
        }

        if (isPdf) {
            if (!pdfBlobUrl) return null;
            return (
                <PdfView
                    blobUrl={pdfBlobUrl}
                    numPages={pdfNumPages}
                    zoom={pdfZoom}
                    onNumPages={setPdfNumPages}
                    onZoomChange={setPdfZoom}
                />
            );
        }

        if (isMarkdown || isDocx) {
            return <MarkdownView content={loadedContent ?? EMPTY_STR} />;
        }

        if (isIpynb) {
            return <NotebookView content={loadedContent} />;
        }

        return (
            <CodeView
                content={loadedContent ?? EMPTY_STR}
                language={lang}
                tabularRowLimit={isTabular ? TABULAR_PREVIEW_ROWS : null}
            />
        );
    }, [
        file.name,
        isDocx,
        isImage,
        isIpynb,
        isMarkdown,
        isPdf,
        isTabular,
        isVideo,
        lang,
        loadError,
        loadedContent,
        loading,
        pdfBlobUrl,
        pdfNumPages,
        pdfZoom,
        rawUrl,
        hasValidDocId,
    ]);

    return (
        <>
            <div
                onClick={onClick}
                className={`${classes.outerPreview} nowheel`}
                title="Click to expand"
            >
                {previewInner}
            </div>

            <FileModal open={open} onClose={close} title={file.name}>
                {/* One boundary for all four renderers: only one is ever mounted at a time. */}
                <Suspense fallback={<LoadSpinner loading={true} />}>
                    {modalInner}
                </Suspense>
            </FileModal>
        </>
    );
}

/**
 * Memoised: one of these lives inside every card that holds a file, and its own body carries seven
 * pieces of state and four memos. It has no reason to re-run when the card around it re-renders for
 * an unrelated reason.
 */
export const FilePreview = memo(FilePreviewImpl);
