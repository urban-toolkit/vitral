import type React from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

import classes from "../FilePreview.module.css";

/**
 * Syntax-highlighted body of the file modal, in its own module so Prism and its theme are fetched
 * when a document is actually opened rather than shipped in the canvas chunk — `FilePreview` is
 * mounted by every card that holds a file.
 */

const customCodeBlockStyle: React.CSSProperties = {
    margin: 0,
    width: "100%",
    minHeight: "100%",
    minWidth: 0,
    boxSizing: "border-box",
};

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

export default function CodeView({
    content,
    language,
    tabularRowLimit = null,
}: {
    content: string;
    language: string;
    /** Row cap for delimited data; `null` for anything that is not tabular. */
    tabularRowLimit?: number | null;
}) {
    // Datasets can be huge, so only the header plus the first rows are rendered.
    const tabular = tabularRowLimit !== null
        ? splitDelimitedRows(content, tabularRowLimit + 1)
        : null;

    const highlighter = (
        <div className={classes.outerSyntaxHighlighter}>
            <SyntaxHighlighter
                style={oneDark}
                language={language}
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
                Showing the first {tabularRowLimit} rows of this file.
            </div>
            {highlighter}
        </div>
    );
}
