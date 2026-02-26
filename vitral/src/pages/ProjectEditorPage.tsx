import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, useParams } from "react-router-dom";
import { ReactFlowProvider, useReactFlow, type Connection, type EdgeChange, type NodeChange, type NodeProps } from "@xyflow/react";

import type { AppDispatch, RootState } from "@/store";
import type { cardLabel, cardType, edgeType, llmCardData, llmConnectionData, nodeType, Stage } from "@/config/types";

import { useDocumentSync } from "@/hooks/useDocumentSync";
import { requestCardsLLMTextInput, llmCardsToNodes, llmConnectionsToEdges } from "@/func/LLMRequest";
import { updateDocumentMeta } from "@/api/stateApi";
import { getGithubDocumentLink, githubStatus, type GitHubDocumentResponse } from "@/api/githubApi";
import { getGitHubEvents } from "@/api/eventsApi";

import { Title } from "@/components/project/Title";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { FreeInputZone } from "@/components/toolbar/FreeInputZone";
import { LoadSpinner } from "@/components/project/LoadSpinner";
import { Card, type CardProps } from "@/components/cards/Card";
import { CARD_LABELS } from "@/components/cards/cardVisuals";
import { RelationEdge } from "@/components/edges/RelationEdge";
import { GitHubFiles } from "@/components/github/GithubFiles";
import AssetsPanel from "@/components/files/AssetsPanel";
import { CanvasSidebar, type CanvasViewMode } from "@/components/sidebar/CanvasSidebar";

import { addNode, addNodes, connectEdges, onEdgesChange, onNodesChange, updateNode } from "@/store/flowSlice";
import { selectAllFiles } from "@/store/filesSlice";
import { selectAllGitHubEvents, setGithubEvents } from "@/store/gitEventsSlice";
import {
    addDefaultStage,
    addStage,
    changeStageBoundary,
    deleteStage,
    selectAllDesignStudyEvents,
    selectAllStages,
    selectDefaultStages,
    selectTimelineStartEnd,
    updateStage,
} from "@/store/timelineSlice";

import { isAllowedConnection, relationLabelFor } from "@/utils/relationships";
import { buildEvolutionLayoutNodes } from "@/utils/evolutionLayout";
import { fromDate } from "@/pages/projectEditor/dateUtils";
import type { CursorMode, GitConnectionStatus } from "@/pages/projectEditor/types";
import { FlowCanvas } from "@/pages/projectEditor/FlowCanvas";
import { PendingFileModal } from "@/pages/projectEditor/PendingFileModal";
import { TimelineDock } from "@/pages/projectEditor/TimelineDock";
import { useFileAttachmentProcessing } from "@/pages/projectEditor/useFileAttachmentProcessing";

