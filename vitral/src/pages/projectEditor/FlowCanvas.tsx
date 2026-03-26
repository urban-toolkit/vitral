import { memo } from "react";
import { ReactFlow, Background, BackgroundVariant, type NodeChange, type EdgeChange, type Connection, type NodeTypes, type EdgeTypes } from "@xyflow/react";

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
            fitView
        >
            <Background color="#848484" variant={BackgroundVariant.Dots} />
        </ReactFlow>
    );
});
