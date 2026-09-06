import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ReactFlow,
    ReactFlowProvider,
    applyEdgeChanges,
    applyNodeChanges,
    useReactFlow,
    type Connection,
    type EdgeChange,
    type EdgeTypes,
    type NodeChange,
    type NodeProps,
    type NodeTypes,
} from "@xyflow/react";
import { useDispatch, useSelector } from "react-redux";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChevronDown, faCircle, faDiagramProject, faTrashCan } from "@fortawesome/free-solid-svg-icons";

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
import {
    BlueprintSearchActions,
    BlueprintSearchResults,
} from "@/components/blueprint/BlueprintSearchPanel";
import { useBlueprintSearch } from "@/components/blueprint/useBlueprintSearch";
import {
    BLUEPRINT_COMPONENTS_DRAG_MIME,
    BLUEPRINT_DRAG_MIME,
    BLUEPRINT_NEW_COMPONENT_MIME,
    parseBlueprintComponentsDragPayload,
    parseBlueprintDragPayload,
} from "@/components/blueprint/blueprintDnD";
import {
    buildBlueprintComponentGraph,
    buildLooseComponentNodes,
} from "@/components/blueprint/buildBlueprintGraph";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { isBlueprintComponent, isBlueprintNode } from "@/pages/projectEditor/blueprintSurfaces";
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

/**
 * What an open result list adds to the tray's width.
 *
 * Added rather than subtracted: the results are a column beside the graph, and taking their width
 * out of the graph's would mean every search shrank the surface the results are dragged onto. So
 * `size.width` stays the width of the graph half, whatever the researcher dragged it to, and the
 * panel grows to the right when a search opens.
 *
 * `243` is `.results` — a 232px column plus its 10px gutter and 1px rule — and `10` is `.body`'s
 * gap. Both live in `BlueprintTray.module.css` / `BlueprintSearchPanel.module.css`.
 */
const RESULTS_COLUMN_TOTAL_PX = 253;

/** Clearance kept above the tray at full height, so it never swallows the left sidebar's header. */
const TOP_CLEARANCE_PX = 96;

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
    /**
     * The page's own soft delete, for the tray's delete buttons, its delete key and Clear.
     *
     * Handed down rather than reimplemented here. Deleting a component is `deletedAt` on the node
     * *and* on every edge that touched it — including the `tackled in` edge that was putting it on
     * the main canvas — and a second copy of that rule in the tray is a second chance for the two
     * surfaces to disagree about what a deleted component is.
     */
    onDeleteNodes: (nodeIds: readonly string[]) => void;
    /**
     * The same soft delete, for relations.
     *
     * The tray is the **only** surface that draws component-to-component wiring: `feeds into` says
     * how the system is put together rather than what the study found, so `canvasBlueprintEdges`
     * keeps it off the canvas. Without this the tray could create a relation it had no way to
     * remove, and no other surface could remove it either.
     */
    onDeleteEdges: (edgeIds: readonly string[]) => void;
};

