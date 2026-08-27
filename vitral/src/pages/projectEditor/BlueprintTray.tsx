import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow,
    ReactFlowProvider,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type EdgeTypes,
    type NodeChange,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faCircle, faDiagramProject } from "@fortawesome/free-solid-svg-icons";

import type { SystemPaperQueryCard } from "@/api/stateApi";
import type { edgeType, nodeType } from "@/config/types";
import type { AppDispatch, RootState } from "@/store";
import {
    addNodes,
    connectEdges,
    dissolveBlueprintGroup,
    onNodesChange as commitNodeChanges,
} from "@/store/flowSlice";
import { BlueprintComponentNode } from "@/components/blueprint/BlueprintComponentNode";
import { BlueprintGroupNode } from "@/components/blueprint/BlueprintGroupNode";
import { BlueprintSearchPanel } from "@/components/blueprint/BlueprintSearchPanel";
import {
    BLUEPRINT_COMPONENTS_DRAG_MIME,
    BLUEPRINT_DRAG_MIME,
    parseBlueprintComponentsDragPayload,
    parseBlueprintDragPayload,
} from "@/components/blueprint/blueprintDnD";
import {
    buildBlueprintComponentGraph,
    buildLooseComponentNodes,
} from "@/components/blueprint/buildBlueprintGraph";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { isBlueprintNode } from "@/pages/projectEditor/blueprintSurfaces";
import { isEdgeActive, isNodeActive } from "@/pages/projectEditor/graphSemantics";
import { relationLabelFor } from "@/utils/relationships";
import styles from "./BlueprintTray.module.css";

/**
 * The blueprint tray: the system as it is being designed, on its own surface.
 *
 * The canvas is a temporal graph — activities left to right by date, everything else orbiting the
 * activity it belongs to — and a system design has no place on that axis. Left there, blueprint
 * structure was exiled to a band 460px below the graph, which is what made it read as dislocated.
 * So it moves here, where a component can be put wherever the researcher wants it and wired to
 * whatever they think it feeds, and the canvas keeps only the claim that *is* temporal: this
 * component answers that requirement.
 *
 * It is a second React Flow instance over the same store, not a copy of anything. A blueprint node
 * exists once, in `flow.nodes`; the two surfaces differ only in which of them they draw
 * (`blueprintSurfaces.ts`). That is what makes "attached, and still in the tray" need no
 * synchronisation, and what keeps playback history, soft delete, provenance, embeddings and export
 * working with nothing added.
 */

const MIN_WIDTH_PX = 320;
const MIN_HEIGHT_PX = 240;
const DEFAULT_WIDTH_PX = 460;
const DEFAULT_HEIGHT_PX = 460;

type BlueprintTrayProps = {
    open: boolean;
    onToggleOpen: () => void;
    /** Review mode and guests: the tray still renders, but nothing in it can be changed. */
    interactionLocked: boolean;
    /**
     * Keeps the tray clear of the timeline dock.
     *
     * It is docked to the **bottom** left and grows upward, which is what lets it avoid guessing how
     * tall the left sidebar happens to be: the sidebar owns the top-left corner and its height
     * changes with the filters, the project title and whether it is collapsed. Anchoring the tray to
     * the one edge nothing else on the left uses means it never has to be told.
     */
    bottomOffsetPx: number;
    requirementCards: SystemPaperQueryCard[];
    selectedRequirementCards: SystemPaperQueryCard[];
    /** The timestamp a new node or edge should carry, resolved against the playhead. */
    resolveActionTimestamp: () => string;
};

