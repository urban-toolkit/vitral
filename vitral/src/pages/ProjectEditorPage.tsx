import { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useParams } from "react-router-dom";
import { ReactFlow } from '@xyflow/react';

import { useDocumentSync } from "@/hooks/useDocumentSync";

import { Title } from '@/components/Title';
import { FileDropZone } from '@/components/FileDropZone';
import { parseFile } from '@/func/FileParser';
import { requestCardsLLM, llmCardsToNodes } from '@/func/LLMRequest';
import { onEdgesChange, onNodesChange, addNodes } from '@/store/flowSlice';
import { Card } from '@/components/Card';

import type { fileData } from '@/config/types';
import type { RootState } from '@/store';

const nodeTypes = {
    card: Card,
};

export function ProjectEditorPage() {
    const { projectId } = useParams<{ projectId: string }>();

    if (!projectId) {
        return <div>Missing project id</div>;
    }

    const { status, error } = useDocumentSync(projectId);

    const [loading, setLoading] = useState(false);

    const dispatch = useDispatch();
    const nodes = useSelector((state: RootState) => state.flow.nodes);
    const edges = useSelector((state: RootState) => state.flow.edges);

    if (status === "loading") return <div>Loading…</div>;
    if (status === "error") return <div>Error: {error}</div>;

    return <div style={{width: "100vw", height: "100vh"}}>

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

        <FileDropZone 
            onFileSelected={async (file: File) => {
                setLoading(true);

                const data: fileData = await parseFile(file);
                const response: {cards: {entity: string, title: string, description: string}[]} = await requestCardsLLM(data);

                console.log(response);

                let nodes = useSelector((state: RootState) => state.flow.nodes);

                if(response && response.cards){
                    console.log("response", response);
                    let newNodes = llmCardsToNodes(response.cards, nodes);

                    console.log(newNodes);

                    dispatch(addNodes(newNodes));
                }

                setLoading(false);
            }}
            loading={loading}
            accept='.txt, .png, .jpg, .jpeg, .json, .csv, .ipynb, .py, .js, .ts, .html, .css, .md'
        />

    </div>;
}
