import { memo, useEffect, useState, type DragEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDispatch, useSelector } from "react-redux";

import type { nodeType } from "@/config/types";
import {
    attachCodebaseFilePathToNode,
    detachCodebaseFilePathFromNode,
    renameNodeTitle,
} from "@/store/flowSlice";
import {
    selectAllBlueprintEvents,
    selectHoveredCodebaseFilePath,
    selectHoveredBlueprintComponentNodeId,
    setHoveredBlueprintComponentNodeId,
} from "@/store/timelineSlice";
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

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function basename(path: string): string {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function BlueprintComponentNodeImpl(props: NodeProps<nodeType>) {
    const dispatch = useDispatch();
    const blueprintEvents = useSelector(selectAllBlueprintEvents);
    const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);
    const hoveredBlueprintComponentNodeId = useSelector(selectHoveredBlueprintComponentNodeId);
    const [isDragTarget, setIsDragTarget] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const rawData = props.data as Record<string, unknown>;
    const isManualComponent = rawData.manualCreated === true;
    const rawTitle = typeof rawData.title === "string" ? rawData.title : "Component";
    const [draftTitle, setDraftTitle] = useState(rawTitle);
    const description = typeof rawData.description === "string" ? rawData.description : "";
    const labelLines = splitCircleLabel(draftTitle, 9, 3);
    const codebaseFilePaths = Array.isArray(rawData.codebaseFilePaths)
        ? rawData.codebaseFilePaths
            .filter((path): path is string => typeof path === "string")
            .map((path) => normalizePath(path))
            .filter((path) => path !== "")
        : [];
    const titleWithAttachments = [
        rawTitle,
        description,
        ...(codebaseFilePaths.length > 0
            ? ["", "Attached GitHub files:", ...codebaseFilePaths]
            : []),
    ]
        .filter(Boolean)
        .join("\n");

    useEffect(() => {
        if (!isEditingTitle) {
            setDraftTitle(rawTitle);
        }
    }, [rawTitle, isEditingTitle]);

    const handleGithubFileDrop = (event: DragEvent<HTMLDivElement>) => {
        const payload = event.dataTransfer?.getData("application/x-vitral-github-file");
        if (!payload) return;

        let parsedPath = "";
        try {
            const parsed = JSON.parse(payload) as { path?: unknown };
            parsedPath = typeof parsed.path === "string" ? normalizePath(parsed.path) : "";
        } catch {
            parsedPath = "";
        }

        if (!parsedPath) return;

        event.preventDefault();
        event.stopPropagation();
        setIsDragTarget(false);
        dispatch(attachCodebaseFilePathToNode({ nodeId: props.id, filePath: parsedPath }));
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
        const dragTypes = Array.from(event.dataTransfer?.types ?? []);
        if (!dragTypes.includes("application/x-vitral-github-file")) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
        setIsDragTarget(true);
    };

    const commitTitleEdit = () => {
        const nextTitle = draftTitle.trim() || "Blueprint component";
        dispatch(renameNodeTitle({ nodeId: props.id, title: nextTitle }));
        setDraftTitle(nextTitle);
        setIsEditingTitle(false);
    };
    const normalizedHoveredCodebaseFilePath = hoveredCodebaseFilePath
        ? normalizePath(hoveredCodebaseFilePath)
        : "";
    const isHoveredByFile = normalizedHoveredCodebaseFilePath !== "" &&
        codebaseFilePaths.includes(normalizedHoveredCodebaseFilePath);
    const hasBlueprintEvent = blueprintEvents.some((eventData) => eventData.componentNodeId === props.id);
    const isHovered = hoveredBlueprintComponentNodeId === props.id || isHoveredByFile;

    return (
        <div
            className={`${classes.root} ${isDragTarget ? classes.rootDropActive : ""} ${isHovered ? classes.rootHovered : ""}`}
            title={titleWithAttachments}
            onMouseEnter={() => {
                if (!hasBlueprintEvent) return;
                dispatch(setHoveredBlueprintComponentNodeId(props.id));
            }}
            onMouseLeave={() => dispatch(setHoveredBlueprintComponentNodeId(null))}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={() => setIsDragTarget(false)}
            onDrop={handleGithubFileDrop}
        >
            <div
                className={classes.circle}
                onClick={(event) => {
                    if (!isManualComponent) return;
                    event.stopPropagation();
                    setDraftTitle(rawTitle);
                    setIsEditingTitle(true);
                }}
            >
                {isEditingTitle ? (
                    <input
                        className={classes.titleEditor}
                        value={draftTitle}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        onBlur={commitTitleEdit}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                commitTitleEdit();
                            }
                            if (event.key === "Escape") {
                                setDraftTitle(rawTitle);
                                setIsEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    labelLines.map((line, index) => (
                        <span key={`${line}-${index}`} className={classes.line}>
                            {truncateLabel(line, 9)}
                        </span>
                    ))
                )}

                {codebaseFilePaths.length > 0 && (
                    <div className={classes.attachments}>
                        {codebaseFilePaths.map((path) => (
                            <div key={path} className={classes.attachmentChip}>
                                <span className={classes.attachmentLabel} title={path}>
                                    {truncateLabel(basename(path), 12)}
                                </span>
                                <button
                                    type="button"
                                    className={classes.attachmentRemove}
                                    title={`Detach ${path}`}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        dispatch(
                                            detachCodebaseFilePathFromNode({
                                                nodeId: props.id,
                                                filePath: path,
                                            })
                                        );
                                    }}
                                >
                                    x
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

export const BlueprintComponentNode = memo(BlueprintComponentNodeImpl);
