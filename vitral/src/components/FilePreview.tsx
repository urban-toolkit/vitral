// FilePreview.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { fileData } from "@/config/types";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { NotebookRenderer } from "@/components/NotebookRenderer";

// react-pdf worker 
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.js",
    import.meta.url
).toString();

type FilePreviewProps = {
    file: fileData;
};

const EMPTY_STR = "";
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function normalizeExt(ext: string) {
    const e = (ext || "").toLowerCase().replace(/^\./, "");
    return e;
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
        default:
            return ext || "text";
    }
}

function getRenderableUrl(file: fileData): string | undefined {

    const mt = file.mimeType || "";

    if (file.mimeType.startsWith("image/")) {
        return `data:${mt};base64,${file.content.replace(/\s/g, "")}`;
    }

    return undefined;
}

function Modal({
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
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            onMouseDown={onClose}
            style={{
                position: "fixed",
                inset: 0,
                zIndex: 100000,
                background: "rgba(0,0,0,0.55)",
                display: "grid",
                placeItems: "center",
                padding: 16,
            }}
        >
            <div
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    width: "min(1100px, 95vw)",
                    height: "min(900px, 92vh)",
                    background: "white",
                    borderRadius: 14,
                    boxShadow: "0 18px 60px rgba(0,0,0,0.35)",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        flex: "0 0 auto",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "10px 12px",
                        borderBottom: "1px solid rgba(0,0,0,0.10)",
                    }}
                >
                    <div
                        style={{
                            fontSize: 13,
                            fontWeight: 600,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                        }}
                        title={title}
                    >
                        {title ?? "Preview"}
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: "rgba(255,255,255,0.9)",
                            borderRadius: 10,
                            padding: "6px 10px",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        Close
                    </button>
                </div>

                <div
                    style={{
                        flex: "1 1 auto",
                        overflow: "auto",
                        padding: 14,
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}

export function FilePreview({ file }: FilePreviewProps) {
    const ext = normalizeExt(file.ext || "");
    const lang = normalizeLang(ext);

    const isImage = file.mimeType.startsWith("image/");
    const isPdf = file.mimeType === "application/pdf" || ext === "pdf";
    const isMarkdown = ext === "md" || file.mimeType === "text/markdown";
    const isIpynb = ext === "ipynb";

    const renderUrl = useMemo(() => getRenderableUrl(file), [file]);

    const [open, setOpen] = useState(false);

    const [pdfNumPages, setPdfNumPages] = useState(0);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect?.width ?? 0;
            setContainerWidth(w);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const onClick = () => {
        setOpen(true);
    }

    const close = useCallback(() => setOpen(false), []);

    const textContent = !file.mimeType.startsWith("image/") ? file.content : "";

    const notebookJson = useMemo(() => {
        if (!isIpynb) return null;

        if (file.mimeType.startsWith("image/")) return null;

        try {
            return JSON.parse(file.content);
        } catch {
            return null;
        }
    }, [file, isIpynb]);

    const PreviewInner = useMemo(() => {
        // PNG / Images
        if (isImage) {
            if (!renderUrl) {
                return (
                    <div style={{ padding: 10, fontSize: 12 }}>
                        Image preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
                    </div>
                );
            }
            return (
                <img
                    src={renderUrl}
                    alt={file.name}
                    style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                />
            );
        }

        // PDF
        if (isPdf) {
            if (!renderUrl) {
                return (
                    <div style={{ padding: 10, fontSize: 12 }}>
                        PDF preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
                    </div>
                );
            }
            return (
                <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
                    <Document
                        file={renderUrl}
                        onLoadSuccess={(info) => setPdfNumPages(info.numPages)}
                        loading={<div style={{ padding: 10, fontSize: 12 }}>Loading PDF…</div>}
                        error={<div style={{ padding: 10, fontSize: 12 }}>Could not load PDF.</div>}
                    >
                        <Page
                            pageNumber={1}
                            width={containerWidth ? Math.floor(containerWidth) : undefined}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                        />
                    </Document>
                </div>
            );
        }

        // Markdown
        if (isMarkdown) {
            return (
                <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 10, boxSizing: "border-box" }}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code({ className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || "");
                                const codeLang = match?.[1] ?? "text";

                                return (
                                    <SyntaxHighlighter style={oneDark} language={codeLang}>
                                        {String(children).replace(/\n$/, "")}
                                    </SyntaxHighlighter>
                                );
                            },
                        }}
                    >
                        {!file.mimeType.startsWith("image/") ? file.content : EMPTY_STR}
                    </ReactMarkdown>
                </div>
            );
        }

        // Jupyter Notebook
        if (isIpynb) {
            if (!notebookJson) {
                return (
                    <div style={{ padding: 10, fontSize: 12 }}>
                        Notebook preview expects JSON text (<code>contentKind: "text"</code>). If you store notebooks as base64, decode upstream.
                    </div>
                );
            }
            return (
                <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
                    <NotebookRenderer ipynb={notebookJson} compact={false} />
                </div>
            );
        }

        return (
            <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
                <SyntaxHighlighter
                    language={lang}
                    style={oneDark}
                    customStyle={{
                        margin: 0,
                        width: "100%",
                        minHeight: "100%",
                        boxSizing: "border-box",
                    }}
                >
                    {textContent || EMPTY_STR}
                </SyntaxHighlighter>
            </div>
        );
    }, [containerWidth, file, isImage, isIpynb, isMarkdown, isPdf, lang, notebookJson, renderUrl, textContent]);

    const ModalInner = useMemo(() => {
        // Image
        if (isImage) {
            return renderUrl ? (
                <img src={renderUrl} alt={file.name} style={{ width: "100%", height: "auto", display: "block" }} />
            ) : (
                <div style={{ fontSize: 12 }}>
                    Image preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
                </div>
            );
        }

        // PDF: render all pages
        if (isPdf) {
            if (!renderUrl) {
                return (
                    <div style={{ fontSize: 12 }}>
                        PDF preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
                    </div>
                );
            }

            const modalPageWidth = clamp(Math.floor(window.innerWidth * 0.8), 520, 1000);

            return (
                <Document
                    file={renderUrl}
                    onLoadSuccess={(info) => setPdfNumPages(info.numPages)}
                    loading={<div style={{ fontSize: 12 }}>Loading PDF…</div>}
                    error={<div style={{ fontSize: 12 }}>Could not load PDF.</div>}
                >
                    {Array.from({ length: pdfNumPages || 0 }, (_, i) => (
                        <div key={i} style={{ marginBottom: 12 }}>
                            <Page
                                pageNumber={i + 1}
                                width={modalPageWidth}
                                renderTextLayer={false}
                                renderAnnotationLayer={false}
                            />
                        </div>
                    ))}
                </Document>
            );
        }

        // Markdown
        if (isMarkdown) {

            return (
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
                </div>
            );
        }

        // Notebook
        if (isIpynb) {
            return notebookJson ? (
                <NotebookRenderer ipynb={notebookJson} compact={false} />
            ) : (
                <div style={{ fontSize: 12 }}>
                    Notebook preview expects JSON text (<code>contentKind: "text"</code>).
                </div>
            );
        }

        return (
            <SyntaxHighlighter style={oneDark} language={lang} customStyle={{ margin: 0 }}>
                {file.content || EMPTY_STR}
            </SyntaxHighlighter>
        );
    }, [file, isImage, isIpynb, isMarkdown, isPdf, lang, notebookJson, pdfNumPages, renderUrl]);

    return (
        <>
            <div
                ref={containerRef}
                onClick={onClick}
                style={{
                    width: "100%",
                    height: "100%",
                    overflow: "hidden",
                    borderRadius: 10,
                    cursor: "zoom-in",
                    background: "rgba(0,0,0,0.03)",
                }}
                title={"Click to expand"}
            >
                {PreviewInner}
            </div>

            <Modal open={open} onClose={close} title={file.name}>
                {ModalInner}
            </Modal>
        </>
    );
}
