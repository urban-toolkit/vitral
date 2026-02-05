import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider, Background, BackgroundVariant, type NodeChange, type EdgeChange } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/project/Title';
import { Toolbar } from '@/components/toolbar/Toolbar';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput, llmConnectionsToEdges } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes, connectEdges, attachFileIdToNode, addNode, updateNode } from '@/store/flowSlice';
import { upsertFile } from '@/store/filesSlice';
import { Card } from '@/components/cards/Card';

import type { cardType, edgeType, filePendingUpload, nodeType } from '@/config/types';
import type { RootState } from '@/store';

import { FreeInputZone } from '@/components/toolbar/FreeInputZone';
import { createFile, updateDocumentMeta } from '@/api/stateApi';
import { GitHubFiles } from '@/components/github/GithubFiles';
import { githubStatus } from '@/api/githubApi';
import { LoadSpinner } from '@/components/project/LoadSpinner';
import { Timeline } from '@/components/timeline/Timeline';

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faAnglesUp } from '@fortawesome/free-solid-svg-icons';
import { getGitHubEvents } from '@/api/eventsApi';

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

    const [gitConnectionStatus, setGitConnectionStatus] = useState<{ connected: boolean, user?: { id: number, login: string } }>({ connected: false });

    const dispatch = useDispatch();
    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);
    const title = useSelector((state: RootState) => state.flow.title);

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

        let data: Record<string, any> = {...nodeProps.data};

        let cardType: cardType = 'social';

        switch (value) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break;
        }

        if(propertyName == "label")
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
        if(connected){
            const githubEvents = await getGitHubEvents(projectId);
            console.log("githubEvents", githubEvents);
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

        console.log(response);

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
        if(cursorMode.current == 'node'){
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
                    {bottom: "200px"} 
                    : 
                    {bottom: 0})
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
            onClick={() => {setTimelineOpen(!timelineOpen)}}
        >
            <p
                style={{
                    margin: 0
                }}
            >Events</p>
            
            <FontAwesomeIcon
                icon={faAnglesUp} 
                style={timelineOpen ? {transform: "rotateX(180deg)"} : {}}
            />
        </div>

        <div 
            style={
                {
                    ...(timelineOpen
                        ?
                        {bottom: 0}
                        :
                        {bottom: "-200px"}
                    ),
                    position: "fixed",
                    backgroundColor: "rgba(255, 255, 255, 0.7)",
                    height: "200px",
                    width: "100vw",
                    boxShadow: "0 4px 30px rgba(0, 0, 0, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.39)",
                    backdropFilter: "blur(4px)"
                }
            }
        >
            <Timeline 
                startMarker={new Date("January 15, 2026 03:24:00")}
                endMarker={new Date("June 04, 2026 00:24:00")}
                codebaseEvents={[
                    {id: crypto.randomUUID(), date: new Date("January 04, 2026 12:24:00"), kind: "codebase", subtype: "repo_created"},
                    {id: crypto.randomUUID(), date: new Date("January 06, 2026 12:24:00"), kind: "codebase", subtype: "commit"},
                ]}
                knowledgeBaseEvents={[
                    {id: crypto.randomUUID(), date: new Date("February 04, 2026 12:24:00"), kind: "knowledge", subtype: "activity_created"},
                    {id: crypto.randomUUID(), date: new Date("February 13, 2026 12:24:00"), kind: "knowledge", subtype: "requirement_created"},
                ]}
                designStudyEvents={[
                    {id: crypto.randomUUID(), date: new Date("January 01, 2026 03:24:00"), kind: "designStudy", subtype: "study_started"},
                ]}
                stages={[
                    {name: "Learn", start: new Date("January 15, 2026 03:24:00"), end: new Date("February 05, 2026 03:24:00")},
                    {name: "Design", start: new Date("February 05, 2026 03:24:00"), end: new Date("March 26, 2026 03:24:00")},
                    {name: "Implement", start: new Date("March 26, 2026 03:24:00"), end: new Date("April 16, 2026 03:24:00")},
                    {name: "Evaluate", start: new Date("April 16, 2026 03:24:00"), end: new Date("May 21, 2026 03:24:00")},
                    {name: "Reflect and Communicate", start: new Date("May 21, 2026 03:24:00"), end: new Date("June 04, 2026 03:24:00")}
                ]}
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
