import { memo } from "react";
import { ReactFlow, Background, BackgroundVariant, type NodeChange, type EdgeChange, type Connection, type NodeTypes, type EdgeTypes } from "@xyflow/react";

import type { edgeType, nodeType } from "@/config/types";

type FlowCanvasProps = {
    projectId: string;
    nodes: nodeType[];
    edges: edgeType[];
    nodeTypes: NodeTypes;
    edgeTypes: EdgeTypes;
    nodesDraggable: boolean;
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
    onNodesChange,
    onEdgesChange,
    onConnect,
    onClick,
    onDragOver,
    onDrop,
}: FlowCanvasProps) {
    return (
        <ReactFlow
            key={projectId}
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
            fitView
        >
            <Background color="#848484" variant={BackgroundVariant.Dots} />
        </ReactFlow>
    );
});
