import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type Ipynb = {
    cells?: Array<{
        cell_type: "markdown" | "code" | string;
        source?: string[] | string;
        outputs?: any[];
        execution_count?: number | null;
    }>;
};

function srcToText(src?: string[] | string) {
    if (!src) return "";
    return Array.isArray(src) ? src.join("") : src;
}

function arrOrStrToText(x: any) {
    if (typeof x === "string") return x;
    if (Array.isArray(x)) return x.join("");
    return "";
}

function extractTextOutput(out: any): string {
    // stream
    if (out?.output_type === "stream") return arrOrStrToText(out?.text);

    // execute_result / display_data
    const tp = out?.data?.["text/plain"];
    if (tp) return arrOrStrToText(tp);

    // legacy / other
    if (out?.text) return arrOrStrToText(out?.text);

    return "";
}

function extractImage(out: any): { mime: string; b64: string } | null {
    const data = out?.data;
    if (!data) return null;

    const png = data["image/png"];
    if (png) return { mime: "image/png", b64: arrOrStrToText(png) };

    const jpeg = data["image/jpeg"] || data["image/jpg"];
    if (jpeg) return { mime: "image/jpeg", b64: arrOrStrToText(jpeg) };

    return null;
}

function CodeBlock({ code, compact }: { code: string; compact: boolean }) {
    try {
        return (
            <SyntaxHighlighter
                style={oneDark}
                language="python"
                customStyle={{
                    margin: 0,
                    borderRadius: 10,
                    fontSize: compact ? 11 : 13,
                }}
            >
                {code || ""}
            </SyntaxHighlighter>
        );
    } catch {
        return (
            <pre
                style={{
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontSize: compact ? 11 : 13,
                    background: "rgba(0,0,0,0.05)",
                    padding: 10,
                    borderRadius: 10,
                }}
            >
                {code}
            </pre>
        );
    }
}

export function NotebookRenderer({
    ipynb,
    compact = false,
}: {
    ipynb: Ipynb;
    compact?: boolean;
}) {

    if (!ipynb) {
        return (
            <div style={{ padding: 10, fontSize: 12 }}>
                Invalid notebook (expected JSON text).
            </div>
        );
    }

    const cells = ipynb.cells ?? [];

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: compact ? 10 : 14 }}>
            {cells.map((cell, i) => {
                const source = srcToText(cell.source);

                if (cell.cell_type === "markdown") {
                    return (
                        <pre
                            key={i}
                            style={{
                                margin: 0,
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                fontSize: compact ? 12 : 14,
                                lineHeight: 1.4,
                                background: "rgba(0,0,0,0.02)",
                                padding: 10,
                                borderRadius: 10,
                            }}
                        >
                            {source}
                        </pre>
                    );
                }

                if (cell.cell_type === "code") {
                    const outputs = cell.outputs ?? [];

                    return (
                        <div
                            key={i}
                            style={{
                                border: "1px solid rgba(0,0,0,0.08)",
                                borderRadius: 12,
                                overflow: "hidden",
                            }}
                        >
                            <div style={{ padding: 10, background: "rgba(0,0,0,0.02)" }}>
                                <CodeBlock code={source} compact={compact} />
                            </div>

                            {outputs.length > 0 ? (
                                <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                                    {outputs.map((out, j) => {
                                        const img = extractImage(out);
                                        if (img?.b64) {
                                            return (
                                                <img
                                                    key={j}
                                                    alt="notebook output"
                                                    src={`data:${img.mime};base64,${img.b64}`}
                                                    style={{
                                                        maxWidth: "100%",
                                                        height: "auto",
                                                        display: "block",
                                                        borderRadius: 10,
                                                    }}
                                                />
                                            );
                                        }

                                        const txt = extractTextOutput(out);
                                        if (txt) {
                                            return (
                                                <pre
                                                    key={j}
                                                    style={{
                                                        margin: 0,
                                                        whiteSpace: "pre-wrap",
                                                        wordBreak: "break-word",
                                                        fontSize: compact ? 11 : 13,
                                                        background: "rgba(0,0,0,0.04)",
                                                        padding: 10,
                                                        borderRadius: 10,
                                                    }}
                                                >
                                                    {txt}
                                                </pre>
                                            );
                                        }

                                        return null;
                                    })}
                                </div>
                            ) : null}
                        </div>
                    );
                }

                return (
                    <pre
                        key={i}
                        style={{
                            margin: 0,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            fontSize: compact ? 11 : 13,
                            background: "rgba(0,0,0,0.03)",
                            padding: 10,
                            borderRadius: 10,
                        }}
                    >
                        {source}
                    </pre>
                );
            })}
        </div>
    );
}
