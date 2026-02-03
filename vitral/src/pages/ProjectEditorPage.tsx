import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider, Background, BackgroundVariant, type NodeChange, type EdgeChange } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/Title';
import { Toolbar } from '@/components/Toolbar';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput, llmConnectionsToEdges } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes, connectEdges, attachFileIdToNode, addNode, updateNode } from '@/store/flowSlice';
import { upsertFile } from '@/store/filesSlice';
import { Card } from '@/components/Card';

import type { cardType, edgeType, filePendingUpload, nodeType } from '@/config/types';
import type { RootState } from '@/store';

import { FreeInputZone } from '@/components/FreeInputZone';
import { createFile, updateDocumentMeta } from '@/api/stateApi';
import { GitHubFiles } from '@/components/GithubFiles';
import { githubStatus } from '@/api/githubApi';
import { LoadSpinner } from '@/components/LoadSpinner';

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

    const onLabelChange = useCallback(async (nodeProps: nodeType, newLabel: string) => {

        let cardType: cardType = 'social';

        switch (newLabel) {
            case 'requirement':
                cardType = 'technical';
                break;
            case 'insight':
                cardType = 'technical';
                break
        }

        let newNode = {
            ...nodeProps,
            data: {
                ...nodeProps.data,
                label: newLabel,
                type: cardType
            }
        };

        dispatch(updateNode(newNode));
    }, [dispatch]);

    const nodeTypes = useMemo(() => ({
        card: (nodeProps: any) => <Card {...nodeProps} onAttachFile={onAttachFile} onLabelChange={onLabelChange} />
    }), [onAttachFile]);

    const checkGitStatus = async () => {
        const status = await githubStatus();
        setGitConnectionStatus(status);
    }

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
                    title: ''
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
                console.log("newTitle", newTitle);
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
    </>

}

export function ProjectEditorPage() {

    return <div style={{ width: "100vw", height: "100vh" }}>
        <ReactFlowProvider>
            <FlowInner />
        </ReactFlowProvider>
    </div>;
}
