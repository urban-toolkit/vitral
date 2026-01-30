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

import classes from './FilePreview.module.css';
import FileModal from "@/components/FileModal";

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

const CustomCSSSynHigh: React.CSSProperties = {
    margin: 0,
    width: "100%",
    minHeight: "100%",
    minWidth: 0,
    boxSizing: "border-box",
}

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
            return (
                <img
                    src={renderUrl}
                    alt={file.name}
                    className={classes.img}
                />
            );
        }

        // // PDF
        // if (isPdf) {
        //     if (!renderUrl) {
        //         return (
        //             <div style={{ padding: 10, fontSize: 12 }}>
        //                 PDF preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
        //             </div>
        //         );
        //     }
        //     return (
        //         <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
        //             <Document
        //                 file={renderUrl}
        //                 onLoadSuccess={(info) => setPdfNumPages(info.numPages)}
        //                 loading={<div style={{ padding: 10, fontSize: 12 }}>Loading PDF…</div>}
        //                 error={<div style={{ padding: 10, fontSize: 12 }}>Could not load PDF.</div>}
        //             >
        //                 <Page
        //                     pageNumber={1}
        //                     width={containerWidth ? Math.floor(containerWidth) : undefined}
        //                     renderTextLayer={false}
        //                     renderAnnotationLayer={false}
        //                 />
        //             </Document>
        //         </div>
        //     );
        // }

        // Markdown
        if (isMarkdown) {
            return (
                <div className={classes.outerMarkdown}>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code({ className, children, ...props }) {
                                const match = /language-(\w+)/.exec(className || "");
                                const codeLang = match?.[1] ?? "text";

                                return (
                                    <SyntaxHighlighter 
                                        style={oneDark} 
                                        language={codeLang} 
                                        wrapLongLines={true} 
                                        customStyle={CustomCSSSynHigh}
                                    >
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

        // // Jupyter Notebook
        // if (isIpynb) {
        //     if (!notebookJson) {
        //         return (
        //             <div style={{ padding: 10, fontSize: 12 }}>
        //                 Notebook preview expects JSON text (<code>contentKind: "text"</code>). If you store notebooks as base64, decode upstream.
        //             </div>
        //         );
        //     }
        //     return (
        //         <div style={{ width: "100%", height: "100%", overflow: "auto" }}>
        //             <NotebookRenderer ipynb={notebookJson} compact={false} />
        //         </div>
        //     );
        // }

        return (
            <div className={classes.outerSyntaxHighlighter}>
                <SyntaxHighlighter
                    language={lang}
                    style={oneDark}
                    wrapLongLines={true}
                    customStyle={CustomCSSSynHigh}
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

        // // PDF: render all pages
        // if (isPdf) {
        //     if (!renderUrl) {
        //         return (
        //             <div style={{ fontSize: 12 }}>
        //                 PDF preview needs <code>contentKind: "base64"</code> (or pass <code>url</code>).
        //             </div>
        //         );
        //     }

        //     const modalPageWidth = clamp(Math.floor(window.innerWidth * 0.8), 520, 1000);

        //     return (
        //         <Document
        //             file={renderUrl}
        //             onLoadSuccess={(info) => setPdfNumPages(info.numPages)}
        //             loading={<div style={{ fontSize: 12 }}>Loading PDF…</div>}
        //             error={<div style={{ fontSize: 12 }}>Could not load PDF.</div>}
        //         >
        //             {Array.from({ length: pdfNumPages || 0 }, (_, i) => (
        //                 <div key={i} style={{ marginBottom: 12 }}>
        //                     <Page
        //                         pageNumber={i + 1}
        //                         width={modalPageWidth}
        //                         renderTextLayer={false}
        //                         renderAnnotationLayer={false}
        //                     />
        //                 </div>
        //             ))}
        //         </Document>
        //     );
        // }

        // Markdown
        if (isMarkdown) {

            return (
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
                </div>
            );
        }

        // // Notebook
        // if (isIpynb) {
        //     return notebookJson ? (
        //         <NotebookRenderer ipynb={notebookJson} compact={false} />
        //     ) : (
        //         <div style={{ fontSize: 12 }}>
        //             Notebook preview expects JSON text (<code>contentKind: "text"</code>).
        //         </div>
        //     );
        // }

        return (
            <div className={classes.outerSyntaxHighlighter}>
                <SyntaxHighlighter 
                    style={oneDark} 
                    language={lang} 
                    wrapLongLines={true} 
                    customStyle={CustomCSSSynHigh}
                >
                    {file.content || EMPTY_STR}
                </SyntaxHighlighter>
            </div>
        );
    }, [file, isImage, isIpynb, isMarkdown, isPdf, lang, notebookJson, pdfNumPages, renderUrl]);

    return (
        <>
            <div
                ref={containerRef}
                onClick={onClick}
                className={`${classes.outerPreview} nowheel`}
                title={"Click to expand"}
            >
                {PreviewInner}
            </div>

            <FileModal open={open} onClose={close} title={file.name}>
                {ModalInner}
            </FileModal>
        </>
    );
}
