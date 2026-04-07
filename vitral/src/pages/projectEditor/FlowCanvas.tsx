import { memo } from "react";
import { ReactFlow, MiniMap, type NodeChange, type EdgeChange, type Connection, type NodeTypes, type EdgeTypes } from "@xyflow/react";

import type { edgeType, nodeType } from "@/config/types";
import type { CursorMode } from "@/pages/projectEditor/types";
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
    miniMapBottomOffsetPx?: number;
    miniMapRightOffsetPx?: number;
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
    miniMapBottomOffsetPx = 0,
    miniMapRightOffsetPx = 0,
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
            onlyRenderVisibleElements
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={nodesDraggable}
            onClick={onClick}
            onDragOver={onDragOver}
            onDrop={onDrop}
            minZoom={0.02}
            fitView
        >
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