const FlowInnerWithProjectId = ({ projectId }: { projectId: string }) => {
    const { status, error } = useDocumentSync(projectId);

    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { screenToFlowPosition, fitView } = useReactFlow();

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<CursorMode>("");
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [viewMode, setViewMode] = useState<CanvasViewMode>("explore");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [selectedLabels, setSelectedLabels] = useState<cardLabel[]>([...CARD_LABELS]);
    const [gitConnectionStatus, setGitConnectionStatus] = useState<GitConnectionStatus>({ connected: false });
    const queuedPositionChangesRef = useRef<NodeChange<nodeType>[]>([]);
    const nodeChangeRafRef = useRef<number | null>(null);

    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);
    const title = useSelector((state: RootState) => state.flow.title);
    const allFiles = useSelector(selectAllFiles);
    const gitEvents = useSelector(selectAllGitHubEvents);

    const timelineStages = useSelector(selectAllStages);
    const defaultStages = useSelector(selectDefaultStages);
    const timelineStartEnd = useSelector(selectTimelineStartEnd);
    const designStudyEvents = useSelector(selectAllDesignStudyEvents);

    const {
        onAttachFile,
        onAttachFileToCanvas,
        pendingDrop,
        generatedAtInput,
        setGeneratedAtInput,
        processPendingDrop,
        cancelPendingDrop,
    } = useFileAttachmentProcessing({
        projectId,
        dispatch,
        nodes,
        allFiles,
        setLoading,
    });

    const flushQueuedPositionChanges = useCallback(() => {
        nodeChangeRafRef.current = null;
        if (viewMode === "evolution") {
            queuedPositionChangesRef.current = [];
            return;
        }

        if (queuedPositionChangesRef.current.length === 0) return;
        const queuedChanges = queuedPositionChangesRef.current;
        queuedPositionChangesRef.current = [];
        dispatch(onNodesChange(queuedChanges));
    }, [dispatch, viewMode]);

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        if (viewMode === "evolution") return;

        const immediateChanges = changes.filter((change) => change.type !== "position");
        const positionChanges = changes.filter((change) => change.type === "position");

        if (immediateChanges.length > 0) {
            dispatch(onNodesChange(immediateChanges));
        }

        if (positionChanges.length > 0) {
            queuedPositionChangesRef.current.push(...positionChanges);
            if (nodeChangeRafRef.current === null) {
                nodeChangeRafRef.current = window.requestAnimationFrame(flushQueuedPositionChanges);
            }
        }
    }, [dispatch, viewMode, flushQueuedPositionChanges]);

    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => {
        dispatch(onEdgesChange(changes));
    }, [dispatch]);

    const handleConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;

        const sourceNode = nodes.find((node) => node.id === connection.source);
        const targetNode = nodes.find((node) => node.id === connection.target);
        const sourceLabel = sourceNode?.data?.label;
        const targetLabel = targetNode?.data?.label;

        if (!isAllowedConnection(sourceLabel, targetLabel)) return;

        const alreadyConnected = edges.some(
            (edge) => edge.source === connection.source && edge.target === connection.target,
        );
        if (alreadyConnected) return;

        const label = relationLabelFor(sourceLabel!, targetLabel!);
        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: connection.source,
            target: connection.target,
            type: "relation",
            label,
            data: { label, from: sourceLabel, to: targetLabel },
        }]));
    }, [dispatch, nodes, edges]);

    const onDataPropertyChange = useCallback((nodeProps: nodeType, value: string, propertyName: string) => {
        const data = { ...nodeProps.data } as Record<string, unknown> & nodeType["data"];
        let resolvedType: cardType = "social";

        if (value === "requirement" || value === "insight") {
            resolvedType = "technical";
        }

        if (propertyName === "label") {
            data.type = resolvedType;
        }

        data[propertyName] = value;

        dispatch(updateNode({
            ...nodeProps,
            data: data as nodeType["data"],
        }));
    }, [dispatch]);

    const nodeTypes = useMemo(() => ({
        card: (nodeProps: NodeProps) => {
            const cardProps = {
                ...(nodeProps as unknown as CardProps),
                onAttachFile,
                onDataPropertyChange,
            };

            return <Card {...cardProps} />;
        },
    }), [onAttachFile, onDataPropertyChange]);

    const edgeTypes = useMemo(() => ({
        relation: RelationEdge,
    }), []);

    const selectedLabelSet = useMemo(() => new Set(selectedLabels), [selectedLabels]);

    const filteredNodes = useMemo(() => {
        return nodes.filter((node) => {
            const rawLabel = String(node.data?.label ?? "").toLowerCase();
            if (!CARD_LABELS.includes(rawLabel as cardLabel)) return true;
            return selectedLabelSet.has(rawLabel as cardLabel);
        });
    }, [nodes, selectedLabelSet]);

    const filteredEdges = useMemo(() => {
        const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
        return edges.filter((edge) => (
            visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)
        ));
    }, [edges, filteredNodes]);

    const displayedNodes = useMemo(() => {
        if (viewMode === "evolution") {
            return buildEvolutionLayoutNodes(filteredNodes, filteredEdges);
        }
        return filteredNodes;
    }, [viewMode, filteredNodes, filteredEdges]);

    const onCanvasClick = useCallback((e: React.MouseEvent) => {
        if (viewMode === "evolution") return;
        if (cursorMode !== "node") return;

        const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        dispatch(addNode({
            id: crypto.randomUUID(),
            position,
            type: "card",
            data: {
                label: "activity",
                type: "social",
                title: "Untitled",
            },
        }));
    }, [dispatch, viewMode, cursorMode, screenToFlowPosition]);

    const handleCanvasDragOver = useCallback((e: React.DragEvent) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;

        e.preventDefault();
        e.dataTransfer.dropEffect = viewMode === "evolution" ? "none" : "copy";

        if (viewMode === "evolution") return;
    }, [viewMode]);

    const handleCanvasDrop = useCallback((e: React.DragEvent) => {
        const droppedFiles = Array.from(e.dataTransfer?.files ?? []);
        if (droppedFiles.length === 0) return;

        e.preventDefault();
        if (viewMode === "evolution") return;

        const basePosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        void (async () => {
            for (let index = 0; index < droppedFiles.length; index++) {
                await onAttachFileToCanvas(droppedFiles[index], {
                    x: basePosition.x + (index * 300),
                    y: basePosition.y,
                });
            }
        })();
    }, [onAttachFileToCanvas, screenToFlowPosition, viewMode]);

    const onFreeInputSubmit = useCallback(async (x: number, y: number, userText: string) => {
        setCursorMode("");
        setLoading(true);

        try {
            const response: { cards: llmCardData[]; connections: llmConnectionData[] } =
                await requestCardsLLMTextInput(userText);

            if (response?.cards) {
                const { nodes: generatedNodes, idMap } = llmCardsToNodes(response.cards, screenToFlowPosition({ x, y }));
                const generatedEdges = llmConnectionsToEdges(response.connections, idMap);

                dispatch(addNodes(generatedNodes));
                dispatch(connectEdges(generatedEdges));
            }
        } finally {
            setLoading(false);
        }
    }, [dispatch, screenToFlowPosition]);

    const fetchGithubEvents = useCallback(async (connected: boolean) => {
        if (!connected) return;

        const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
        if (!info.github_repo) return;

        const events = await getGitHubEvents(projectId);
        dispatch(setGithubEvents(events));
    }, [dispatch, projectId]);

    const checkGitStatus = useCallback(async () => {
        const status = await githubStatus();
        setGitConnectionStatus(status);
        await fetchGithubEvents(status.connected);
    }, [fetchGithubEvents]);

    useEffect(() => {
        dispatch(setGithubEvents([]));
        void checkGitStatus();
    }, [dispatch, checkGitStatus]);

    useEffect(() => {
        switch (cursorMode) {
            case "text":
                document.body.style.cursor = "text";
                break;
            case "node":
                document.body.style.cursor = "pointer";
                break;
            default:
                document.body.style.cursor = "";
                break;
        }
    }, [cursorMode]);

    useEffect(() => {
        if (viewMode !== "explore") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, selectedLabels, fitView]);

    useEffect(() => {
        if (viewMode !== "evolution") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, displayedNodes, fitView]);

    useEffect(() => {
        if (viewMode !== "evolution") return;
        queuedPositionChangesRef.current = [];
        if (nodeChangeRafRef.current !== null) {
            window.cancelAnimationFrame(nodeChangeRafRef.current);
            nodeChangeRafRef.current = null;
        }
    }, [viewMode]);

    useEffect(() => {
        return () => {
            if (nodeChangeRafRef.current !== null) {
                window.cancelAnimationFrame(nodeChangeRafRef.current);
            }
        };
    }, []);

    const handleToggleSidebar = useCallback(() => {
        setSidebarCollapsed((prev) => !prev);
    }, []);

    const handleToggleLabel = useCallback((label: cardLabel) => {
        setSelectedLabels((prev) => (
            prev.includes(label)
                ? prev.filter((current) => current !== label)
                : [...prev, label]
        ));
    }, []);

    const handleToggleTimeline = useCallback(() => {
        setTimelineOpen((prev) => !prev);
    }, []);

    const handleSetTitle = useCallback((newTitle: string) => {
        void updateDocumentMeta(projectId, { title: newTitle });
    }, [projectId]);

    const handleOpenSettings = useCallback(() => {
        navigate(`/project/${projectId}/setup`);
    }, [navigate, projectId]);

    const handleFreeInputClicked = useCallback(() => {
        setCursorMode("text");
    }, []);

    const handleNodeInputClicked = useCallback(() => {
        setCursorMode("node");
    }, []);

    const handlePointerClicked = useCallback(() => {
        setCursorMode("");
    }, []);

    const handleStageUpdate = useCallback((stage: Stage) => {
        dispatch(updateStage({
            ...stage,
            start: fromDate(stage.start),
            end: fromDate(stage.end),
        }));
    }, [dispatch]);

    const handleStageCreation = useCallback((name: string) => {
        dispatch(addDefaultStage(name));
    }, [dispatch]);

    const handleStageLaneCreation = useCallback((name: string) => {
        dispatch(addStage(name));
    }, [dispatch]);

    const handleStageLaneDeletion = useCallback((id: string) => {
        dispatch(deleteStage(id));
    }, [dispatch]);

    const handleStageBoundaryChange = useCallback((prevId: string, nextId: string, date: Date) => {
        dispatch(changeStageBoundary({
            prevId,
            nextId,
            date: fromDate(date),
        }));
    }, [dispatch]);

    if (status === "loading") return <div>Loading...</div>;
    if (status === "error") return <div>Error: {error}</div>;

    return (
        <>
            <FlowCanvas
                projectId={projectId}
                nodes={displayedNodes}
                edges={filteredEdges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                nodesDraggable={viewMode === "explore"}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onClick={onCanvasClick}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
            />

            <CanvasSidebar
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                selectedLabels={selectedLabels}
                onToggleLabel={handleToggleLabel}
            />

            <div style={{ position: "fixed", right: "30px", top: "30px" }}>
                <img src="/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div>

            <Title
                textTitle={title}
                onSetTitle={handleSetTitle}
                onOpenSettings={handleOpenSettings}
            />

            <Toolbar
                onFreeInputClicked={handleFreeInputClicked}
                onNodeInputClicked={handleNodeInputClicked}
                onPointerClicked={handlePointerClicked}
                shifted={timelineOpen}
            />

            <GitHubFiles
                projectId={projectId}
                connectionStatus={gitConnectionStatus}
            />

            <div style={{ position: "fixed", top: "650px", right: "50px" }}>
                <AssetsPanel records={allFiles} />
            </div>

            {cursorMode === "text" ? (
                <FreeInputZone onInputSubmit={onFreeInputSubmit} />
            ) : null}

            <LoadSpinner loading={loading} />

            <PendingFileModal
                pendingDrop={pendingDrop}
                generatedAtInput={generatedAtInput}
                onGeneratedAtInputChange={setGeneratedAtInput}
                onCancel={cancelPendingDrop}
                onProcess={processPendingDrop}
            />

            <TimelineDock
                open={timelineOpen}
                onToggleOpen={handleToggleTimeline}
                startMarker={timelineStartEnd.start}
                endMarker={timelineStartEnd.end}
                codebaseEvents={gitEvents}
                designStudyEvents={designStudyEvents}
                stages={timelineStages}
                defaultStages={defaultStages}
                onStageUpdate={handleStageUpdate}
                onStageCreation={handleStageCreation}
                onStageLaneCreation={handleStageLaneCreation}
                onStageLaneDeletion={handleStageLaneDeletion}
                onStageBoundaryChange={handleStageBoundaryChange}
            />
        </>
    );
};

const FlowInner = () => {
    const { projectId } = useParams<{ projectId: string }>();
    if (!projectId) return <div>Missing project id</div>;

    return <FlowInnerWithProjectId projectId={projectId} />;
};

export function ProjectEditorPage() {
    return (
        <div style={{ width: "100vw", height: "100vh" }}>
            <ReactFlowProvider>
                <FlowInner />
            </ReactFlowProvider>
        </div>
    );
}
