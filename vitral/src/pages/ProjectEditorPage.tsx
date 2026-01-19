import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow, useReactFlow, ReactFlowProvider } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/Title';
import { Toolbar } from '@/components/Toolbar';
import { FileDropZone } from '@/components/FileDropZone';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes, requestCardsLLMTextInput } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes } from '@/store/flowSlice';
import { Card } from '@/components/Card';

import type { fileData } from '@/config/types';
import type { RootState } from '@/store';

import { FreeInputZone } from '@/components/FreeInputZone';

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

            {/* Calls to action */}
            <div style={{ position: 'fixed', right: '30px', top: '30px' }}>
                <img src="/cta_drag_and_drop.png" alt="Drag and Drop file to instantiate cards." />
            </div>

            <div style={{ position: 'fixed', left: '30px', bottom: '30px' }}>
                <img src="/cta_click_to_type.png" alt="Click and type to instantiate cards." />
            </div>

            {/* Document title */}
            {/* <Title 
                textTitle={title}
            /> */}

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

                        const response: {cards: {entity: string, title: string, description?: string}[]} = await requestCardsLLMTextInput(userText);
                        
                        console.log(response);

                        if(response && response.cards){
                            console.log("response", response);
                            let newNodes = llmCardsToNodes(response.cards, screenToFlowPosition({x, y}));

                            console.log(newNodes);

                            dispatch(addNodes(newNodes));
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
                    const response: {cards: {entity: string, title: string, description?: string}[]} = await requestCardsLLM(data);

                    console.log(response);

                    if(response && response.cards){
                        console.log("response", response);
                        let newNodes = llmCardsToNodes(response.cards);

                        console.log(newNodes);

                        dispatch(addNodes(newNodes));
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
