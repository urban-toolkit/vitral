import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { fileRecord } from "@/config/types";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { NotebookRenderer } from "@/components/cards/NotebookRenderer";

import classes from "./FilePreview.module.css";
import FileModal from "@/components/files/FileModal";
import { FilePreviewCard } from "@/components/files/FilePreviewCard";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { getFileContent } from "@/api/stateApi";
import { resolveApiBaseUrl } from "@/api/baseUrl";

const API_BASE = resolveApiBaseUrl();

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type FilePreviewProps = {
    file: fileRecord;
};

const EMPTY_STR = "";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const RAW_TEXT_FALLBACK_EXTENSIONS = new Set(["tsx", "jsx"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "ogg", "ogv", "avi"]);
const TABULAR_EXTENSIONS = new Set(["csv", "tsv"]);
const TABULAR_MIME_TYPES = new Set(["text/csv", "text/tab-separated-values"]);
const TABULAR_PREVIEW_ROWS = 10;
const PDF_ZOOM_MIN = 0.6;
const PDF_ZOOM_MAX = 2.4;
const PDF_ZOOM_STEP = 0.2;

const customCodeBlockStyle: React.CSSProperties = {
    margin: 0,
    width: "100%",
    minHeight: "100%",
    minWidth: 0,
    boxSizing: "border-box",
};

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
function splitDelimitedRows(content: string, limit: number): { rows: string[]; truncated: boolean } {
    const rows: string[] = [];
    let inQuotes = false;
    let start = 0;

    for (let i = 0; i < content.length; i++) {
        const char = content[i];

        if (char === '"') {
            // A doubled quote is an escaped quote: toggling twice leaves the state unchanged.
            inQuotes = !inQuotes;
            continue;
        }

        if (inQuotes || (char !== "\n" && char !== "\r")) continue;

        rows.push(content.slice(start, i));
        if (char === "\r" && content[i + 1] === "\n") i++;
        start = i + 1;

        if (rows.length >= limit) {
            return { rows, truncated: content.slice(start).trim().length > 0 };
        }
    }

    const lastRow = content.slice(start);
    if (lastRow.length > 0) rows.push(lastRow);

    return { rows, truncated: false };
}

function normalizeNotebook(notebook: unknown) {
    if (!notebook || typeof notebook !== "object") return null;

    const parsed = notebook as Record<string, unknown>;
    if (Array.isArray(parsed.cells)) return parsed;

    const worksheets = Array.isArray(parsed.worksheets)
        ? (parsed.worksheets as Array<Record<string, unknown>>)
        : [];
    const cells = worksheets.flatMap((worksheet) => (
        Array.isArray(worksheet.cells) ? worksheet.cells : []
    ));

    return { ...parsed, cells };
}

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

export function FilePreview({ file }: FilePreviewProps) {
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

    const notebookJson = useMemo(() => {
        if (!isIpynb || !loadedContent) return null;
        try {
            const parsed = JSON.parse(loadedContent);
            return normalizeNotebook(parsed);
        } catch {
            return null;
        }
    }, [isIpynb, loadedContent]);

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
            const basePageWidth = clamp(Math.floor(window.innerWidth * 0.8), 520, 1000);
            const pageWidth = Math.max(180, Math.floor(basePageWidth * pdfZoom));
            const zoomPercent = Math.round(pdfZoom * 100);

            return (
                <div className={classes.modalPdfWrap}>
                    <div className={classes.modalPdfScroll}>
                        <Document
                            file={pdfBlobUrl}
                            onLoadSuccess={(info) => setPdfNumPages(info.numPages)}
                            loading={<LoadSpinner loading={true} />}
                            error={<div className={classes.loadError}>Could not load PDF.</div>}
                        >
                            {Array.from({ length: pdfNumPages || 0 }, (_, i) => (
                                <div key={i} className={classes.modalPdfPage}>
                                    <Page
                                        pageNumber={i + 1}
                                        width={pageWidth}
                                        renderTextLayer={false}
                                        renderAnnotationLayer={false}
                                    />
                                </div>
                            ))}
                        </Document>
                    </div>
                    <div className={classes.pdfZoomControls}>
                        <button
                            type="button"
                            className={classes.pdfZoomButton}
                            onClick={() => setPdfZoom((current) => clamp(current - PDF_ZOOM_STEP, PDF_ZOOM_MIN, PDF_ZOOM_MAX))}
                            disabled={pdfZoom <= PDF_ZOOM_MIN}
                            aria-label="Zoom out PDF"
                            title="Zoom out"
                        >
                            -
                        </button>
                        <span className={classes.pdfZoomValue}>{zoomPercent}%</span>
                        <button
                            type="button"
                            className={classes.pdfZoomButton}
                            onClick={() => setPdfZoom((current) => clamp(current + PDF_ZOOM_STEP, PDF_ZOOM_MIN, PDF_ZOOM_MAX))}
                            disabled={pdfZoom >= PDF_ZOOM_MAX}
                            aria-label="Zoom in PDF"
                            title="Zoom in"
                        >
                            +
                        </button>
                    </div>
                </div>
            );
        }

        if (isMarkdown || isDocx) {
            return (
                <div className={classes.modalMarkdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {loadedContent ?? EMPTY_STR}
                    </ReactMarkdown>
                </div>
            );
        }

        if (isIpynb) {
            return notebookJson ? (
                <div className={classes.modalNotebook}>
                    <NotebookRenderer ipynb={notebookJson} compact={false} />
                </div>
            ) : (
                <div className={classes.loadError}>Could not parse notebook JSON.</div>
            );
        }

        const content = loadedContent ?? EMPTY_STR;
        // Datasets can be huge, so only the header plus the first rows are rendered.
        const tabular = isTabular ? splitDelimitedRows(content, TABULAR_PREVIEW_ROWS + 1) : null;

        const highlighter = (
            <div className={classes.outerSyntaxHighlighter}>
                <SyntaxHighlighter
                    style={oneDark}
                    language={lang}
                    wrapLongLines={true}
                    customStyle={customCodeBlockStyle}
                >
                    {tabular ? tabular.rows.join("\n") : content}
                </SyntaxHighlighter>
            </div>
        );

        if (!tabular?.truncated) return highlighter;

        return (
            <div className={classes.modalTabular}>
                <div className={classes.tabularNotice}>
                    Showing the first {TABULAR_PREVIEW_ROWS} rows of this file.
                </div>
                {highlighter}
            </div>
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
        notebookJson,
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
                {modalInner}
            </FileModal>
        </>
    );
}
