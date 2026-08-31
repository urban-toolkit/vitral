import { memo, useEffect, useState, useSyncExternalStore, type DragEvent } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useDispatch, useSelector } from "react-redux";

import type { nodeType } from "@/config/types";
import type { RootState } from "@/store";
import {
    attachCodebaseFilePathToNode,
    detachCodebaseFilePathFromNode,
    renameNodeTitle,
} from "@/store/flowSlice";
import {
    selectBlueprintEventComponentNodeIds,
    selectHoveredCodebaseFilePath,
    selectHoveredBlueprintComponentNodeId,
    setHoveredBlueprintComponentNodeId,
} from "@/store/timelineSlice";
import {
    isBlueprintComponentEmphasized,
    subscribe as subscribeHighlight,
} from "@/store/canvasHighlightStore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare, faXmark } from "@fortawesome/free-solid-svg-icons";

import {
    BLUEPRINT_ATTACH_MIME,
    buildBlueprintAttachPayload,
} from "@/components/blueprint/blueprintDnD";
import classes from "./BlueprintComponentNode.module.css";

type BlueprintComponentNodeProps = NodeProps<nodeType> & {
    onRenameTitle?: (nodeId: string, title: string) => void;
    onAttachCodebaseFilePath?: (nodeId: string, filePath: string) => void;
    onDetachCodebaseFilePath?: (nodeId: string, filePath: string) => void;
    /**
     * Removes the component from the study, on whichever surface it was clicked.
     *
     * One callback for both canvases, and it is the page's `softDeleteNode` on each — a component
     * exists once in `flow.nodes`, so "delete on the canvas" and "delete in the tray" are not two
     * operations to reconcile. Absent, the button is not drawn: that is how review mode, guests and
     * the published-project view opt out.
     */
    onDelete?: (nodeId: string) => void;
    /**
     * Renders the grip that is dragged onto a requirement card to say this component answers it.
     * Tray only: on the canvas the component is already answering something.
     */
    attachable?: boolean;
};

