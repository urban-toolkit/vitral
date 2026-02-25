import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider, Background, BackgroundVariant, type NodeChange, type EdgeChange, type Connection } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/project/Title';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput, llmConnectionsToEdges } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes, connectEdges, attachFileIdToNode, addNode, updateNode } from '@/store/flowSlice';
import { selectAllFiles, upsertFile } from '@/store/filesSlice';
import { Card } from '@/components/cards/Card';

import type { cardType, edgeType, filePendingUpload, llmCardData, llmConnectionData, nodeType } from '@/config/types';
import type { RootState } from '@/store';

import { FreeInputZone } from '@/components/toolbar/FreeInputZone';
import { createFile, updateDocumentMeta } from '@/api/stateApi';
import { GitHubFiles } from '@/components/github/GithubFiles';
import { getGithubDocumentLink, githubStatus, type GitHubDocumentResponse } from '@/api/githubApi';
import { LoadSpinner } from '@/components/project/LoadSpinner';
import { Timeline } from '@/components/timeline/Timeline';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesUp } from '@fortawesome/free-solid-svg-icons';
import { getGitHubEvents } from '@/api/eventsApi';
import { selectAllGitHubEvents, setGithubEvents } from '@/store/gitEventsSlice';
import AssetsPanel from '@/components/files/AssetsPanel';
import { addDefaultStage, addStage, changeStageBoundary, deleteStage, selectAllDesignStudyEvents, selectAllStages, selectDefaultStages, selectTimelineStartEnd, updateStage } from '@/store/timelineSlice';
import { RelationEdge } from '@/components/edges/RelationEdge';
import { isAllowedConnection, relationLabelFor } from '@/utils/relationships';
import { CanvasSidebar, type CanvasViewMode } from '@/components/sidebar/CanvasSidebar';
import { buildEvolutionLayoutNodes } from '@/utils/evolutionLayout';

const fromDate = (d: Date | string) => (d instanceof Date ? d.toString() : d);
const toLocalDateTimeInputValue = (date: Date) => {
    const offsetMs = date.getTimezoneOffset() * 60_000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

type FlowCanvasProps = {
    projectId: string;
    nodes: nodeType[];
    edges: edgeType[];
    nodeTypes: any;
    edgeTypes: any;
    nodesDraggable: boolean;

    onNodesChange: (changes: NodeChange<nodeType>[]) => any;
    onEdgesChange: (changes: EdgeChange<edgeType>[]) => any;
    onConnect: (connection: Connection) => void;

    onClick: (e: React.MouseEvent) => void;
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
    onClick
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
            fitView
        >
            <Background color="#848484" variant={BackgroundVariant.Dots} />
        </ReactFlow>
    );
});

