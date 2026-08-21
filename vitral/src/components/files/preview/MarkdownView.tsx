import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import classes from "../FilePreview.module.css";

/**
 * Markdown body of the file modal, in its own module so `react-markdown` and `remark-gfm` are
 * fetched when a document is actually opened rather than shipped in the canvas chunk — `FilePreview`
 * is mounted by every card that holds a file.
 */
export default function MarkdownView({ content }: { content: string }) {
    return (
        <div className={classes.modalMarkdown}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {content}
            </ReactMarkdown>
        </div>
    );
}
