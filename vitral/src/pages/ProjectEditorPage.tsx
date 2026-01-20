import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/Title';
import { Toolbar } from '@/components/Toolbar';
import { FileDropZone } from '@/components/FileDropZone';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput, llmConnectionsToEdges } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes, connectEdges } from '@/store/flowSlice';
import { Card } from '@/components/Card';

import type { fileData } from '@/config/types';
import type { RootState } from '@/store';

import { FreeInputZone } from '@/components/FreeInputZone';
import { updateDocumentMeta } from '@/api/stateApi';

const nodeTypes = {
    card: Card,
};

const FlowInner = () => {
    const { projectId } = useParams<{ projectId: string }>();

    if (!projectId) {
        return <div>Missing project id</div>;
    }

    const { status, error } = useDocumentSync(projectId);

    const [loading, setLoading] = useState(false);
    const [cursorMode, setCursorMode] = useState<'node' | 'text' | 'tree' | 'related' | ''>();

    const dispatch = useDispatch();
    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);
    const title = useSelector((state: RootState) => state.flow.title);

    const { screenToFlowPosition } = useReactFlow();

    useEffect(() => {
        switch(cursorMode){
            case 'text':
                document.body.style.cursor = 'text';
                break;
            default:
                break;
        }

    }, [cursorMode]);

    if (status === "loading") return <div>Loading…</div>;
    if (status === "error") return <div>Error: {error}</div>;    

    return <>        
            <ReactFlow
                key={projectId}
                nodes={nodes}
                edges={edges}
                onNodesChange={(e) => dispatch(onNodesChange(e))}
                onEdgesChange={(e) => dispatch(onEdgesChange(e))}
                // onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
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
                    updateDocumentMeta(projectId, {title: newTitle});
                }}
            />

            <Toolbar
                onFreeInputClicked={() => {
                    setCursorMode('text');
                }}

                onNodeInputClicked={() => {
                    setCursorMode('');
                }}
            />

            {cursorMode == 'text'
            ?
                <FreeInputZone
                    onInputSubmit={async (x: number, y: number, userText: string) => {
                        setCursorMode("");

                        setLoading(true);

                        const response: {cards: {id: number, entity: string, title: string, description?: string}[], connections: {source: number, target: number}[]} = await requestCardsLLMTextInput(userText);
                        
                        console.log(response);

                        if(response && response.cards){
                            console.log("response", response);
                            let {nodes, idMap} = llmCardsToNodes(response.cards, screenToFlowPosition({x, y}));
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

            <FileDropZone 
                onFileSelected={async (file: File) => {
                    setLoading(true);

                    const data: fileData = await parseFile(file);
                    const response: {cards: {id: number, entity: string, title: string, description?: string}[], connections: {source: number, target: number}[]} = await requestCardsLLM(data);

                    console.log(response);

                    if(response && response.cards){
                        console.log("response", response);
                        let {nodes, idMap} = llmCardsToNodes(response.cards);
                        let edges = llmConnectionsToEdges(response.connections, idMap);

                        console.log(nodes, edges, idMap);

                        dispatch(addNodes(nodes));
                        dispatch(connectEdges(edges));
                    }

                    setLoading(false);
                }}
                loading={loading}
                accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
            />
        </>

}

export function ProjectEditorPage() {

    return <div style={{width: "100vw", height: "100vh"}}>
        <ReactFlowProvider>
            <FlowInner />
        </ReactFlowProvider>
    </div>;
}
