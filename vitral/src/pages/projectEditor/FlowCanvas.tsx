import { memo } from "react";
import { ReactFlow, MiniMap, Panel, type NodeChange, type EdgeChange, type Connection, type NodeTypes, type EdgeTypes, type Viewport } from "@xyflow/react";

import type { edgeType, nodeType } from "@/config/types";
import type { CursorMode } from "@/pages/projectEditor/types";
import { ActivityDropRings, type ActivityDropRingsReason } from "@/pages/projectEditor/ActivityDropRings";
import type { ActivityDropTarget } from "@/pages/projectEditor/canvasGeometry";
import styles from "./FlowCanvas.module.css";

type FlowCanvasProps = {
    projectId: string;
    nodes: nodeType[];
    edges: edgeType[];
    nodeTypes: NodeTypes;
    edgeTypes: EdgeTypes;
    nodesDraggable: boolean;
    cursorMode: CursorMode;
    onNodesChange: (changes: NodeChange<nodeType>[]) => void;
    onEdgesChange: (changes: EdgeChange<edgeType>[]) => void;
    onConnect: (connection: Connection) => void;
    onClick: (e: React.MouseEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    activityDropTargets?: ActivityDropTarget[] | null;
    activityDropReason?: ActivityDropRingsReason;
    /** Provided only while at least one node sits away from its derived position. */
    onResetNodePositions?: (() => void) | null;
    miniMapBottomOffsetPx?: number;
    miniMapRightOffsetPx?: number;
    /**
     * Viewport changes, for the follow-zoom abstraction mode. A plain callback rather than a
     * `useViewport()` subscription on purpose: this fires on every animation frame of every pan, and
     * re-rendering the editor page that often would be ruinous. The handler is expected to read
     * refs and only touch state when the zoom actually crosses a level threshold.
     */
    onMove?: (event: MouseEvent | TouchEvent | null, viewport: Viewport) => void;
    /** The abstraction level control, rendered as a bottom-centre panel over the canvas. */
    levelControl?: React.ReactNode;
};

export const FlowCanvas = memo(function FlowCanvas({
    projectId,
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    nodesDraggable,
    cursorMode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onClick,
    onDragOver,
    onDrop,
    activityDropTargets = null,
    activityDropReason = "drag",
    onResetNodePositions = null,
    miniMapBottomOffsetPx = 0,
    miniMapRightOffsetPx = 0,
    onMove,
    levelControl = null,
}: FlowCanvasProps) {
    const cursorClassName = cursorMode === "text"
        ? styles.cursorText
        : cursorMode === "node"
            ? styles.cursorNode
            : cursorMode === "blueprint_component"
                ? styles.cursorBlueprintComponent
                : styles.cursorPointer;

    return (
        <ReactFlow
            key={projectId}
            className={`${styles.flowCanvas} ${cursorClassName}`}
            style={{ backgroundColor: "#ffffff" }}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={nodesDraggable}
            onClick={onClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onMove={onMove}
            minZoom={0.02}
            fitView
        >
            {activityDropTargets && activityDropTargets.length > 0 ? (
                <ActivityDropRings targets={activityDropTargets} reason={activityDropReason} />
            ) : null}

            {/* Top centre: the top-right corner is taken by the system screenshot panel, and the
                left by the canvas sidebar. */}
            {onResetNodePositions ? (
                <Panel position="top-center">
                    <button
                        type="button"
                        className={styles.resetPositionsButton}
                        onClick={onResetNodePositions}
                    >
                        Reset card positioning
                    </button>
                </Panel>
            ) : null}

            {levelControl ? (
                <Panel position="bottom-center">
                    {levelControl}
                </Panel>
            ) : null}

            <MiniMap
                pannable
                zoomable
                style={{
                    right: miniMapRightOffsetPx + 12,
                    bottom: miniMapBottomOffsetPx + 12,
                    backgroundColor: "rgba(255, 255, 255, 0.96)",
                    border: "1px solid #d7d7d7",
                    borderRadius: 8,
                }}
            />
        </ReactFlow>
    );
});
