import { useMemo } from "react";

import { NotebookRenderer } from "@/components/cards/NotebookRenderer";
import classes from "../FilePreview.module.css";

/**
 * Notebook body of the file modal, in its own module so `NotebookRenderer` — and the Prism bundle it
 * pulls in for every code cell — is fetched when a notebook is actually opened rather than shipped in
 * the canvas chunk.
 */

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

export default function NotebookView({ content }: { content: string | null }) {
    const notebookJson = useMemo(() => {
        if (!content) return null;
        try {
            return normalizeNotebook(JSON.parse(content));
        } catch {
            return null;
        }
    }, [content]);

    if (!notebookJson) {
        return <div className={classes.loadError}>Could not parse notebook JSON.</div>;
    }

    return (
        <div className={classes.modalNotebook}>
            <NotebookRenderer ipynb={notebookJson} compact={false} />
        </div>
    );
}