function TrayCanvas({
    interactionLocked,
    resolveActionTimestamp,
}: {
    interactionLocked: boolean;
    resolveActionTimestamp: () => string;
}) {
    const dispatch = useDispatch<AppDispatch>();
    const { screenToFlowPosition, getViewport } = useReactFlow();
    const storeNodes = useSelector((state: RootState) => state.flow.nodes);
    const storeEdges = useSelector((state: RootState) => state.flow.edges);

    /**
     * The tray's content: every live blueprint node, at its stored position.
     *
     * Read from the store rather than from the canvas's playback-scoped set on purpose. The tray is
     * a workbench, not a view of the study — scrubbing the timeline must not empty it out.
     */
    const trayNodes = useMemo(
        () => storeNodes.filter((node) => isBlueprintNode(node) && isNodeActive(node)),
        [storeNodes],
    );

    const trayEdges = useMemo(() => {
        const present = new Set(trayNodes.map((node) => node.id));
        return storeEdges.filter((edge) => (
            isEdgeActive(edge) && present.has(edge.source) && present.has(edge.target)
        ));
    }, [storeEdges, trayNodes]);

    /**
     * A local copy, so a drag is smooth without writing a document revision per frame.
     *
     * `flowSlice.onNodesChange` appends a `{kind: "position"}` entry to the node's `__history` for
     * every position change it is handed, and a revision snapshot is taken 140ms after any change.
     * Dispatching per pointermove would therefore write one history entry per frame into the saved
     * document. Changes are applied here while the drag runs and committed once, on `onNodeDragStop`.
     */
    const [localNodes, setLocalNodes] = useState<nodeType[]>(trayNodes);
    const [syncedFrom, setSyncedFrom] = useState<nodeType[]>(trayNodes);
    // Reset during render rather than from an effect, which is React's own recipe for "this state is
    // derived from something upstream and should restart when it changes". An effect would render
    // once with the stale list first, and the tray would show the node it is about to drop.
    if (syncedFrom !== trayNodes) {
        setSyncedFrom(trayNodes);
        setLocalNodes(trayNodes);
    }

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        setLocalNodes((previous) => applyNodeChanges(changes, previous));
    }, []);

    const handleNodeDragStop = useCallback((_event: unknown, node: nodeType) => {
        if (interactionLocked) return;
        dispatch(commitNodeChanges([{
            id: node.id,
            type: "position",
            position: node.position,
        }]));
    }, [dispatch, interactionLocked]);

    const handleDissolve = useCallback((groupId: string) => {
        if (interactionLocked) return;
        dispatch(dissolveBlueprintGroup({ groupId, deletedAt: resolveActionTimestamp() }));
    }, [dispatch, interactionLocked, resolveActionTimestamp]);

    /**
     * Wiring two components together.
     *
     * Straight to `feeds into`, with no relation menu. `EdgeConnectMenu` offers `referenced by` and
     * `iteration of` beside the default, and those are claims about cards — meaningless between two
     * components, and the relation table has exactly one entry for this pair. Asking a question with
     * one true answer is worse than not asking. Every other connect path in the app does ask,
     * because every other pair has a real choice.
     */
    const handleConnect = useCallback((connection: Connection) => {
        if (interactionLocked) return;
        if (!connection.source || !connection.target) return;
        if (connection.source === connection.target) return;

        const label = relationLabelFor("blueprint_component", "blueprint_component");
        if (!label) return;

        const alreadyWired = storeEdges.some((edge) => (
            edge.source === connection.source
            && edge.target === connection.target
            && isEdgeActive(edge)
        ));
        if (alreadyWired) return;

        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: connection.source,
            target: connection.target,
            type: "relation",
            label,
            data: {
                label,
                from: "blueprint_component",
                to: "blueprint_component",
                createdAt: resolveActionTimestamp(),
                manual: true,
            },
        }]));
    }, [dispatch, interactionLocked, resolveActionTimestamp, storeEdges]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        if (interactionLocked) return;
        const types = Array.from(event.dataTransfer?.types ?? []);
        if (!types.includes(BLUEPRINT_DRAG_MIME) && !types.includes(BLUEPRINT_COMPONENTS_DRAG_MIME)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
    }, [interactionLocked]);

    const handleDrop = useCallback((event: React.DragEvent) => {
        if (interactionLocked) return;

        const paperRaw = event.dataTransfer?.getData(BLUEPRINT_DRAG_MIME);
        if (paperRaw) {
            event.preventDefault();
            const payload = parseBlueprintDragPayload(paperRaw);
            if (!payload) return;

            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const graph = buildBlueprintComponentGraph(payload, position, resolveActionTimestamp());
            if (graph.nodes.length > 0) dispatch(addNodes(graph.nodes));
            if (graph.edges.length > 0) dispatch(connectEdges(graph.edges));
            return;
        }

        const componentsRaw = event.dataTransfer?.getData(BLUEPRINT_COMPONENTS_DRAG_MIME);
        if (componentsRaw) {
            event.preventDefault();
            const payload = parseBlueprintComponentsDragPayload(componentsRaw);
            if (!payload) return;

            const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const graph = buildLooseComponentNodes(
                payload.components,
                position,
                resolveActionTimestamp(),
            );
            if (graph.nodes.length > 0) dispatch(addNodes(graph.nodes));
            if (graph.edges.length > 0) dispatch(connectEdges(graph.edges));
        }
    }, [dispatch, interactionLocked, resolveActionTimestamp, screenToFlowPosition]);

    const handleAddComponent = useCallback(() => {
        if (interactionLocked) return;
        const viewport = getViewport();
        const createdAt = resolveActionTimestamp();
        // The middle of what the researcher is looking at. A fixed coordinate would stack every new
        // component on top of the last one once the tray has been panned.
        const position = {
            x: (-viewport.x + 160) / viewport.zoom,
            y: (-viewport.y + 120) / viewport.zoom,
        };

        dispatch(addNodes([{
            id: crypto.randomUUID(),
            position,
            type: "blueprintComponent",
            data: {
                label: "blueprint_component",
                type: "technical",
                title: "New component",
                codebaseFilePaths: [],
                manualCreated: true,
                description: "Manual / Manual",
                createdAt,
                blueprintComponent: {
                    id: Math.floor(Date.now() + Math.random() * 1000),
                    name: "New component",
                    feedsInto: [],
                    highBlockName: "Manual",
                    intermediateBlockName: "Manual",
                },
                blueprintPaperTitle: "Manual component",
                blueprintFileName: "",
            },
        } as nodeType]));
    }, [dispatch, getViewport, interactionLocked, resolveActionTimestamp]);

    /**
     * Handlers reach the node types through a ref, so `nodeTypes` can be memoised with no
     * dependencies. React Flow rebuilds every node when that object's identity changes.
     */
    const handlersRef = useRef({ handleDissolve, interactionLocked });
    useEffect(() => {
        handlersRef.current = { handleDissolve, interactionLocked };
    }, [handleDissolve, interactionLocked]);

    const nodeTypes = useMemo<NodeTypes>(() => ({
        blueprintGroup: (nodeProps: NodeProps) => (
            <BlueprintGroupNode
                {...(nodeProps as NodeProps<nodeType>)}
                onDissolve={handlersRef.current.interactionLocked
                    ? undefined
                    : handlersRef.current.handleDissolve}
            />
        ),
        blueprintComponent: (nodeProps: NodeProps) => (
            <BlueprintComponentNode
                {...(nodeProps as NodeProps<nodeType>)}
                attachable={!handlersRef.current.interactionLocked}
            />
        ),
    }), []);

    const edgeTypes = useMemo<EdgeTypes>(() => ({ relation: RelationEdge }), []);

    const isEmpty = trayNodes.length === 0;

    return (
        <div className={styles.canvasWrap} onDragOver={handleDragOver} onDrop={handleDrop}>
            <ReactFlow<nodeType, edgeType>
                nodes={localNodes}
                edges={trayEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={!interactionLocked}
                nodesConnectable={!interactionLocked}
                onNodesChange={handleNodesChange}
                onNodeDragStop={handleNodeDragStop}
                onConnect={handleConnect}
                minZoom={0.05}
                fitView
                proOptions={{ hideAttribution: true }}
            />

            {isEmpty ? (
                <div className={styles.empty}>
                    <FontAwesomeIcon icon={faDiagramProject} className={styles.emptyIcon} />
                    <p className={styles.emptyText}>
                        Search the literature above and drag a whole system, or single components,
                        in here. Wire them however you like, then drag a component onto a requirement
                        card to say it answers that requirement.
                    </p>
                </div>
            ) : null}

            {!interactionLocked ? (
                <button
                    type="button"
                    className={styles.addComponent}
                    onClick={handleAddComponent}
                    title="Add a component of your own"
                >
                    <FontAwesomeIcon icon={faCircle} />
                    <span>Component</span>
                </button>
            ) : null}
        </div>
    );
}

