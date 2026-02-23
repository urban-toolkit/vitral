import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider, Background, BackgroundVariant, type NodeChange, type EdgeChange } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/project/Title';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput, llmConnectionsToEdges, docLingFileParse } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes, connectEdges, attachFileIdToNode, addNode, updateNode } from '@/store/flowSlice';
import { selectAllFiles, upsertFile } from '@/store/filesSlice';
import { Card } from '@/components/cards/Card';

import type { cardType, edgeType, filePendingUpload, nodeType } from '@/config/types';
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

const fromDate = (d: Date | string) => (d instanceof Date ? d.toString() : d);

type FlowCanvasProps = {
    projectId: string;
    nodes: nodeType[];
    edges: edgeType[];
    nodeTypes: any;

    onDragEnter: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;

    onNodesChange: (changes: NodeChange<nodeType>[]) => any;
    onEdgesChange: (changes: EdgeChange<edgeType>[]) => any;

    onClick: (e: React.MouseEvent) => void;
};

export const FlowCanvas = memo(function FlowCanvas({
    projectId,
    nodes,
    edges,
    nodeTypes,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onNodesChange,
    onEdgesChange,
    onClick
}: FlowCanvasProps) {

    return (
        <ReactFlow
            key={projectId}
            nodes={nodes}
            edges={edges}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
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

    const handleNodesChange = useCallback((changes: NodeChange<nodeType>[]) => dispatch(onNodesChange(changes)), [dispatch]);
    const handleEdgesChange = useCallback((changes: EdgeChange<edgeType>[]) => dispatch(onEdgesChange(changes)), [dispatch]);

    const { screenToFlowPosition } = useReactFlow();

    const onAttachFile = useCallback(async (nodeId: string, file: File) => {

        const res = await parseFile(file);
        const { fileId, createdAt, sha256, bucket, key } = await createFile(projectId, res);

        const { name, mimeType, sizeBytes, ext } = res;
        dispatch(upsertFile({ id: fileId, docId: projectId, name, mimeType, sizeBytes, ext, createdAt, sha256, storage: { bucket, key } }));
        dispatch(attachFileIdToNode({ nodeId, fileId }));

    }, [dispatch, projectId]);

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

    // Drag + Drop functions
    const [ghostScreen, setGhostScreen] = useState<{ x: number; y: number } | null>(null);
    const [dragActive, setDragActive] = useState(false);

    const isFileDrag = (dt: DataTransfer | null) => {
        if (!dt) return false;
        return Array.from(dt.types || []).includes("Files");
    };

    const processFile = async (file: File) => {
        setLoading(true);

        const data: filePendingUpload = await parseFile(file);

        const response: { cards: { id: number, entity: string, title: string, description?: string }[], connections: { source: number, target: number }[] } = await requestCardsLLM(data);

        if (response && response.cards) {
            console.log("response", response);
            let { nodes, idMap } = llmCardsToNodes(response.cards);
            let edges = llmConnectionsToEdges(response.connections, idMap);

            console.log(nodes, edges, idMap);

            dispatch(addNodes(nodes));
            dispatch(connectEdges(edges));
        }

        setLoading(false);
    }

    const onDragEnter = useCallback((e: React.DragEvent) => {
        if (!isFileDrag(e.dataTransfer)) return;
        e.preventDefault();
        setDragActive(true);
    }, []);

    const onDragOver = useCallback(
        (e: React.DragEvent) => {
            if (!isFileDrag(e.dataTransfer)) return;

            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";

            if (!dragActive)
                setDragActive(true);

            setGhostScreen({ x: e.clientX, y: e.clientY });
        },
        []);

    const onDragLeave = useCallback((e: React.DragEvent) => {
        setDragActive(false);
    }, []);

    const onDrop = useCallback(
        async (e: React.DragEvent) => {
            if (!isFileDrag(e.dataTransfer)) return;
            e.preventDefault();

            setDragActive(false);
            setGhostScreen(null);

            const files = Array.from(e.dataTransfer.files ?? []);
            if (files.length === 0) return;

            processFile(files[0]);
        }, []);

    const onClick = useCallback((e: React.MouseEvent) => {
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

    }, []);

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

    if (status === "loading") return <div>Loading…</div>;
    if (status === "error") return <div>Error: {error}</div>;

    return <>
        <FlowCanvas
            projectId={projectId}
            nodes={nodes}
            edges={edges}
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            nodeTypes={nodeTypes}
            onClick={onClick}
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

                    const response: { cards: { id: number, entity: string, title: string, description?: string }[], connections: { source: number, target: number }[] } = await requestCardsLLMTextInput(userText);

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

        {/* Ghost overlay for file dragging */}
        {dragActive && ghostScreen && (
            <div
                style={{
                    position: "fixed",
                    left: ghostScreen.x + 12,
                    top: ghostScreen.y + 12,
                    transform: "translate(0, 0)",
                    zIndex: 9999,
                    pointerEvents: "none",
                    opacity: "60%"
                }}
            >
                <div>
                    <Card
                        data={{
                            title: "",
                            type: "social",
                            label: "activity"
                        }}
                    />
                </div>
            </div>
        )}

        {/* Load spinner */}
        <LoadSpinner
            loading={loading}
        />

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