function TrayCanvas({
    interactionLocked,
    resolveActionTimestamp,
    onDeleteNodes,
    onDeleteEdges,
}: {
    interactionLocked: boolean;
    resolveActionTimestamp: () => string;
    onDeleteNodes: (nodeIds: readonly string[]) => void;
    onDeleteEdges: (edgeIds: readonly string[]) => void;
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

    // Edges get the same treatment, for selection rather than for dragging: React Flow writes
    // `selected` onto the edge object, and a controlled list that never takes it back cannot be
    // selected at all.
    const [localEdges, setLocalEdges] = useState<edgeType[]>(trayEdges);
    const [edgesSyncedFrom, setEdgesSyncedFrom] = useState<edgeType[]>(trayEdges);
    if (edgesSyncedFrom !== trayEdges) {
        setEdgesSyncedFrom(trayEdges);
        setLocalEdges(trayEdges);
    }

    /**
     * Local for everything except a removal, which has to reach the document.
     *
     * `localNodes` exists only to keep a drag off the revision log, and it is *reset from the store*
     * whenever `flow.nodes` changes identity (see the derived-state reset above). A delete applied
     * here alone therefore survived exactly until the next store write — touching a card on the main
     * canvas was enough — and then the node came back, because the store had never been told. So a
     * `remove` change is routed to the page's soft delete and deliberately **not** applied locally:
     * the node leaves the tray when the store says it has, which is the same moment it leaves
     * everywhere else.
     */
    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        const removedIds: string[] = [];
        const rest: NodeChange<nodeType>[] = [];
        for (const change of changes) {
            if (change.type === "remove") removedIds.push(change.id);
            else rest.push(change);
        }

        // Guarded here rather than by an early return, so selection still works in review mode.
        if (removedIds.length > 0 && !interactionLocked) onDeleteNodes(removedIds);
        if (rest.length > 0) setLocalNodes((previous) => applyNodeChanges(rest, previous));
    }, [interactionLocked, onDeleteNodes]);

    /**
     * The same arrangement for edges, and the reason the tray has one at all.
     *
     * React Flow is *controlled* here: with `edges` passed as a prop and no `onEdgesChange`, every
     * change it computes is dropped on the floor — including the `select` that has to land before
     * the delete key means anything. So an edge in the tray could not even be selected, let alone
     * removed, and `feeds into` is drawn on no other surface. Clicking a relation and pressing
     * Backspace/Delete did nothing at all, silently, which is what was reported.
     *
     * Selection is applied locally and a removal is routed to the page's soft delete, exactly as
     * `handleNodesChange` does and for the same reason: `localEdges` is reset from the store
     * whenever `trayEdges` changes identity, so a delete applied only here would come back on the
     * next store write.
     */
    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => {
        const removedIds: string[] = [];
        const rest: EdgeChange<edgeType>[] = [];
        for (const change of changes) {
            if (change.type === "remove") removedIds.push(change.id);
            else rest.push(change);
        }

        if (removedIds.length > 0 && !interactionLocked) onDeleteEdges(removedIds);
        if (rest.length > 0) setLocalEdges((previous) => applyEdgeChanges(rest, previous));
    }, [interactionLocked, onDeleteEdges]);

    const handleDeleteComponent = useCallback((nodeId: string) => {
        if (interactionLocked) return;
        onDeleteNodes([nodeId]);
    }, [interactionLocked, onDeleteNodes]);

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

    /**
     * A component of the researcher's own, at a position they chose.
     *
     * Shared by the drag off the Component button and by clicking it, which is the only difference
     * between the two gestures: the drag knows where it landed, the click has to guess the middle of
     * what is on screen.
     */
    const createComponentAt = useCallback((position: { x: number; y: number }) => {
        const createdAt = resolveActionTimestamp();
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
    }, [dispatch, resolveActionTimestamp]);

    const handleDragOver = useCallback((event: React.DragEvent) => {
        if (interactionLocked) return;
        const types = Array.from(event.dataTransfer?.types ?? []);
        const accepted = types.includes(BLUEPRINT_DRAG_MIME)
            || types.includes(BLUEPRINT_COMPONENTS_DRAG_MIME)
            || types.includes(BLUEPRINT_NEW_COMPONENT_MIME);
        if (!accepted) return;
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
            return;
        }

        // The blank component carries no payload, so its presence in `types` is the whole message.
        if (Array.from(event.dataTransfer?.types ?? []).includes(BLUEPRINT_NEW_COMPONENT_MIME)) {
            event.preventDefault();
            createComponentAt(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
        }
    }, [createComponentAt, dispatch, interactionLocked, resolveActionTimestamp, screenToFlowPosition]);

    const handleAddComponent = useCallback(() => {
        if (interactionLocked) return;
        const viewport = getViewport();
        // The middle of what the researcher is looking at. A fixed coordinate would stack every new
        // component on top of the last one once the tray has been panned.
        createComponentAt({
            x: (-viewport.x + 160) / viewport.zoom,
            y: (-viewport.y + 120) / viewport.zoom,
        });
    }, [createComponentAt, getViewport, interactionLocked]);

    /**
     * Empty the tray, after saying what that costs.
     *
     * Confirmed with `window.confirm`, which is what this app already uses for the destructive
     * project-level actions (`ProjectsPage`, the export prompts). The wording names the two things
     * a researcher cannot see from here: that clearing is not tray-only — a component answering a
     * requirement leaves the main canvas with it — and that it is a soft delete, so the timeline
     * still holds everything before this moment.
     */
    const handleClear = useCallback(() => {
        if (interactionLocked) return;
        if (trayNodes.length === 0) return;

        const componentCount = trayNodes.filter((node) => isBlueprintComponent(node)).length;
        const paperCount = trayNodes.length - componentCount;
        const parts = [
            `${componentCount} component${componentCount === 1 ? "" : "s"}`,
            ...(paperCount > 0 ? [`${paperCount} paper box${paperCount === 1 ? "" : "es"}`] : []),
        ];

        const confirmed = window.confirm(
            `Clear the blueprint tray? This removes ${parts.join(" and ")} from the study,`
            + " and any component answering a requirement leaves the canvas with it."
            + " Scrub the timeline back to see them again.",
        );
        if (!confirmed) return;

        onDeleteNodes(trayNodes.map((node) => node.id));
    }, [interactionLocked, onDeleteNodes, trayNodes]);

    /**
     * Handlers reach the node types through a ref, so `nodeTypes` can be memoised with no
     * dependencies. React Flow rebuilds every node when that object's identity changes.
     */
    const handlersRef = useRef({ handleDissolve, handleDeleteComponent, interactionLocked });
    useEffect(() => {
        handlersRef.current = { handleDissolve, handleDeleteComponent, interactionLocked };
    }, [handleDissolve, handleDeleteComponent, interactionLocked]);

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
                onDelete={handlersRef.current.interactionLocked
                    ? undefined
                    : handlersRef.current.handleDeleteComponent}
            />
        ),
    }), []);

    const edgeTypes = useMemo<EdgeTypes>(() => ({ relation: RelationEdge }), []);

    const isEmpty = trayNodes.length === 0;

    return (
        <div className={styles.canvasWrap} onDragOver={handleDragOver} onDrop={handleDrop}>
            <ReactFlow<nodeType, edgeType>
                nodes={localNodes}
                edges={localEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={!interactionLocked}
                nodesConnectable={!interactionLocked}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                /*
                 * No `onBeforeDelete` here, unlike the canvas, and that is a decision rather than an
                 * omission. The canvas's veto exists to stop a card being cut loose from the graph
                 * (`graphInvariants.planEdgeRemovals`), and `requiresConnection` answers `false` for
                 * anything whose `node.type` is not `"card"` — every node in this tray. Adding the
                 * guard here would evaluate a rule that cannot fire. If the connection rule is ever
                 * widened past cards, this is the surface that will quietly stop honouring it.
                 */
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
                <div className={styles.canvasActions}>
                    {/*
                      * A component of the researcher's own, dragged in rather than clicked into
                      * being.
                      *
                      * Every other way a component arrives in the tray is a drag that lands where it
                      * was dropped — a paper, a search result, a whole system. Making this one a
                      * click meant the one component the researcher authored themselves was the one
                      * they could not place; it appeared in the middle of the viewport and then had
                      * to be moved. The click is kept as the keyboard-reachable path, and now spawns
                      * the same node.
                      */}
                    <button
                        type="button"
                        className={styles.addComponent}
                        draggable
                        onClick={handleAddComponent}
                        onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = "copy";
                            event.dataTransfer.setData(BLUEPRINT_NEW_COMPONENT_MIME, "new-component");
                            event.dataTransfer.setData("text/plain", "New component");
                        }}
                        title="Drag onto the tray to place a component of your own"
                    >
                        <FontAwesomeIcon icon={faCircle} />
                        <span>Component</span>
                    </button>

                    {/* Disabled rather than hidden on an empty tray, so the control does not appear
                        and disappear as components come and go. */}
                    <button
                        type="button"
                        className={styles.clearTray}
                        onClick={handleClear}
                        disabled={isEmpty}
                        title={isEmpty
                            ? "The tray is already empty"
                            : "Remove every blueprint item from the study"}
                    >
                        <FontAwesomeIcon icon={faTrashCan} />
                        <span>Clear</span>
                    </button>
                </div>
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
    onDeleteNodes,
    onDeleteEdges,
}: BlueprintTrayProps) {
    const [size, setSize] = useState({ width: DEFAULT_WIDTH_PX, height: DEFAULT_HEIGHT_PX });
    const resizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
    const search = useBlueprintSearch({ requirementCards, selectedRequirementCards });

    const resultsOpen = search.mode !== null;
    const resultsWidthPx = resultsOpen ? RESULTS_COLUMN_TOTAL_PX : 0;

    /**
     * Resize by pointer capture rather than by a library — the project has no drag or resize
     * dependency and this is the only place that wants one. Capture on the grip means the pointer
     * keeps reporting to it even when it leaves the 16px target, which is what stops a fast drag
     * dropping the gesture halfway.
     *
     * The grip is the **top right** corner because the panel is anchored bottom left: the two edges
     * that actually move when it is resized are the top one and the right one, so those are the ones
     * the pointer should be holding. On the bottom-right corner it was pinned against the edge the
     * panel grows away from, and dragging *down* made the panel taller by pushing its top up — the
     * grip and the panel moving in opposite directions.
     */
    const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        resizeRef.current = { x: event.clientX, y: event.clientY, ...size };
    }, [size]);

    const handleResizePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const start = resizeRef.current;
        if (!start) return;
        const maxHeight = window.innerHeight - bottomOffsetPx - TOP_CLEARANCE_PX;
        // The results column is already part of the rendered width, so the cap on the graph half has
        // to leave room for it — otherwise a search could push the panel off the right of the screen.
        const maxWidth = Math.max(MIN_WIDTH_PX, window.innerWidth - 80 - resultsWidthPx);
        setSize({
            width: Math.max(MIN_WIDTH_PX, Math.min(start.width + (event.clientX - start.x), maxWidth)),
            // Upward: the bottom edge is pinned, so dragging the top grip up is what makes it taller.
            height: Math.max(MIN_HEIGHT_PX, Math.min(start.height - (event.clientY - start.y), Math.max(MIN_HEIGHT_PX, maxHeight))),
        });
    }, [bottomOffsetPx, resultsWidthPx]);

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
                width: size.width + resultsWidthPx,
                height: size.height,
                // The resize gesture clamps against the viewport it happened in; shrinking the window
                // afterwards leaves `size.height` stale, so the ceiling is restated here where the
                // browser re-evaluates it on every resize.
                maxHeight: `calc(100vh - ${bottomOffsetPx + 12 + TOP_CLEARANCE_PX}px)`,
                // Closed, it is translated away rather than unmounted, so the tray's viewport and the
                // search results survive a close/open cycle. `content-visibility` keeps that free:
                // the whole subtree is skipped for layout, style and paint while it is off-screen.
                transform: open ? undefined : `translateX(calc(-100% - 24px))`,
            }}
            aria-hidden={!open}
        >
            <header className={styles.header}>
                <FontAwesomeIcon icon={faDiagramProject} className={styles.headerIcon} />
                <h2 className={styles.title}>Blueprint</h2>
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

            <div className={styles.body}>
                <div className={styles.main}>
                    <BlueprintSearchActions search={search} disabled={interactionLocked} />

                    <ReactFlowProvider>
                        <TrayCanvas
                            interactionLocked={interactionLocked}
                            resolveActionTimestamp={resolveActionTimestamp}
                            onDeleteNodes={onDeleteNodes}
                            onDeleteEdges={onDeleteEdges}
                        />
                    </ReactFlowProvider>
                </div>

                <BlueprintSearchResults search={search} />
            </div>

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