function truncateLabel(text: string, maxChars: number): string {
    if (!text) return "";
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(1, maxChars - 1))}...`;
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function basename(path: string): string {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

function BlueprintComponentNodeImpl(props: BlueprintComponentNodeProps) {
    const dispatch = useDispatch();
    const hasBlueprintEvent = useSelector(
        (state: RootState) => selectBlueprintEventComponentNodeIds(state).has(props.id),
    );
    const hoveredCodebaseFilePath = useSelector(selectHoveredCodebaseFilePath);
    // A boolean, not the hovered id: selecting the id itself re-rendered every blueprint component
    // node whenever the hover moved, rather than only the two whose answer changed.
    const isHoveredSelf = useSelector(
        (state: RootState) => selectHoveredBlueprintComponentNodeId(state) === props.id,
    );
    // Whether this component is wired to a requirement. Read from an external store as a boolean
    // rather than as an `opacity` the page injected into `node.style`, which cost a full re-derivation
    // of the canvas — and put presentation on the same channel the layout reads sizes from.
    const isEmphasized = useSyncExternalStore(
        subscribeHighlight,
        () => isBlueprintComponentEmphasized(props.id),
    );
    const [isDragTarget, setIsDragTarget] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const rawData = props.data as Record<string, unknown>;
    const isManualComponent = rawData.manualCreated === true;
    const rawTitle = typeof rawData.title === "string" ? rawData.title : "Component";
    const [draftTitle, setDraftTitle] = useState(rawTitle);
    const description = typeof rawData.description === "string" ? rawData.description : "";
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
        if (props.onAttachCodebaseFilePath) {
            props.onAttachCodebaseFilePath(props.id, parsedPath);
            return;
        }
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
        if (props.onRenameTitle) {
            props.onRenameTitle(props.id, nextTitle);
        } else {
            dispatch(renameNodeTitle({ nodeId: props.id, title: nextTitle }));
        }
        setDraftTitle(nextTitle);
        setIsEditingTitle(false);
    };
    const normalizedHoveredCodebaseFilePath = hoveredCodebaseFilePath
        ? normalizePath(hoveredCodebaseFilePath)
        : "";
    const isHoveredByFile = normalizedHoveredCodebaseFilePath !== "" &&
        codebaseFilePaths.includes(normalizedHoveredCodebaseFilePath);
    const isHovered = isHoveredSelf || isHoveredByFile;
    /**
     * Whether this component already answers a requirement.
     *
     * It used to be a *dimming* of everything that did not, which is how the canvas said "this piece
     * of the paper is not part of your study". The canvas no longer draws an unattached component at
     * all, so dimming there would apply to nothing; in the tray, where the whole paper lives, the
     * useful mark is the positive one — which of these have I already committed to. Same boolean,
     * read from the same external store, inverted.
     */
    const showsAttachmentMark = props.attachable === true && isEmphasized;

    return (
        <div
            className={`${classes.root} ${isDragTarget ? classes.rootDropActive : ""} ${isHovered ? classes.rootHovered : ""} ${showsAttachmentMark ? classes.rootAttached : ""}`}
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
                        className={`${classes.titleEditor} nodrag`}
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
                    <p className={classes.title}>{rawTitle}</p>
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
                                        if (props.onDetachCodebaseFilePath) {
                                            props.onDetachCodebaseFilePath(props.id, path);
                                            return;
                                        }
                                        dispatch(detachCodebaseFilePathFromNode({
                                            nodeId: props.id,
                                            filePath: path,
                                        }));
                                    }}
                                >
                                    x
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {props.onDelete ? (
                /*
                 * Delete, opposite the attach grip and revealed the same way.
                 *
                 * Hidden until the component is hovered, for the reason the attach grip and the
                 * group's dissolve button are: a tray holding forty components should read as a
                 * diagram, not as forty controls. `nodrag` keeps React Flow from reading the
                 * pointer-down as the start of a node drag, and `stopPropagation` keeps the click
                 * off the circle's rename handler.
                 */
                <button
                    type="button"
                    className={`${classes.deleteButton} nodrag`}
                    title={`Delete "${rawTitle}"`}
                    aria-label={`Delete ${rawTitle}`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        props.onDelete?.(props.id);
                    }}
                >
                    <FontAwesomeIcon icon={faXmark} />
                </button>
            ) : null}

            {props.attachable ? (
                /*
                 * The attach gesture, as a grip rather than as the whole node.
                 *
                 * The tray and the canvas are two React Flow instances, and React Flow's own
                 * connection drag cannot cross between them — so attaching has to be an HTML5 drag,
                 * the same mechanism a GitHub file or a search result already travels by. But HTML5
                 * `draggable` on the node body would swallow the pointer drag that moves the
                 * component around the tray, and the tray is where arranging happens. A small grip
                 * keeps both gestures: the body moves it here, the grip takes it there.
                 *
                 * `nodrag` stops React Flow reading the grip's own pointer-down as a node drag.
                 */
                <div
                    className={`${classes.attachGrip} nodrag`}
                    draggable
                    title={`Drag onto a requirement card to say "${rawTitle}" answers it`}
                    aria-label={`Attach ${rawTitle} to a requirement`}
                    onMouseDown={(event) => event.stopPropagation()}
                    onDragStart={(event) => {
                        event.stopPropagation();
                        // `copyLink`, not `link`: a target that answers `dropEffect = "copy"` — which
                        // is what every other drop target in the app answers — would otherwise
                        // resolve the operation to "none" and the browser would never fire `drop`.
                        event.dataTransfer.effectAllowed = "copyLink";
                        event.dataTransfer.setData(
                            BLUEPRINT_ATTACH_MIME,
                            JSON.stringify(buildBlueprintAttachPayload(props.id, rawTitle)),
                        );
                        event.dataTransfer.setData("text/plain", rawTitle);
                    }}
                >
                    <FontAwesomeIcon icon={faArrowUpRightFromSquare} />
                </div>
            ) : null}

            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}

export const BlueprintComponentNode = memo(BlueprintComponentNodeImpl);