const FlowInner = () => {
    const { projectId } = useParams<{ projectId: string }>();

    if (!projectId) {
        return <div>Missing project id</div>;
    }

    const { status, error } = useDocumentSync(projectId);

    const [loading, setLoading] = useState(false);
    const cursorMode = useRef<'node' | 'text' | 'tree' | 'related' | ''>('');
    const [pendingDrop, setPendingDrop] = useState<{
        file: File;
        dropPosition: { x: number; y: number };
        rootActivityNodeId?: string;
    } | null>(null);
    const [generatedAtInput, setGeneratedAtInput] = useState<string>(() => toLocalDateTimeInputValue(new Date()));

    const timelineStages = useSelector(selectAllStages);
    const defaultStages = useSelector(selectDefaultStages);
    const timelineStartEnd = useSelector(selectTimelineStartEnd);
    const designStudyEvents = useSelector(selectAllDesignStudyEvents);

    const [gitConnectionStatus, setGitConnectionStatus] = useState<{ connected: boolean, user?: { id: number, login: string } }>({ connected: false });

    const dispatch = useDispatch();
    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);
    const title = useSelector((state: RootState) => state.flow.title);

    const gitEvents = useSelector(selectAllGitHubEvents);

    const allFiles = useSelector(selectAllFiles);

    const [viewMode, setViewMode] = useState<CanvasViewMode>("explore");
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => {
        if (viewMode === "evolution") return;
        dispatch(onNodesChange(changes));
    }, [dispatch, viewMode]);
    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => dispatch(onEdgesChange(changes)), [dispatch]);
    const handleConnect = useCallback((connection: Connection) => {
        if (!connection.source || !connection.target) return;

        const sourceNode = nodes.find((node) => node.id === connection.source);
        const targetNode = nodes.find((node) => node.id === connection.target);
        const sourceLabel = sourceNode?.data?.label;
        const targetLabel = targetNode?.data?.label;

        if (!isAllowedConnection(sourceLabel, targetLabel)) return;

        const alreadyConnected = edges.some(
            (edge) => edge.source === connection.source && edge.target === connection.target
        );
        if (alreadyConnected) return;

        const label = relationLabelFor(sourceLabel!, targetLabel!);

        dispatch(connectEdges([{
            id: crypto.randomUUID(),
            source: connection.source,
            target: connection.target,
            type: "relation",
            label,
            data: { label, from: sourceLabel, to: targetLabel }
        }]));
    }, [dispatch, edges, nodes]);

    const displayedNodes = useMemo(() => {
        if (viewMode === "evolution") {
            return buildEvolutionLayoutNodes(nodes, edges);
        }
        return nodes;
    }, [viewMode, nodes, edges]);

    const { screenToFlowPosition, fitView } = useReactFlow();

    const onAttachFile = useCallback(async (nodeId: string, file: File) => {
        const targetNode = nodes.find((node) => node.id === nodeId);
        const isActivityNode = String(targetNode?.data?.label ?? "").toLowerCase() === "activity";

        if (isActivityNode && targetNode) {
            setGeneratedAtInput(toLocalDateTimeInputValue(new Date()));
            setPendingDrop({
                file,
                dropPosition: { x: targetNode.position.x, y: targetNode.position.y },
                rootActivityNodeId: nodeId
            });
            return;
        }

        const res = await parseFile(file);
        const { fileId, createdAt, sha256, bucket, key } = await createFile(projectId, res);

        const { name, mimeType, sizeBytes, ext } = res;
        dispatch(upsertFile({ id: fileId, docId: projectId, name, mimeType, sizeBytes, ext, createdAt, sha256, storage: { bucket, key } }));
        dispatch(attachFileIdToNode({ nodeId, fileId }));

    }, [dispatch, projectId, nodes]);

    const onDataPropertyChange = useCallback(async (nodeProps: nodeType, value: any, propertyName: string) => {

        let data: Record<string, any> = { ...nodeProps.data };

        let cardType: cardType = 'social';

        switch (value) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break;
        }

        if (propertyName == "label")
            data.type = cardType;

        data[propertyName] = value;

        let newNode = {
            ...nodeProps,
            data
        };

        dispatch(updateNode(newNode as nodeType));
    }, [dispatch]);

    const nodeTypes = useMemo(() => ({
        card: (nodeProps: any) => <Card {...nodeProps} onAttachFile={onAttachFile} onDataPropertyChange={onDataPropertyChange} />
    }), [onAttachFile]);

    const edgeTypes = useMemo(() => ({
        relation: RelationEdge,
    }), []);

    const fetchGithubEvents = async (connected: boolean) => {
        if (connected) {
            const info: GitHubDocumentResponse = await getGithubDocumentLink(projectId);
            if (info.github_repo && info.github_repo != "") {
                const githubEvents = await getGitHubEvents(projectId);

                dispatch(setGithubEvents(githubEvents));
            }
        }
    }

    const checkGitStatus = async () => {
        const status = await githubStatus();
        setGitConnectionStatus(status);
        fetchGithubEvents(status.connected);
    }

    // Timeline
    const [timelineOpen, setTimelineOpen] = useState(false);

    const processFile = async (
        file: File,
        generatedAt: string,
        rootActivityNodeId: string,
        dropPosition?: { x: number; y: number }
    ) => {
        setLoading(true);

        try {
            const data: filePendingUpload = await parseFile(file);
            const parsedGeneratedAt = generatedAt ? new Date(generatedAt) : new Date();
            const chosenCreatedAt = Number.isNaN(parsedGeneratedAt.getTime())
                ? new Date().toISOString()
                : parsedGeneratedAt.toISOString();

            const { fileId, sha256, bucket, key } = await createFile(projectId, data);
            const { name, mimeType, sizeBytes, ext } = data;
            let edges: edgeType[] = [];

            dispatch(upsertFile({
                id: fileId,
                docId: projectId,
                name,
                mimeType,
                sizeBytes,
                ext,
                createdAt: chosenCreatedAt,
                sha256,
                storage: { bucket, key }
            }));

            if (rootActivityNodeId) {
                const rootNode = nodes.find((node) => node.id === rootActivityNodeId);
                if (rootNode) {
                    dispatch(updateNode({
                        ...rootNode,
                        data: {
                            ...rootNode.data,
                            createdAt: chosenCreatedAt,
                            origin: fileId
                        }
                    }));
                }
            }

            const response: { cards: llmCardData[], connections: llmConnectionData[] } =
                await requestCardsLLM(data, allFiles);

            if (response && response.cards) {
                console.log("response", response);

                const cardById = new Map<number, { id: number, entity: string; title: string; description?: string }>();
                for (const c of response.cards) {
                    cardById.set(c.id, c);
                }

                const { nodes: generatedNodes, idMap } = llmCardsToNodes(response.cards, dropPosition, {
                    createdAt: chosenCreatedAt,
                    origin: fileId
                });

                if (rootActivityNodeId) {
                    for (const card of response.cards) {
                        const targetNodeId = idMap[String(card.id)];
                        if (!targetNodeId || targetNodeId === rootActivityNodeId) continue;

                        const label = relationLabelFor("activity", card.entity);
                        if (!label) continue;

                        edges.push({
                            id: crypto.randomUUID(),
                            target: rootActivityNodeId,
                            source: targetNodeId,
                            type: "relation",
                            label,
                            data: { label, from: "activity", to: card.entity }
                        });
                    }
                }

                console.log(generatedNodes, edges, idMap);

                dispatch(addNodes(generatedNodes));
                dispatch(connectEdges(edges));

                const availableAssetIds = new Set(allFiles.map((file) => file.id));
                availableAssetIds.add(fileId);

                for (const card of response.cards) {
                    const nodeId = idMap[String(card.id)];
                    if (!nodeId || !Array.isArray(card.assets)) continue;

                    const uniqueAssets = Array.from(new Set(card.assets));
                    for (const cardFileId of uniqueAssets) {
                        if (!availableAssetIds.has(cardFileId)) continue;
                        dispatch(attachFileIdToNode({ nodeId, fileId: cardFileId }));
                    }
                }

                dispatch(attachFileIdToNode({ nodeId: rootActivityNodeId, fileId }));
            }
        } finally {
            setLoading(false);
        }
    }

    const onClick = useCallback((e: React.MouseEvent) => {
        if (viewMode === "evolution") return;

        if (cursorMode.current == 'node') {
            const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });

            dispatch(addNode({
                id: crypto.randomUUID(),
                position,
                type: 'card',
                data: {
                    label: 'activity',
                    type: 'social',
                    title: 'Untitled'
                }
            }));
        }

    }, [dispatch, screenToFlowPosition, viewMode]);

    useEffect(() => {
        dispatch(setGithubEvents([]));
        checkGitStatus();
    }, [])

    useEffect(() => {
        switch (cursorMode.current) {
            case 'text':
                document.body.style.cursor = 'text';
                break;
            case 'node':
                document.body.style.cursor = 'pointer';
                break;
            default:
                document.body.style.cursor = '';
                break;
        }

    }, [cursorMode]);

    useEffect(() => {
        if (viewMode !== "explore") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, fitView]);

    useEffect(() => {
        if (viewMode !== "evolution") return;

        const t = window.setTimeout(() => {
            fitView({ padding: 0.2, duration: 350 });
        }, 0);

        return () => window.clearTimeout(t);
    }, [viewMode, displayedNodes, fitView]);

    if (status === "loading") return <div>Loading…</div>;
    if (status === "error") return <div>Error: {error}</div>;

    return <>
        <FlowCanvas
            projectId={projectId}
            nodes={displayedNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={viewMode === "explore"}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onClick={onClick}
        />

        <CanvasSidebar
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed((prev) => !prev)}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
        />

        {/* Call to action */}
        <div style={{ position: 'fixed', right: '30px', top: '30px' }}>
            <img src="/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
        </div>

        {/* Document title */}
        <Title
            textTitle={title}
            onSetTitle={(newTitle: string) => {
                updateDocumentMeta(projectId, { title: newTitle });
            }}
        />

        <Toolbar
            onFreeInputClicked={() => {
                cursorMode.current = 'text';
            }}

            onNodeInputClicked={() => {
                cursorMode.current = 'node';
            }}

            onPointerClicked={() => {
                cursorMode.current = '';
            }}

            shifted={timelineOpen}
        />

        <GitHubFiles
            projectId={projectId}
            connectionStatus={gitConnectionStatus}
        />

        <div
            style={{ position: "fixed", top: "650px", right: "50px" }}
        >
            <AssetsPanel
                records={allFiles}
            />
        </div>

        {cursorMode.current == 'text'
            ?
            <FreeInputZone
                onInputSubmit={async (x: number, y: number, userText: string) => {
                    cursorMode.current = "";

                    setLoading(true);

                    const response: { cards: llmCardData[], connections: llmConnectionData[] } = await requestCardsLLMTextInput(userText);

                    console.log(response);

                    if (response && response.cards) {
                        console.log("response", response);
                        let { nodes, idMap } = llmCardsToNodes(response.cards, screenToFlowPosition({ x, y }));
                        let edges = llmConnectionsToEdges(response.connections, idMap);

                        console.log(nodes, edges, idMap);

                        dispatch(addNodes(nodes));
                        dispatch(connectEdges(edges));
                    }

                    setLoading(false);
                }}
            />
            :
            null
        }

        {/* Load spinner */}
        <LoadSpinner
            loading={loading}
        />

        {pendingDrop && (
            <div
                style={{
                    position: "fixed",
                    inset: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.35)",
                    zIndex: 10000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            >
                <div
                    style={{
                        backgroundColor: "white",
                        borderRadius: "10px",
                        padding: "18px",
                        width: "420px",
                        boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)"
                    }}
                >
                    <h3 style={{ marginTop: 0, marginBottom: "10px" }}>Approximate file generation timestamp</h3>
                    <p style={{ marginTop: 0, marginBottom: "12px" }}>
                        Adjust the timestamp if needed before processing <strong>{pendingDrop.file.name}</strong>.
                    </p>

                    <input
                        type="datetime-local"
                        value={generatedAtInput}
                        onChange={(e) => setGeneratedAtInput(e.target.value)}
                        style={{
                            width: "100%",
                            padding: "8px",
                            border: "1px solid #ccc",
                            borderRadius: "6px",
                            marginBottom: "14px"
                        }}
                    />

                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
                        <button
                            type="button"
                            onClick={() => setPendingDrop(null)}
                            style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid #ccc", background: "white", cursor: "pointer" }}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                if (!pendingDrop || !pendingDrop?.rootActivityNodeId) return;

                                processFile(
                                    pendingDrop.file,
                                    generatedAtInput,
                                    pendingDrop.rootActivityNodeId,
                                    pendingDrop.dropPosition
                                );
                                setPendingDrop(null);
                            }}
                            style={{ padding: "8px 12px", borderRadius: "6px", border: "none", background: "#161616", color: "white", cursor: "pointer" }}
                        >
                            Process file
                        </button>
                    </div>
                </div>
            </div>
        )}

        <div
            style={{
                ...(timelineOpen
                    ?
                    { bottom: "300px" }
                    :
                    { bottom: 0 })
                ,
                cursor: "pointer",
                height: "25px",
                padding: "5px",
                position: "fixed",
                backgroundColor: "white",
                zIndex: 2,
                border: "1px solid rgba(174, 172, 172, 0.39)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center"
            }}
            onClick={() => { setTimelineOpen(!timelineOpen) }}
        >
            <p
                style={{
                    margin: 0
                }}
            >Events</p>

            <FontAwesomeIcon
                icon={faAnglesUp}
                style={timelineOpen ? { transform: "rotateX(180deg)" } : {}}
            />
        </div>

        <div
            style={
                {
                    ...(timelineOpen
                        ?
                        { bottom: 0 }
                        :
                        { bottom: "-300px" }
                    ),
                    position: "fixed",
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    height: "300px",
                    width: "100vw",
                    boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.39)",
                    backdropFilter: "blur(4px)"
                }
            }
        >
            <Timeline
                startMarker={timelineStartEnd.start}
                endMarker={timelineStartEnd.end}
                codebaseEvents={gitEvents}
                knowledgeBaseEvents={[
                    { id: crypto.randomUUID(), occurredAt: new Date("July 04, 2023 12:24:00"), kind: "knowledge", subtype: "activity_created" },
                    { id: crypto.randomUUID(), occurredAt: new Date("July 13, 2023 12:24:00"), kind: "knowledge", subtype: "requirement_created" },
                ]}
                designStudyEvents={designStudyEvents}
                stages={timelineStages}
                defaultStages={defaultStages}
                onStageUpdate={(stage) => {
                    dispatch(updateStage({
                        ...stage,
                        start: fromDate(stage.start),
                        end: fromDate(stage.end)
                    }));
                }}
                onStageCreation={(name: string) => {
                    dispatch(addDefaultStage(name));
                }}
                onStageLaneCreation={(name: string) => {
                    dispatch(addStage(name));
                }}
                onStageLaneDeletion={(id: string) => {
                    dispatch(deleteStage(id));
                }}
                onStageBoundaryChange={(prevId, nextId, date) => {
                    dispatch(
                        changeStageBoundary({
                            prevId,
                            nextId,
                            date: fromDate(date)
                        })
                    );
                }}
            />
        </div>

    </>

}

export function ProjectEditorPage() {

    return <div style={{ width: "100vw", height: "100vh" }}>
        <ReactFlowProvider>
            <FlowInner />
        </ReactFlowProvider>
    </div>;
}
