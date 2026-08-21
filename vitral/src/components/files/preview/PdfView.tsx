import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { LoadSpinner } from "@/components/project/LoadSpinner";
import classes from "../FilePreview.module.css";

/**
 * PDF body of the file modal, in its own module so `react-pdf` and `pdfjs-dist` — the heaviest
 * dependency in the app, and the one that sets a global worker URL at import time — are fetched when
 * a PDF is actually opened rather than shipped in the canvas chunk.
 */

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

export const PDF_ZOOM_MIN = 0.6;
export const PDF_ZOOM_MAX = 2.4;
const PDF_ZOOM_STEP = 0.2;

export default function PdfView({
    blobUrl,
    numPages,
    zoom,
    onNumPages,
    onZoomChange,
}: {
    blobUrl: string;
    numPages: number;
    zoom: number;
    onNumPages: (numPages: number) => void;
    onZoomChange: (next: number) => void;
}) {
    const basePageWidth = clamp(Math.floor(window.innerWidth * 0.8), 520, 1000);
    const pageWidth = Math.max(180, Math.floor(basePageWidth * zoom));
    const zoomPercent = Math.round(zoom * 100);

    return (
        <div className={classes.modalPdfWrap}>
            <div className={classes.modalPdfScroll}>
                <Document
                    file={blobUrl}
                    onLoadSuccess={(info) => onNumPages(info.numPages)}
                    loading={<LoadSpinner loading={true} />}
                    error={<div className={classes.loadError}>Could not load PDF.</div>}
                >
                    {Array.from({ length: numPages || 0 }, (_, i) => (
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
                    onClick={() => onZoomChange(clamp(zoom - PDF_ZOOM_STEP, PDF_ZOOM_MIN, PDF_ZOOM_MAX))}
                    disabled={zoom <= PDF_ZOOM_MIN}
                    aria-label="Zoom out PDF"
                    title="Zoom out"
                >
                    -
                </button>
                <span className={classes.pdfZoomValue}>{zoomPercent}%</span>
                <button
                    type="button"
                    className={classes.pdfZoomButton}
                    onClick={() => onZoomChange(clamp(zoom + PDF_ZOOM_STEP, PDF_ZOOM_MIN, PDF_ZOOM_MAX))}
                    disabled={zoom >= PDF_ZOOM_MAX}
                    aria-label="Zoom in PDF"
                    title="Zoom in"
                >
                    +
                </button>
            </div>
        </div>
    );
}