export const BlueprintTray = memo(function BlueprintTray({
    open,
    onToggleOpen,
    interactionLocked,
    bottomOffsetPx,
    requirementCards,
    selectedRequirementCards,
    resolveActionTimestamp,
}: BlueprintTrayProps) {
    const [size, setSize] = useState({ width: DEFAULT_WIDTH_PX, height: DEFAULT_HEIGHT_PX });
    const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

    /**
     * Resize by pointer capture rather than by a library — the project has no drag or resize
     * dependency and this is the only place that wants one. Capture on the grip means the pointer
     * keeps reporting to it even when it leaves the 12px target, which is what stops a fast drag
     * dropping the gesture halfway.
     */
    const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = { x: event.clientX, y: event.clientY, ...size };
    }, [size]);

    const handleResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const start = resizeRef.current;
        if (!start) return;
        const maxHeight = window.innerHeight - bottomOffsetPx - 96;
        setSize({
            width: Math.max(MIN_WIDTH_PX, Math.min(start.width + (event.clientX - start.x), window.innerWidth - 80)),
            height: Math.max(MIN_HEIGHT_PX, Math.min(start.height + (event.clientY - start.y), Math.max(MIN_HEIGHT_PX, maxHeight))),
        });
    }, [bottomOffsetPx]);

    const handleResizePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        resizeRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    return (
        <aside
            className={`${styles.root} ${open ? "" : styles.rootClosed}`}
            style={{
                bottom: bottomOffsetPx + 12,
                width: size.width,
                height: size.height,
                // Closed, it is translated away rather than unmounted, so the tray's viewport and the
                // search results survive a close/open cycle. `content-visibility` keeps that free:
                // the whole subtree is skipped for layout, style and paint while it is off-screen.
                transform: open ? undefined : `translateX(calc(-100% - 24px))`,
            }}
            aria-hidden={!open}
        >
            <header className={styles.header}>
                <FontAwesomeIcon icon={faDiagramProject} className={styles.headerIcon} />
                <h2 className={styles.title}>Blueprint tray</h2>
                <button
                    type="button"
                    className={styles.collapse}
                    onClick={onToggleOpen}
                    title="Hide the tray"
                    aria-label="Hide the tray"
                >
                    <FontAwesomeIcon icon={faChevronDown} />
                </button>
            </header>

            <BlueprintSearchPanel
                requirementCards={requirementCards}
                selectedRequirementCards={selectedRequirementCards}
                disabled={interactionLocked}
            />

            <ReactFlowProvider>
                <TrayCanvas
                    interactionLocked={interactionLocked}
                    resolveActionTimestamp={resolveActionTimestamp}
                />
            </ReactFlowProvider>

            <div
                className={styles.resizeGrip}
                onPointerDown={handleResizePointerDown}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
                onPointerCancel={handleResizePointerUp}
                role="separator"
                aria-label="Resize the tray"
            />
        </aside>
    );
});

