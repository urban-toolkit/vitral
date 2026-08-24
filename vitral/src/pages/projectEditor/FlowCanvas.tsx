import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { ReactFlow, MiniMap, Panel, type NodeChange, type EdgeChange, type Connection, type NodeTypes, type EdgeTypes, type Viewport } from "@xyflow/react";

import type { edgeType, nodeType } from "@/config/types";
import type { CursorMode } from "@/pages/projectEditor/types";
import { ActivityDropRings, type ActivityDropRingsReason } from "@/pages/projectEditor/ActivityDropRings";
import type { ActivityDropTarget } from "@/pages/projectEditor/canvasGeometry";
import { RelationEdgeMarkerDefs } from "@/components/edges/RelationEdge";
import { useCanvasLod } from "@/pages/projectEditor/useCanvasLod";
import styles from "./FlowCanvas.module.css";

/**
 * Set on the React Flow root for as long as a pan or zoom is in flight, and removed shortly after it
 * stops. A zoom invalidates the raster of everything on screen at every new scale, so the per-frame
 * cost of shadows and of the minimap's viewBox rewrite is paid sixty times a second while the gesture
 * runs and never while the canvas is at rest — which is when the user is actually looking at it.
 *
 * Written with a `classList` call on a ref rather than React state on purpose: a state update here
 * would re-render the editor page on every frame, which is the cost this exists to avoid. A plain
 * global class name, not a CSS-module hash, so component stylesheets can key off it with
 * `:global(.canvas-moving)`.
 */
export const CANVAS_MOVING_CLASS = "canvas-moving";

/** How long after a gesture stops before full-fidelity painting comes back. */
const CANVAS_REST_DELAY_MS = 140;

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
    /** The abstraction level control, rendered as a bottom-right panel over the canvas. */
    levelControl?: React.ReactNode;
    /** Keeps the level control clear of the right sidebar, which floats over the canvas. */
    levelControlRightOffsetPx?: number;
};

/**
 * Shallow prop comparison that can say *why* it failed.
 *
 * This memo is the wall between the editor page's ~37 pieces of state and the canvas, and it is easy
 * to knock a hole in it by passing a freshly built object or element. Set `window.__flowCanvasWhy =
 * true` in the console and every re-render names the prop responsible.
 */
function areFlowCanvasPropsEqual(prev: FlowCanvasProps, next: FlowCanvasProps) {
    const explain = import.meta.env.DEV
        && (window as unknown as { __flowCanvasWhy?: boolean }).__flowCanvasWhy === true;
    let equal = true;
    for (const key of Object.keys(next) as Array<keyof FlowCanvasProps>) {
        if (prev[key] === next[key]) continue;
        equal = false;
        if (!explain) return false;
        console.log("[FlowCanvas] re-render, prop changed:", key);
    }
    return equal;
}

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
    levelControlRightOffsetPx = 0,
}: FlowCanvasProps) {
    const cursorClassName = cursorMode === "text"
        ? styles.cursorText
        : cursorMode === "node"
            ? styles.cursorNode
            : cursorMode === "blueprint_component"
                ? styles.cursorBlueprintComponent
                : styles.cursorPointer;

    const { wrapperRef, handleLodMove, handleLodInit } = useCanvasLod();
    const restTimerRef = useRef<number | null>(null);

    // One handler, two consumers, both frame-rate callbacks that only read refs: the level of detail
    // writes a DOM attribute, and the page's own handler decides whether the abstraction level should
    // follow the zoom.
    const handleMove = useCallback((event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
        handleLodMove(event, viewport);
        onMove?.(event, viewport);
    }, [handleLodMove, onMove]);

    const handleMoveStart = useCallback(() => {
        if (restTimerRef.current !== null) {
            window.clearTimeout(restTimerRef.current);
            restTimerRef.current = null;
        }
        wrapperRef.current?.classList.add(CANVAS_MOVING_CLASS);
    }, [wrapperRef]);

    const handleMoveEnd = useCallback(() => {
        // Trailing debounce: d3-zoom ends a wheel gesture after a short idle timeout, so a continuous
        // scroll arrives as a run of start/end pairs. Restoring on the first `end` would thrash two
        // full style recalculations into the middle of the gesture.
        if (restTimerRef.current !== null) window.clearTimeout(restTimerRef.current);
        restTimerRef.current = window.setTimeout(() => {
            restTimerRef.current = null;
            wrapperRef.current?.classList.remove(CANVAS_MOVING_CLASS);
        }, CANVAS_REST_DELAY_MS);
    }, [wrapperRef]);

    useEffect(() => () => {
        if (restTimerRef.current !== null) window.clearTimeout(restTimerRef.current);
    }, []);

    const miniMapStyle = useMemo<React.CSSProperties>(() => ({
        right: miniMapRightOffsetPx + 12,
        bottom: miniMapBottomOffsetPx + 12,
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        border: "1px solid #d7d7d7",
        borderRadius: 8,
    }), [miniMapRightOffsetPx, miniMapBottomOffsetPx]);

    const levelPanelStyle = useMemo<React.CSSProperties>(
        () => ({ right: levelControlRightOffsetPx + 12, bottom: 12, margin: 0 }),
        [levelControlRightOffsetPx],
    );

    return (
        <ReactFlow
            key={projectId}
            ref={wrapperRef}
            className={`${styles.flowCanvas} ${cursorClassName}`}
            data-lod="near"
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
            onInit={handleLodInit}
            onMove={handleMove}
            onMoveStart={handleMoveStart}
            onMoveEnd={handleMoveEnd}
            /* Has to stay below the Threads -> Overview boundary (0.420, see `canvasAbstraction.ts`)
               or that level can never be reached. Cheap to allow this far out now that the far tier
               draws a card as a single box. */
            minZoom={0.03}
            fitView
        >
            <RelationEdgeMarkerDefs />

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
                <Panel position="bottom-right" style={levelPanelStyle}>
                    {levelControl}
                </Panel>
            ) : null}

            <MiniMap
                pannable
                zoomable
                style={miniMapStyle}
            />
        </ReactFlow>
    );
}, areFlowCanvasPropsEqual);
