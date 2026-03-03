import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDispatch } from "react-redux";

import type { nodeType } from "@/config/types";
import { setHoveredBlueprintComponentNodeId } from "@/store/timelineSlice";
import classes from "./BlueprintComponentNode.module.css";

function truncateLabel(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

function splitCircleLabel(text: string, maxCharsPerLine: number, maxLines: number): string[] {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return [""];

    const maxChars = maxCharsPerLine * maxLines;
    const capped = normalized.length > maxChars
        ? `${normalized.slice(0, Math.max(1, maxChars - 3))}...`
        : normalized;

    const lines: string[] = [];
    for (let index = 0; index < capped.length; index += maxCharsPerLine) {
        lines.push(capped.slice(index, index + maxCharsPerLine));
    }

    return lines.slice(0, maxLines);
}

function BlueprintComponentNodeImpl(props: NodeProps<nodeType>) {
    const dispatch = useDispatch();
    const rawData = props.data as Record<string, unknown>;
    const rawTitle = typeof rawData.title === "string" ? rawData.title : "Component";
    const description = typeof rawData.description === "string" ? rawData.description : "";
    const labelLines = splitCircleLabel(rawTitle, 9, 3);

    return (
        <div
            className={classes.root}
            title={`${rawTitle}${description ? `\n${description}` : ""}`}
            onMouseEnter={() => dispatch(setHoveredBlueprintComponentNodeId(props.id))}
            onMouseLeave={() => dispatch(setHoveredBlueprintComponentNodeId(null))}
        >
            <div className={classes.circle}>
                {labelLines.map((line, index) => (
                    <span key={`${line}-${index}`} className={classes.line}>
                        {truncateLabel(line, 9)}
                    </span>
                ))}
            </div>

            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

export const BlueprintComponentNode = memo(BlueprintComponentNodeImpl);
